var http = require('http')
var https = require('https')
var getBrowserRTC = require('get-browser-rtc')
var SimplePeer = require('simple-peer')
var Websocket = require('websocket-stream')
try {
  var net = require('net')
} catch (err) {}

function webrtc (opts) {
  var wrtc = opts.wrtc || getBrowserRTC()

  function createPeer (opts, relay, cb) {
    opts = Object.assign({ wrtc }, opts)
    var peer = new SimplePeer(opts)
    relay.on('data', (data) => peer.signal(data))
    peer.on('signal', (data) => relay.write(data))
    peer.on('error', (err) => cb(err))
    peer.on('connect', () => cb(null, peer))
  }

  return {
    connect (address, opts, relay, cb) {
      createPeer({ initiator: true }, relay, cb)
    },
    onIncoming (relay, cb) {
      createPeer({}, relay, cb)
    }
  }
}

var websocket = {
  connect (address, opts, relay, cb) {
    var protocol = opts.secure ? 'wss' : 'ws'
    var ws = Websocket(`${protocol}://${address}:${opts.port}`)
    ws.on('error', (err) => cb(err))
    cb(null, ws)
  },
  accept (opts, onConnection, cb) {
    if (!opts.port) {
      return cb(new Error('Must specify "port" option'))
    }
    var httpsOpts
    if (opts.https) {
      httpsOpts = opts.https
      delete opts.https
      opts.secure = true
    }
    var server = httpsOpts
      ? https.createServer(httpsOpts) : http.createServer()
    server.on('error', cb)
    server.listen(opts.port, () => {
      var wss = Websocket.createServer({ server }, onConnection)
      wss.on('error', cb)
      cb(null, server.close.bind(server))
    })
  }
}

var tcp = {
  connect (address, opts, relay, cb) {
    var socket = net.connect(opts.port, address, () => cb(null, socket))
    socket.on('error', (err) => cb(err))
  },
  accept (opts, onConnection, cb) {
    // TODO: option for already-created TCP server
    if (!opts.port) {
      return cb(new Error('Must specify "port" option'))
    }
    var server = net.createServer(onConnection)
    server.on('error', cb)
    server.listen(opts.port, () => {
      cb(null, server.close.bind(server))
    })
  }
}

var relay = {
  connect (address, opts, relay, cb) {
    cb(null, relay)
  },
  onIncoming () {

  }
}

module.exports = { webrtc, websocket, tcp, relay }
