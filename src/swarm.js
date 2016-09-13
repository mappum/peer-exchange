const EventEmitter = require('events')
const old = require('old')
const RTCPeer = require('simple-peer')
const wrtc = require('get-browser-rtc')()
const onObject = require('on-object')
const assign = require('object-assign')
const debug = require('debug')('peer-exchange:swarm')
const Peer = require('./peer.js')
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
    this.connectInfo = {}
    this.ready = false
    this.error = this.error.bind(this)

    this.initialize()
  }

  initialize () {
    var rtcInfoPeer = new RTCPeer({
      initiator: true,
      trickle: false,
      wrtc: this.wrtc
    })
    rtcInfoPeer.once('signal', (signal) => {
      this.connectInfo.webrtc = signal
      rtcInfoPeer.destroy()
      this.setReady()
    })
  }

  setReady () {
    debug('ready')
    this.ready = true
    this.emit('ready')
  }

  onceReady (f) {
    if (this.ready) return f()
    this.once('ready', f)
  }

  error (err) {
    this.emit('error', err)
  }

  // TODO: method to listen on HTTP server

  addPeer (peer) {
    this.peers.push(peer)
    onObject(peer).once({
      disconnect: () => {
        var index = this.peers.indexOf(peer)
        if (index === -1) return
        this.peers.splice(index, 1)
        this.emit('disconnect', peer)
      },
      error: this.error
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
    peer.on('upgrade', (...args) => this.onUpgrade(peer, ...args))
    if (this.allowIncoming) {
      peer.on('incoming', (relay) => {
        debug('adding incoming peer')
        var incomingPeer = this.createPeer(relay, {
          incoming: true,
          relay: true
        })
        this.addPeer(incomingPeer)
      })
    }
    this.emit('peer', peer)
  }

  connect (stream, incoming, cb) {
    if (typeof incoming === 'function') {
      cb = incoming
      incoming = false
    }
    if (!cb) cb = (err) => { if (err) this.emit('connectError', err) }
    this.onceReady(() => {
      var peer = this.createPeer(stream, { incoming })
      peer.once('error', cb)
      peer.onceReady(() => {
        peer.removeListener('error', cb)
        this.addPeer(peer)
        cb(null, peer)
      })
    })
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

  onUpgrade (oldPeer, transport, connectInfo) {
    if (transport !== 'webrtc') {
      let err = new Error('Peer requested upgrade via unknown transport: ' +
        `"${transport}"`)
      return oldPeer.error(err)
    }
    debug(`upgrading peer: ${transport}`)
    var stream = new RTCPeer({ wrtc: this.wrtc })
    stream.signal(connectInfo)
    this.connect(stream, true, (err) => {
      if (err) return this.error(err)
      oldPeer.close()
    })
  }

  upgradePeer (peer, cb) {

  }

  getNewPeer (cb) {
    this.onceReady(() => {
      if (this.peers.length === 0) {
        return cb(new Error('Not connected to any peers'))
      }
      // TODO: smarter selection
      var peer = this.peers[floor(random() * this.peers.length)]
      peer.getPeers(this.networkId, (err, peers) => {
        if (err) return cb(err)
        peer.relay(this.networkId, peers[0][0], (err, relay) => {
          if (err) return cb(err)
          this.connect(relay, cb)
        })
      })
    })
  }
}

module.exports = old(Swarm)
