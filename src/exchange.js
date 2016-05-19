'use strict'

var EventEmitter = require('events')
var util = require('util')
var getBrowserRTC = require('get-browser-rtc')
var once = require('once')
var Peer = require('./peer.js')
var transports = require('./transports.js')
try {
  var net = require('net')
} catch (err) {}
var remove = require('./util.js').remove

module.exports = Exchange
function Exchange (id, opts) {
  if (!id || typeof id !== 'string') {
    throw new Error('A network id must be specified')
  }
  if (!(this instanceof Exchange)) {
    return new Exchange(id, opts)
  }
  EventEmitter.call(this)

  opts = opts || {}
  var wrtc = opts.wrtc || getBrowserRTC()

  this._transports = opts.transports
  if (!opts.transports) {
    this._transports = { websocket: transports.websocket }
    if (wrtc) {
      this._transports.webrtc = transports.webrtc({ wrtc })
    }
    if (net) {
      this._transports.tcp = transports.tcp
    }
  }

  this.id = id
  this.peers = []
  this._accepts = {}

  // lists of peers accepting connections, indexed by transport
  this._acceptPeers = {}
  for (var transportId in this._transports) {
    this._acceptPeers[transportId] = []
  }
}
util.inherits(Exchange, EventEmitter)

Exchange.prototype.getNewPeer = function (cb) {
  cb = cb || ((err) => { if (err) this._error(err) })
  if (this.peers.length === 0) {
    return cb(new Error('Not connected to any peers. Connect to some seeds manually.'))
  }
  var peer = this.peers[Math.floor(Math.random() * this.peers.length)]
  peer.getNewPeer(cb)
}

Exchange.prototype.connect = function (transportId, address, opts, cb) {
  cb = once(cb || ((err) => { if (err) this._error(err) }))
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    return cb(new Error(`Transport "${transportId}" not found`))
  }
  var connect = this._transports[transportId].connect
  connect(address, opts, null, once((err, socket) => {
    if (err) return cb(err)
    socket.transport = transportId
    var peer = this._onConnection(socket, true)
    peer.once('error', cb)
    peer._onReady(() => cb(null, peer))
  }))
}

Exchange.prototype._createPeer = function (socket, outgoing) {
  var peer = new Peer(this)
  peer.incoming = !outgoing
  peer.transport = socket.transport
  peer.once('error', (err) => {
    this.removePeer(peer)
    this.emit('peerError', err, peer)
  })
  peer.once('close', () => {
    this.removePeer(peer)
    this.emit('disconnect', peer)
  })
  peer._connect(socket)
  return peer
}

Exchange.prototype.accept = function (transportId, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  cb = cb || ((err) => { if (err) this._error(err) })
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    return cb(new Error(`Transport "${transportId}" not found`))
  }
  var alreadyAcceptingError = new Error(`Already accepting with "${transportId}" transport`)
  if (this._accepts[transportId]) return cb(alreadyAcceptingError)
  var transport = this._transports[transportId]
  var register = (unaccept) => {
    if (this._accepts[transportId]) {
      if (unaccept) unaccept()
      return cb(alreadyAcceptingError)
    }

    this._accepts[transportId] = { opts, unaccept }
    for (var peer of this.peers) {
      peer._sendAccept(transportId, opts)
    }
    cb(null)
  }
  if (transport.accept) {
    var onConnection = (socket) => {
      socket.transport = transportId
      this._onConnection(socket)
    }
    transport.accept(opts, onConnection, (err, unaccept) => {
      if (err) return cb(err)
      if (typeof unaccept !== 'function') {
        return cb(new Error('Transport\'s "accept" function must return a cleanup function'))
      }
      register(unaccept)
    })
  } else {
    register()
  }
}

Exchange.prototype._onConnection = function (socket, outgoing) {
  var peer = this._createPeer(socket, outgoing)
  this.addPeer(peer)
  return peer
}

Exchange.prototype.unaccept = function (transport, cb) {
  for (var peer of this.peers) {
    peer._sendUnaccept(transport)
  }
  var unaccept = this._accepts[transport].unaccept
  delete this._accepts[transport]
  if (unaccept) unaccept()
  if (cb) cb()
}

Exchange.prototype.addPeer = function (peer) {
  peer._onReady(() => {
    this.peers.push(peer)
    this.emit('peer', peer)
  })
}

Exchange.prototype.removePeer = function (peer) {
  peer.destroy()
  if (peer._accepts) {
    for (var transportId of Object.keys(peer._accepts)) {
      if (!this._acceptPeers[transportId]) continue
      remove(this._acceptPeers[transportId], peer)
    }
  }
  return remove(this.peers, peer)
}

Exchange.prototype.close = function (cb) {
  cb = cb || (() => {})
  for (var peer of this.peers) {
    peer.destroy()
  }
  for (var transportId in this._accepts) {
    this.unaccept(transportId)
  }
  cb(null)
}

Exchange.prototype._error = function (err) {
  this.emit('error', err)
}
