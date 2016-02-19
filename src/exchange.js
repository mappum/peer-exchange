var EventEmitter = require('events')
var util = require('util')
var getBrowserRTC = require('get-browser-rtc')
var Peer = require('./peer.js')
var transports = require('./transports.js')

module.exports = Exchange
function Exchange (id, opts) {
  if (!id || typeof id !== 'string') {
    throw new Error('A network id must be specified')
  }
  if (!(this instanceof Exchange)) {
    return new Exchange(opts)
  }
  EventEmitter.call(this)

  opts = opts || {}
  this._wrtc = opts.wrtc || getBrowserRTC()

  this._transports = opts.transports
  if (!opts.transports) {
    this._transports = { websocket: transports.websocket }
    if (this._wrtc) {
      this._transports.webrtc = transports.webrtc({ wrtc: this._wrtc })
    }
    // TODO: add TCP as a default transport for Node.js clients
  }

  this.id = id
  this.peers = []
  this._accepts = {}
}
util.inherits(Exchange, EventEmitter)

Exchange.prototype.getNewPeer = function (cb) {
  if (this.peers.length === 0) {
    return cb(new Error('Not connected to any peers. Connect to some seeds manually.'))
  }
  var peer = this.peers[Math.floor(Math.random() * this.peers.length)]
  peer.getNewPeer(cb)
}

Exchange.prototype.connect = function (transportId, address, cb) {
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    return cb(new Error('Transport "' + transportId + '" not found'))
  }
  var connect = this._transports[transportId].connect
  connect(address, null, (err, socket) => {
    if (err) return cb(err)
    var peer = this._createPeer(socket)
    peer.on('ready', () => cb(null, peer))
  })
}

Exchange.prototype._createPeer = function (socket) {
  var peer = new Peer(socket, this.id, { accepts: this._accepts })
  peer.on('error', (err) => {
    this.emit('peerError', err, peer)
    this.removePeer(peer)
  })
  return peer
}

Exchange.prototype.accept = function (transportId, opts) {
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    throw new Error('Transport "' + transportId + '" not found')
  }
  if (this._accepts[transportId]) {
    throw new Error('Already accepting with "' + transportId + '" transport')
  }
  var transport = this._transports[transportId]
  if (transport.accept) {
    var unaccept = transport.accept(opts)
    if (typeof unaccept !== 'function') {
      throw new Error('Transport\'s "accept" function must return a cleanup function')
    }
  }
  this._accepts[transportId] = { opts, unaccept }
  for (var peer of this.peers) {
    peer.sendAccept(transportId, opts)
  }
}

Exchange.prototype.unaccept = function (transport) {
  for (var peer of this.peers) {
    peer.sendUnaccept(transport)
  }
  var unaccept = this._accepts[transport].unaccept
  delete this._accepts[transport]
  unaccept()
}

Exchange.prototype.removePeer = function (peer) {
  peer.destroy()
  for (var i = 0; i < this.peers.length; i++) {
    if (this.peers[i] === peer) {
      this.peers.splice(i, 1)
      return true
    }
  }
  return false
}

Exchange.prototype._error = function (err) {
  this.emit('error', err)
}

Exchange.prototype._getLocalAddresses = function (cb) {
  // TODO: get all local addresses across all peers
}
