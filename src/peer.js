'use strict'

const EventEmitter = require('events')
const { isDuplex } = require('isstream')
const old = require('old')
const mux = require('multiplex')
const pxp = require('./pxp.js')
const random = require('hat')
const onObject = require('on-object')
const assign = require('object-assign')

const PROTOCOL_VERSION = 1
const CANDIDATE_TIMEOUT = 15 * 1000

class Peer extends EventEmitter {
  constructor (socket, networks, connectInfo) {
    if (!isDuplex(socket)) {
      throw new Error('socket must be a duplex stream')
    }
    super()

    this.error = this.error.bind(this)

    this.connectInfo = connectInfo
    this.networks = networks
    this.candidates = {}
    this.closed = false
    this.ready = false
    this.connected = {}
    this.remoteNetworks = null
    this.remoteConnectInfo = null

    this.socket = socket
    onObject(socket).on({
      error: this.error,
      close: this.close.bind(this),
      disconnect: this.close.bind(this)
    })

    this.mux = mux(this.onStream)
    socket.pipe(this.mux).pipe(socket)

    this.pxp = pxp(this.createStream('pxp'))
    this.pxp.once('hello', this.onHello.bind(this))
    this.sendHello()
  }

  onceReady (f) {
    if (this.ready) return f()
    this.once('ready', f)
  }

  selfIsAccepting () {
    return !!this.connectInfo
  }

  isAccepting () {
    return !!this.remoteConnectInfo
  }

  error (err) {
    this.emit('error', err)
    this.close()
  }

  close () {
    if (this.closed) return
    this.closed = true
    this.emit('disconnect')
    this.socket.destroy()
    for (let clear of this.timers) clear()
  }

  createStream (id) {
    var stream = this.mux.createSharedStream(id)
    stream.on('error', this.error)
    return stream
  }

  getConnectInfo () {
    var connectInfo = assign({}, this.remoteConnectInfo)
    connectInfo.pxp = true
    return connectInfo
  }

  sendHello () {
    this.pxp.send('hello',
      PROTOCOL_VERSION,
      this.connectInfo,
      Object.keys(this.networks)
    )
  }

  onHello ([ version, connectInfo, networks ]) {
    if (version !== PROTOCOL_VERSION) {
      let err = new Error('Peer has an invalid protocol version.' +
        `theirs=${version}, ours=${PROTOCOL_VERSION}`)
      return this.error(err)
    }
    this.remoteNetworks = networks
    this.remoteConnectInfo = connectInfo
    onObject(this.pxp).on({
      getpeers: this.onGetPeers.bind(this),
      relay: this.onRelay.bind(this),
      upgrade: this.onUpgrade.bind(this)
    })
    if (this.selfIsAccepting()) {
      this.pxp.on('incoming', this.onIncoming.bind(this))
    }
    this.ready = true
    this.emit('ready')
  }

  onGetPeers (network, res) {
    if (!this.networks[network]) {
      let err = new Error('Peer requested an unknown network:' +
          `"${network}"`)
      return this.error(err)
    }
    var getPeers = this.networks[network]
    getPeers((err, peers) => {
      if (err) return this.error(err)
      peers = peers.filter((p) => p !== this)
      var peerInfo = peers.map((peer) => {
        var id = this.addCandidate(peer)
        return [ id, peer.getConnectInfo() ]
      })
      res(null, peerInfo)
    })
  }

  addCandidate (peer) {
    var id = random(32)
    this.candidates[id] = peer
    var timer = setTimeout(
      () => delete this.candidates[id],
      CANDIDATE_TIMEOUT)
    if (timer.unref) timer.unref()
    // TODO: cleanup timeouts on peer close
    return id
  }

  onRelay ([ network, to ], res) {
    // TODO: rate limiting
    // TODO: ensure there isn't already a relay to this destination
    var sourceStream = this.createStream(`relay:${to}`)
    var dest = this.candidates[to]
    if (!dest) {
      let err = new Error('Peer requested unknown candidate: ' +
        `network=${network},id=${to}`)
      res(err.message)
      return this.error(err)
    }
    var connectRelay = (destStream) => {
      sourceStream.pipe(destStream).pipe(sourceStream)
      sourceStream.once('end', () => destStream.end())
      destStream.once('end', () => sourceStream.end())
      res(null)
    }
    if (dest instanceof Peer) {
      let id = random(32)
      dest.pxp.send('incoming', [ id ], () => {
        var destStream = dest.createStream(`relay:${id}`)
        connectRelay(destStream)
      })
    } else if (typeof dest === 'function') {
      var destStream = dest()
      connectRelay(destStream)
    }
  }

  onIncoming ([ id ], res) {
    var stream = this.createStream(`relay:${id}`)
    this.emit('incoming', stream)
    res()
  }

  onUpgrade ([ transport, data ]) {
    this.emit('upgrade', transport, data)
  }

  onConnect (network, res) {
    if (this.connected[network]) {
      var err = new Error('Peer tried to connect to network ' +
        `"${network}" twice`)
      return this.error(err)
    }
    var stream = this.createDataStream(network, res)
    this.emit(`connect:${network}`, stream)
    res()
  }

  createDataStream (network) {
    this.connected[network] = true
    var stream = this.createStream(`data:${network}`)
    stream.once('end', () => delete this.connected[network])
    return stream
  }

  connect (network, cb) {
    if (this.connected[network]) {
      let err = new Error(`Already connected for network "${network}"`)
      return cb(err)
    }
    var stream = this.createDataStream(network)
    this.pxp.send('connect', network, () => {
      cb(null, stream)
    })
  }

  getPeers (network, cb) {
    this.pxp.send('getpeers', network, ([ err, peers ]) => {
      if (err) return cb(new Error(err))
      if (!Array.isArray(peers)) {
        let err = new Error('Peer sent invalid response to "getpeers"')
        return cb(err)
      }
      if (peers.length === 0) {
        let err = new Error('Got empty reponse for "getpeers"')
        return cb(err)
      }
      cb(null, peers)
    })
  }

  relay (network, to, cb) {
    this.pxp.send('relay', [ network, to ], (err) => {
      if (err) return cb(new Error(err))
      var relay = this.createStream(`relay:${to}`)
      cb(null, relay)
    })
  }
}

module.exports = old(Peer)
