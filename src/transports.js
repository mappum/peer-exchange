var getBrowserRTC = require('get-browser-rtc')
var SimplePeer = require('simple-peer')
var websocket = require('websocket-stream')

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

module.exports = { webrtc }
