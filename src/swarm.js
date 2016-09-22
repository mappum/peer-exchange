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
    this.peers = []
    this.allowIncoming = opts.allowIncoming != null
      ? opts.allowIncoming : true
    this.wrtc = opts.wrtc || wrtc
    if (!this.wrtc) {
      throw new Error('No WebRTC implementation found, please pass one in ' +
        ' as the "wrtc" option (for example, the "wrtc" or ' +
        '"electron-webrtc" packages).')
    }
    if (this.allowIncoming) {
      this.connectInfo = {
        pxp: true,
        relay: true,
        webrtc: true
      }
    }
    this.ready = false
    this.error = this.error.bind(this)
  }

  error (err) {
    this.emit('error', err)
  }

  _addPeer (peer) {
    this.peers.push(peer)
    onObject(peer).once({
      disconnect: () => {
        var index = this.peers.indexOf(peer)
        if (index === -1) return
        this.peers.splice(index, 1)
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
        if (err) return this.error(err)
        this.emit('connect', stream, peer)
      })
    }
    if (this.allowIncoming) {
      peer.on('incoming', (relay) => {
        debug('adding incoming peer')
        var incomingPeer = this.createPeer(relay, {
          incoming: true,
          relayed: true
        })
        incomingPeer.on('upgrade', (...args) =>
          this.onUpgrade(incomingPeer, ...args))
        this._addPeer(incomingPeer)
      })
    }
    this.emit('peer', peer)
  }

  connect (stream, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    var peer = this.createPeer(stream, opts)
    if (cb) peer.once('error', cb)
    peer.onceReady(() => {
      if (cb) peer.removeListener('error', cb)
      this._addPeer(peer)
      if (cb) cb(null, peer)
    })
  }

  accept (stream, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts.incoming = true
    this.connect(stream, opts, cb)
  }

  createPeer (stream, opts = {}) {
    var networks = this.getNetworks()
    var connectInfo = this.getConnectInfo()
    var peer = Peer(stream, networks, connectInfo, {
      allowIncoming: this.allowIncoming
    })
    assign(peer, opts)
    return peer
  }

  getNetworks () {
    return { [this.networkId]: this.getPeers.bind(this) }
  }

  getPeers (cb) {
    cb(null, this.peers)
  }

  getConnectInfo () {
    return this.connectInfo
  }

  onUpgrade (oldPeer, { transport, offer }, res) {
    if (transport !== 'webrtc') {
      let err = new Error('Peer requested upgrade via unknown transport: ' +
        `"${transport}"`)
      res(err.message)
      return oldPeer.error(err)
    }
    debug(`upgrading peer: ${transport}`)
    var rtcConn = new RTCPeer({ wrtc: this.wrtc, trickle: false })
    rtcConn.signal(offer)
    rtcConn.once('signal', (answer) => {
      rtcConn.once('connect', () => {
        this.connect(rtcConn, { incoming: true }, (err) => {
          if (err) return this.error(err)
          oldPeer.close()
        })
      })
      res(null, answer)
    })
  }

  upgradePeer (oldPeer, cb) {
    var rtcConn = new RTCPeer({
      wrtc: this.wrtc,
      trickle: false,
      initiator: true
    })
    rtcConn.once('signal', (offer) => {
      rtcConn.once('connect', () => {
        this.connect(rtcConn, (err, newPeer) => {
          if (err) return cb(err)
          oldPeer.close()
          cb(null, newPeer)
        })
      })
      oldPeer.upgrade({
        transport: 'webrtc',
        offer
      }, (err, answer) => {
        if (err) return cb(err)
        rtcConn.signal(answer)
      })
    })
  }

  getNewPeer (cb) {
    if (this.peers.length === 0) {
      return cb(new Error('Not connected to any peers'))
    }
    // TODO: smarter selection
    var peer = this.peers[floor(random() * this.peers.length)]
    peer.getPeers(this.networkId, (err, candidates) => {
      if (err) return cb(err)
      var candidate = candidates[floor(random() * candidates.length)]
      if (candidate.connectInfo.pxp) {
        this.relayAndUpgrade(peer, candidate, cb)
      } else {
        this.relay(peer, candidate, cb)
      }
    })
  }

  relayAndUpgrade (peer, dest, cb) {
    cb = once(cb)
    peer.relay(dest, (err, relay) => {
      if (err) return cb(err)
      var relayPeer = this.createPeer(relay, { relayed: true })
      relayPeer.once('error', cb)
      this.upgradePeer(relayPeer, cb)
    })
  }

  relay (peer, dest, cb) {
    peer.relay(dest, (err, relay) => {
      if (err) return cb(err)
      this.emit('connect', relay)
    })
  }
}

module.exports = old(Swarm)
