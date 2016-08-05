'use strict'

var DuplexStream = require('stream').Duplex
var util = require('util')
var duplexify = require('duplexify').obj
var mux = require('multiplex')
var ndjson = require('ndjson')
var hat = require('hat')
var u = require('./util.js')

var PROTOCOL_VERSION = 1

// TODO: support arbitrary streams to mux many protocols across one peer connection
module.exports = Peer
function Peer (exchange, opts = {}) {
  if (!(this instanceof Peer)) {
    return new Peer(exchange)
  }
  DuplexStream.call(this)

  this.selectPeer = opts.selectPeer || this._selectPeer

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
    this._exchangeChannel.on('message:accept', this._onAccept.bind(this))
    this._exchangeChannel.on('message:unaccept', this._onUnaccept.bind(this))
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

Peer.prototype._connect = function (socket) {
  if (!socket || !socket.readable || !socket.writable) {
    throw new Error('Must specify a connected duplex stream socket')
  }
  this.socket = socket
  this.socket.on('error', this._error)
  this.socket.on('close', () => this.emit('close'))

  this.mux = mux()
  this.mux.on('error', this._error)
  this.mux.pipe(this.socket).pipe(this.mux)

  this._exchangeChannel = this._createObjectChannel('pxp')
  this._exchangeChannel.on('data', (data) => this._exchangeChannel.emit('message:' + data.command, data))

  this._dataChannel = this._createChannel('data')
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
  this.remoteAddress = u.getRemoteAddress(this.socket)
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

Peer.prototype._onAccept = function (message) {
  if (this._accepts[message.transport]) return
  if (!this._exchange._transports[message.transport]) return
  this._accepts[message.transport] = message.opts || true
  this._exchange._acceptPeers[message.transport].push(this)
}

Peer.prototype._onUnaccept = function (message) {
  if (!this._accepts[message.transport]) return
  if (!this._exchange._transports[message.transport]) return
  delete this._accepts[message.transport]
  u.remove(this._exchange._acceptPeers[message.transport], this)
}

Peer.prototype._maybeReady = function () {
  if (this._receivedHello && this._receivedHelloack) {
    this.ready = true
    this.emit('ready')
  }
}

Peer.prototype._onReady = function (cb) {
  if (this.ready) return cb()
  this.once('ready', cb)
}

Peer.prototype._createObjectChannel = function (id, opts) {
  var muxStream = this._createChannel(id, opts)

  var parse = ndjson.parse()
  muxStream.pipe(parse)

  var serialize = ndjson.serialize()
  serialize.pipe(muxStream)

  var channel = duplexify(serialize, parse)
  channel.on('error', this._error)
  return channel
}

Peer.prototype._createChannel = function (id, opts) {
  var channel = this.mux.createSharedStream(id, opts)
  channel.on('error', this._error)
  return channel
}

Peer.prototype.getNewPeer = function (cb) {
  var reqId = hat()
  this._exchangeChannel.once(`message:${reqId}`, (message) => {
    if (message.error) {
      return cb(new Error(message.error))
    }
    if (message.address == null) {
      return cb(new Error('Peer does not have any peers to exchange'))
    }
    if (Object.keys(message.accepts).length === 0) {
      return cb(new Error('No matching transports'))
    }

    var transports = []
    for (let transportId in this._exchange._transports) {
      if (message.accepts[transportId] == null) continue
      transports.push(transportId)
    }
    var transportId = u.getRandom(transports)
    var transport = this._exchange._transports[transportId]
    var opts = message.accepts[transportId]
    var relay = null
    if (transport.onIncoming) {
      relay = this._createObjectChannel('relay:' + reqId)
    }
    // TODO: support multiple addresses (so we can try to find best one)
    transport.connect(message.address, opts, relay, (err, socket) => {
      if (err) return cb(err)
      var peer = this._exchange._onConnection(socket, true)
      peer._onReady(() => cb(null, peer))
    })
    this._exchangeChannel.write({
      command: `connect:${reqId}`,
      transport: transportId
    })
  })
  this._exchangeChannel.write({
    command: 'getPeer',
    reqId
  })
}

Peer.prototype._onGetPeer = function (getPeerMsg) {
  var respond = (err, peer) => {
    this._exchangeChannel.write({
      command: getPeerMsg.reqId,
      accepts: peer ? peer._accepts : null,
      address: peer ? peer.remoteAddress : null,
      error: err ? err.getPeerMsg : null
    })
  }
  this.selectPeer((err, peer) => {
    if (err) return respond(err)
    var reqId = getPeerMsg.reqId

    // handle connect event if requesting peer chooses to connect
    var onConnect = (connectMsg) => {
      if (peer._accepts[connectMsg.transport] == null) return

      // set up a relay stream between the requesting peer and selected peer, to
      // facilitate signaling, NAT traversal, etc
      this._createRelay(peer, connectMsg.transport, reqId)

      if (!(peer instanceof Peer)) return

      // notify selected peer about incoming connection/relay
      peer._exchangeChannel.write({
        command: 'incoming',
        id: reqId,
        transport: connectMsg.transport
      })
    }
    this._exchangeChannel.once(`message:connect:${reqId}`, onConnect)
    var timeout = setTimeout(() => {
      this._exchangeChannel.removeListener(`message:connect:${reqId}`, onConnect)
    }, 30 * 1000)
    if (timeout.unref) timeout.unref()

    if (!(peer instanceof Peer)) {
      respond(null, {
        _accepts: { relay: true },
        remoteAddress: peer.remoteAddress
      })
    } else {
      respond(err, peer)
    }
  })
}

Peer.prototype._selectPeer = function (cb) {
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
    return cb(new Error('No peers available'))
  }
  // select random transport that has valid accepting peers
  var transportId = u.getRandom(transports)
  var peers = acceptPeers[transportId]
  // select random peer
  var peer = u.getRandom(peers)
  cb(null, peer)
}

Peer.prototype._createRelay = function (destinationPeer, transportId, id) {
  var stream1 = this._createChannel('relay:' + id)

  var stream2
  if (transportId === 'relay') stream2 = destinationPeer
  else stream2 = destinationPeer._createChannel('relay:' + id)

  stream1.pipe(stream2).pipe(stream1)

  var closeRelay = () => {
    stream1.end()
    stream2.end()
  }
  this.once('close', closeRelay)
  destinationPeer.once('close', closeRelay)
  if (transportId !== 'relay') {
    this._relayTimeout = setTimeout(closeRelay, 30 * 1000) // close relay after 30s
  }
}

Peer.prototype._onIncoming = function (message) {
  var transport = this._exchange._transports[message.transport]
  var relay = this._createObjectChannel('relay:' + message.id)
  transport.onIncoming(relay, (err, socket) => {
    if (err) return this._error(err)
    this._exchange._onConnection(socket)
  })
}

Peer.prototype._sendAccept = function (id, opts) {
  this._exchangeChannel.write({
    command: 'accept',
    transport: id,
    opts
  })
}

Peer.prototype._sendUnaccept = function (id) {
  this._exchangeChannel.write({
    command: 'unaccept',
    transport: id
  })
}

Peer.prototype.destroy = function () {
  this.socket.destroy()
  if (this._relayTimeout != null) {
    clearTimeout(this._relayTimeout)
    this._relayTimeout = null
  }
}
