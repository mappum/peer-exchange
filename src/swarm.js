const EventEmitter = require('events')
const old = require('old')
const RTCPeer = require('simple-peer')
const wrtc = require('get-browser-rtc')()
const onObject = require('on-object')
const assign = require('object-assign')
const debug = require('debug')('peer-exchange')
const once = require('once')
const Peer = require('pxp')
const { floor, random } = Math

class Swarm extends EventEmitter {
  constructor (networkId, opts = {}) {
    if (!networkId || typeof networkId !== 'string') {
      throw new Error('networkId must be a string')
    }
    super()
    this.networkId = networkId
    this._peers = []
    this.closed = false
    this.allowIncoming = opts.allowIncoming != null
      ? opts.allowIncoming : true
    this.wrtc = opts.wrtc || wrtc
    if (!this.wrtc) {
      throw new Error('No WebRTC implementation found, please pass one in ' +
        ' as the "wrtc" option (for example, the "wrtc" or ' +
        '"electron-webrtc" packages).')
    }
    this.rtcConfig = opts.rtcConfig
    if (opts.getPeers) this._getPeers = opts.getPeers
    if (this.allowIncoming) {
      this.connectInfo = {
        pxp: true,
        relay: true,
        webrtc: true
      }
    }
    this._error = this._error.bind(this)
  }

  _error (err) {
    this.emit('error', err)
  }

  _addPeer (peer) {
    this._peers.push(peer)
    onObject(peer).once({
      disconnect: () => {
        var index = this._peers.indexOf(peer)
        if (index === -1) return
        this._peers.splice(index, 1)
        this.emit('disconnect', peer)
      },
      error: (err) => this.emit('peerError', err, peer)
    })
    if (peer.incoming) {
      peer.once(`connect:${this.networkId}`, (stream) => {
        this.emit('connect', stream, peer)
      })
    } else {
      peer.connect(this.networkId, (err, stream) => {
        if (err) return this._error(err)
        this.emit('connect', stream, peer)
      })
    }
    if (this.allowIncoming) {
      peer.on('incoming', (relay) => {
        debug('adding incoming peer')
        var incomingPeer = this._createPeer(relay, {
          incoming: true,
          relayed: true
        })
        incomingPeer.once('upgrade', (...args) =>
          this._onUpgrade(incomingPeer, ...args))
        this._addPeer(incomingPeer)
      })
    }
    this.emit('peer', peer)
  }

  connect (stream, opts, cb) {
    if (this.closed) {
      return cb(new Error('Swarm is closed'))
    }
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    var peer = this._createPeer(stream, opts)
    if (cb) peer.once('error', cb)
    peer.onceReady(() => {
      if (cb) peer.removeListener('error', cb)
      this._addPeer(peer)
      peer.once(`connect:${this.networkId}`, (conn) => {
        conn.pxpPeer = peer
        if (cb) cb(null, conn)
      })
    })
  }

  accept (stream, opts = {}, cb) {
    if (this.closed) {
      return cb(new Error('Swarm is closed'))
    }
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts.incoming = true
    this.connect(stream, opts, cb)
  }

  _createPeer (stream, opts = {}) {
    var networks = this._getNetworks()
    var connectInfo = this._getConnectInfo()
    var peer = Peer(stream, networks, connectInfo, {
      allowIncoming: this.allowIncoming
    })
    assign(peer, opts)
    return peer
  }

  _getNetworks () {
    return { [this.networkId]: this._getPeers.bind(this) }
  }

  _getPeers (cb) {
    // TODO: limit to random selection
    cb(null, this._peers)
  }

  _getConnectInfo () {
    return this.connectInfo
  }

  _onUpgrade (oldPeer, { transport, signal }) {
    if (transport !== 'webrtc') {
      let err = new Error('Peer requested upgrade via unknown transport: ' +
        `"${transport}"`)
      return oldPeer.error(err)
    }
    debug(`upgrading peer: ${transport}`)
    var rtcConn = new RTCPeer({ wrtc: this.wrtc, config: this.rtcConfig })
    this._signalRTC(oldPeer, rtcConn, () => {
      this.accept(rtcConn, (err) => {
        if (err) return this._error(err)
        oldPeer.close()
      })
    })
    rtcConn.signal(signal)
  }

  _upgradePeer (oldPeer, cb) {
    var rtcConn = new RTCPeer({
      wrtc: this.wrtc,
      initiator: true,
      config: this.rtcConfig
    })
    this._signalRTC(oldPeer, rtcConn, (err) => {
      if (err) return cb(err)
      this.connect(rtcConn, (err, newPeer) => {
        if (err) return cb(err)
        oldPeer.close()
        cb(null, newPeer)
      })
    })
  }

  _signalRTC (peer, conn, cb) {
    cb = once(cb)
    conn.once('connect', () => cb(null))
    conn.once('error', (err) => cb(err))
    peer.on('upgrade', ({ signal }) => {
      conn.signal(signal)
    })
    conn.on('signal', (signal) => {
      peer.upgrade({ transport: 'webrtc', signal })
    })
  }

  getNewPeer (cb) {
    cb = cb || ((err) => { if (err) this._error(err) })
    if (this.closed) {
      return cb(new Error('Swarm is closed'))
    }
    if (this._peers.length === 0) {
      return cb(new Error('Not connected to any peers'))
    }
    // TODO: smarter selection
    var peer = this._peers[floor(random() * this._peers.length)]
    peer.getPeers(this.networkId, (err, candidates) => {
      if (err) return cb(err)
      if (candidates.length === 0) {
        return cb(new Error('Peer did not return any candidates'))
      }
      var candidate = candidates[floor(random() * candidates.length)]
      if (candidate.connectInfo.pxp) {
        this._relayAndUpgrade(peer, candidate, cb)
      } else {
        this._relay(peer, candidate, cb)
      }
    })
  }

  _relayAndUpgrade (peer, dest, cb) {
    cb = once(cb)
    peer.relay(dest, (err, relay) => {
      if (err) return cb(err)
      var relayPeer = this._createPeer(relay, { relayed: true })
      relayPeer.once('error', cb)
      this._upgradePeer(relayPeer, cb)
    })
  }

  _relay (peer, dest, cb) {
    peer.relay(dest, (err, relay) => {
      if (err) return cb(err)
      this.emit('connect', relay)
      return cb(null, relay)
    })
  }

  close () {
    this.closed = true
    for (let peer of this._peers) peer.close()
  }

  get peers () {
    return this._peers.slice(0)
  }
}

module.exports = old(Swarm)
