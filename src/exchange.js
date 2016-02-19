var EventEmitter = require('events')
var util = require('util')
var getBrowserRTC = require('get-browser-rtc')
var Peer = require('./peer.js')
var transports = require('./transports.js')

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
  // TODO
}

Exchange.prototype.connect = function (transportId, address, cb) {
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    return cb(new Error('Transport "' + transportId + '" not found'))
  }
  var connect = this._transports[transportId]
  connect(address, null, (err, socket) => {
    if (err) return cb(err)
    var peer = new Peer(socket, { accepts: this._accepts })
    // TODO: wait for peer handshake, then call cb
  })
}

Exchange.prototype._getLocalAddresses = function (cb) {
  // TODO: get all local addresses across all peers
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
    peer.unaccept(transport)
  }
  var unaccept = this._accepts[transport].unaccept
  delete this._accepts[transport]
  unaccept()
}
