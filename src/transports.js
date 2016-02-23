var http = require('http')
var getBrowserRTC = require('get-browser-rtc')
var SimplePeer = require('simple-peer')
var Websocket = require('websocket-stream')

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

  function connect (address, relay, cb) {
    createPeer({ initiator: true }, relay, cb)
  }

  function onIncoming (relay, cb) {
    createPeer({}, relay, cb)
  }

  return { connect, onIncoming }
}

var websocket = {
  connect: function (address, relay, cb) {
    var ws = Websocket(address)
    ws.on('error', (err) => cb(err))
    cb(null, ws)
  },

  accept: function (opts, onConnection) {
    // TODO: option for already-created http(s) server
    if (!opts.port) {
      throw new Error('Must specify "port" option')
    }
    var server = http.createServer()
    server.listen(opts.port, () => {
      Websocket.createServer({ server }, onConnection)
    })
    return server.close.bind(server)
  }
}

module.exports = { webrtc, websocket }
