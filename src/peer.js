'use strict'

const EventEmitter = require('events')
const { isDuplex } = require('isstream')
const old = require('old')
const mux = require('multiplex')
const pxp = require('./pxp.js')
const random = require('hat')

const PROTOCOL_VERSION = 1
const CANDIDATE_TIMEOUT = 15 * 1000

class Peer extends EventEmitter {
  constructor (socket, networks, connectInfo) {
    if (!isDuplex(socket)) {
      throw new Error('socket must be a duplex stream')
    }
    super({ objectMode: true })

    this.error = this.error.bind(this)

    this.connectInfo = connectInfo
    this.networks = networks
    this.candidates = {}
    this.closed = false
    this.remoteNetworks = null
    this.remoteConnectInfo = null

    this.socket = socket
    socket.on('error', this.error)
    socket.on('close', this.onClose.bind(this))
    socket.on('disconnect', this.onClose.bind(this))

    this.mux = mux(this.onStream)
    socket.pipe(this.mux).pipe(socket)

    this.pxp = pxp(this.createStream('pxp'))
    this.pxp.once('hello', this.onHello.bind(this))
    this.sendHello()
  }

  selfIsAccepting () {
    return !!this.connectInfo
  }

  isAccepting () {
    return !!this.remoteConnectInfo
  }

  error (err) {
    this.emit('error', err)
    this.onClose()
  }

  onClose () {
    if (this.closed) return
    this.closed = true
    this.emit('disconnect')
    this.socket.destroy()
    this.clearTimers()
  }

  clearTimers () {
    for (let clear of this.timers) clear()
  }

  createStream (id) {
    var stream = this.mux.createSharedStream(id)
    stream.on('error', this.error)
    return stream
  }

  sendHello () {
    this.pxp.send('hello',
      PROTOCOL_VERSION,
      this.connectInfo,
      this.networks
    )
  }

  onHello ([ version, networks, connectInfo ]) {
    if (version !== PROTOCOL_VERSION) {
      let err = new Error('Peer has an invalid protocol version.' +
        `theirs=${version}, ours=${PROTOCOL_VERSION}`)
      return this.error(err)
    }
    this.remoteNetworks = networks
    this.remoteConnectInfo = connectInfo
    this.on('getpeers', this.onPeers.bind(this))
    this.on('relay', this.onRelay.bind(this))
    if (this.selfAccepting()) {
      this.on('incoming', this.onIncoming.bind(this))
    }
    this.emit('ready')
  }

  onPeers (network, res) {
    if (!this.networks.includes(network)) {
      let err = new Error('Peer requested an unknown network:' +
          `"${network}"`)
      return this.error(err)
    }
    var getPeers = this.networks[network]
    getPeers((err, peers) => {
      if (err) return this.error(err)
      var peerInfo = peers.map((peer) => {
        var id = this.addCandidate(network, peer)
        return [
          id,
          peer.remoteConnectInfo,
          peer.remoteNetworks[network]
        ]
      })
      res(peerInfo)
    })
  }

  addCandidate (network, peer) {
    var id = random()
    this.candidates[id] = peer
    var timer = setTimeout(
      () => delete this.candidates[id],
      CANDIDATE_TIMEOUT)
    if (timer.unref) timer.unref()
    // TODO: cleanup timeouts on peer close
    return id
  }

  onRelay ([ network, to ]) {
    // TODO: rate limiting
    // TODO: ensure there isn't already a relay to this destination
    var sourceStream = this.createStream(`relay:${to}`)
    var dest = this.candidates[to]
    if (!dest) {
      let err = new Error('Peer requested unknown candidate: ' +
        `network=${network},id=${to}`)
      return this.error(err)
    }
    var connectRelay = (destStream) => {
      sourceStream.pipe(destStream).pipe(sourceStream)
      sourceStream.once('end', () => destStream.end())
      destStream.once('end', () => sourceStream.end())
    }
    if (dest instanceof Peer) {
      let id = random()
      dest.send('incoming', [ id ], () => {
        var destStream = dest.createStream(`relay:${id}`)
        connectRelay(destStream)
      })
    } else if (typeof dest === 'function') {
      var destStream = dest()
      connectRelay(destStream)
    }
  }

  onIncoming ([ id ], res) {
    var relay = this.createStream(`relay:${id}`)
    var peer = new Peer(relay)
    peer.incoming = true
    this.emit('peer', peer)
    res()
  }

  getPeers (cb) {
    this.pxp.send('getpeers', cb)
  }
}

module.exports = old(Peer)
