'use strict'

var DuplexStream = require('stream').Duplex
var util = require('util')
var duplexify = require('duplexify').obj
var mux = require('multiplex')
var ndjson = require('ndjson')
var hat = require('hat')

var PROTOCOL_VERSION = 0

// TODO: support arbitrary streams to mux many protocols across one peer connection
module.exports = Peer
function Peer (exchange) {
  if (!(this instanceof Peer)) {
    return new Peer(exchange)
  }
  DuplexStream.call(this)

  this.socket = null
  this.mux = null
  this._exchange = exchange
  this._accepts = null
  this._exchangeChannel = null
  this._dataChannel = null
  this._receivedHello = false
  this._receivedHelloack = false
  this.ready = false

  this._error = this._error.bind(this)

  this.on('ready', () => {
    this._exchangeChannel.on('message:getPeer', this._onGetPeer.bind(this))
    this._exchangeChannel.on('message:incoming', this._onIncoming.bind(this))
  })
}
util.inherits(Peer, DuplexStream)

Peer.prototype._read = function (size) {
  if (!this._dataChannel) {
    throw new Error('_read called before connection was ready')
  }
  this._dataChannel.resume()
}

Peer.prototype._write = function (chunk, encoding, cb) {
  if (!this._dataChannel) {
    return cb(new Error('_write called before connection was ready'))
  }
  try {
    this._dataChannel.write(chunk, encoding)
  } catch (err) {
    return cb(err)
  }
  cb()
}

Peer.prototype._error = function (err) {
  this.destroy()
  this.emit('error', err)
}

Peer.prototype.connect = function (socket) {
  if (!socket || !socket.readable || !socket.writable) {
    throw new Error('Must specify a connected duplex stream socket')
  }
  this.socket = socket
  this.socket.on('error', this._error)
  this.socket.on('close', () => this.emit('close'))

  this.mux = mux()
  this.mux.on('error', this._error)
  this.mux.pipe(this.socket).pipe(this.mux)

  this._exchangeChannel = this.createObjectChannel('pxp')
  this._exchangeChannel.on('data', (data) => this._exchangeChannel.emit('message:' + data.command, data))

  this._dataChannel = this.createChannel('data')
  this._dataChannel.on('data', (data) => {
    if (!this.push(data)) {
      this._dataChannel.pause()
    }
  })
  this._dataChannel.on('end', () => this.push(null))

  this._exchangeChannel.on('message:hello', this._onHello.bind(this))
  this._exchangeChannel.on('message:helloack', this._onHelloack.bind(this))
  this._sendHello()
}

Peer.prototype._sendHello = function () {
  var accepts = {}
  for (var transportId in this._exchange._accepts) {
    accepts[transportId] = this._exchange._accepts[transportId].opts || true
  }

  this._exchangeChannel.write({
    command: 'hello',
    id: this._exchange.id,
    version: PROTOCOL_VERSION,
    accepts,
    transports: Object.keys(this._exchange._transports),
    senderAddresses: this._exchange._localAddresses,
    receiverAddress: this.socket.remoteAddress
  })
}

Peer.prototype._onHello = function (message) {
  if (this._receivedHello) {
    return this._error(new Error('Received a duplicate "hello" message'))
  }
  if (typeof message !== 'object') {
    return this._error(new Error('Invalid hello message'))
  }
  if (message.id !== this._exchange.id) {
    return this._error(new Error('Peer\'s network id ("' + message.id + '") ' +
      'is different than ours ("' + this._exchange.id + '")'))
  }
  if (message.version !== PROTOCOL_VERSION) {
    return this._error(new Error('Peer is using a different protocol version ' +
      '(theirs: ' + message.version + ', ours: ' + PROTOCOL_VERSION + ')'))
  }
  this._receivedHello = true
  for (var transportId in message.accepts) {
    if (this._exchange._acceptPeers[transportId]) {
      this._exchange._acceptPeers[transportId].push(this)
    }
  }
  this._transports = message.transports
  // TODO: get addresses from peer
  this.remoteAddress = getRemoteAddress(this.socket)
  this._accepts = message.accepts

  this._exchangeChannel.write({ command: 'helloack' })
  // TODO: connect to peer via other transports to verify accepts are valid
  // TODO?: authenticate each reachable address, so nodes can't spam someone else's address
  this._maybeReady()
}

Peer.prototype._onHelloack = function (message) {
  if (this._receivedHelloack) {
    return this._error(new Error('Received a duplicate "helloack" message'))
  }
  this._receivedHelloack = true
  this._maybeReady()
}

Peer.prototype._maybeReady = function () {
  if (this._receivedHello && this._receivedHelloack) {
    this.ready = true
    this.emit('ready')
  }
}

Peer.prototype.onReady = function (cb) {
  if (this.ready) return cb()
  this.once('ready', cb)
}

Peer.prototype.createObjectChannel = function (id, opts) {
  var muxStream = this.createChannel(id, opts)

  var parse = ndjson.parse()
  muxStream.pipe(parse)

  var serialize = ndjson.serialize()
  serialize.pipe(muxStream)

  var channel = duplexify(serialize, parse)
  channel.on('error', this._error)
  return channel
}

Peer.prototype.createChannel = function (id, opts) {
  var channel = this.mux.createSharedStream(id, opts)
  channel.on('error', this._error)
  return channel
}

Peer.prototype.getNewPeer = function (cb) {
  var reqId = hat()
  this._exchangeChannel.once(`message:${reqId}`, (message) => {
    if (!message.transport || !message.address) {
      return cb(new Error('Peer does not have any peers to exchange'))
    }
    var transport = this._exchange._transports[message.transport]
    var relay = this.createObjectChannel('relay:' + message.nonce)
    // TODO: support multiple addresses (so we can try to find best one)
    transport.connect(message.address, message.opts, relay, (err, socket) => {
      if (err) return cb(err)
      var peer = this._exchange._onConnection(socket, true)
      peer.onReady(() => cb(null, peer))
    })
  })
  this._exchangeChannel.write({
    command: 'getPeer',
    reqId
  })
}

Peer.prototype._onGetPeer = function (message) {
  // select from our peers who are accepting connections
  var exchange = this._exchange
  var acceptPeers = {}
  for (let transportId in exchange._acceptPeers) {
    if (this._transports.indexOf(transportId) === -1) continue
    acceptPeers[transportId] = exchange._acceptPeers[transportId].slice(0)
    // ensure we don't send the requesting peer to itself
    var selfIndex = acceptPeers[transportId].indexOf(this)
    if (selfIndex !== -1) acceptPeers[transportId].splice(selfIndex, 1)
    if (acceptPeers[transportId].length === 0) delete acceptPeers[transportId]
  }
  var transports = Object.keys(acceptPeers)
  if (transports.length === 0) {
    // if we have no accepting peers for any compatible transports,
    // send null response
    return this._exchangeChannel.write({
      command: message.reqId,
      transport: null,
      opts: null,
      address: null
    })
  }
  // select random transport that has valid accepting peers
  var transportId = getRandom(transports)
  var peers = acceptPeers[transportId]
  // select random peer
  var peer = getRandom(peers)
  var nonce = hat()

  if (this._exchange._transports[transportId].onIncoming) {
    // set up a relay stream between the requesting peer and selected peer, to
    // facilitate signaling, NAT traversal, etc
    this._createRelay(peer, transportId, nonce)

    // notify selected peer about incoming connection/relay
    peer._exchangeChannel.write({
      command: 'incoming',
      nonce,
      transport: transportId
    })
  }

  this._exchangeChannel.write({
    command: message.reqId,
    transport: transportId,
    opts: peer._accepts[transportId],
    address: peer.remoteAddress,
    nonce
  })
}

Peer.prototype._createRelay = function (destinationPeer, transportId, nonce) {
  var stream1 = this.createChannel('relay:' + nonce)
  var stream2 = destinationPeer.createChannel('relay:' + nonce)
  stream1.pipe(stream2).pipe(stream1)

  var closeRelay = () => {
    stream1.end()
    stream2.end()
  }
  this.once('close', closeRelay)
  destinationPeer.once('close', closeRelay)
  this._relayTimeout = setTimeout(closeRelay, 30 * 1000) // close relay after 30s
}

Peer.prototype._onIncoming = function (message) {
  var transport = this._exchange._transports[message.transport]
  var relay = this.createObjectChannel('relay:' + message.nonce)
  transport.onIncoming(relay, (err, socket) => {
    if (err) return this._error(err)
    this._exchange._onConnection(socket)
  })
}

Peer.prototype.sendAccept = function () {
  // TODO
}

Peer.prototype.sendUnaccept = function () {
  // TODO
}

Peer.prototype.destroy = function () {
  this.socket.destroy()
  clearTimeout(this._relayTimeout)
}

function getRandom (array) {
  return array[Math.floor(Math.random() * array.length)]
}

// HACK: recursively looks for socket property that has a remote address
function getRemoteAddress (socket) {
  if (socket.remoteAddress) return socket.remoteAddress
  if (socket.socket) {
    let address = getRemoteAddress(socket.socket)
    if (address) return address
  }
  if (socket._socket) {
    let address = getRemoteAddress(socket._socket)
    if (address) return address
  }
}
