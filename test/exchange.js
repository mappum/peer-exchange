var test = require('tap').test
var wrtc = require('electron-webrtc')()
var Exchange = require('../lib/exchange.js')
var transports = require('../lib/transports.js')

test('connect exchanges across transports', (t) => {
  var e1 = new Exchange('test', { wrtc })
  var e2 = new Exchange('test', {
    transports: {
      tcp: transports.tcp,
      webrtc: transports.webrtc({ wrtc })
    }
  })
  var e3 = new Exchange('test', {
    transports: {
      websocket: transports.websocket,
      webrtc: transports.webrtc({ wrtc })
    }
  })

  t.test('accept connections', (t) => {
    e1.accept('tcp', { port: 7777 })
    e1.accept('websocket', { port: 7778 })
    e2.accept('webrtc')
    t.end()
  })

  t.test('connect over tcp (e2 -> e1)', (t) => {
    var e1EmittedPeer = false
    var e2EmittedPeer = false
    var response = false
    e1.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, true, 'peer is incoming')
      t.equal(peer.ready, true, 'peer is ready')
      e1EmittedPeer = true
      maybeEnd()
    })
    e2.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      e2EmittedPeer = true
      maybeEnd()
    })
    e2.connect('tcp', 'localhost', { port: 7777 }, (err, peer) => {
      t.error(err)
      t.ok(peer, 'got peer response')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      response = true
      maybeEnd()
    })
    function maybeEnd () {
      if (e1EmittedPeer && e2EmittedPeer && response) {
        t.equal(e1.peers.length, 1, 'e1 has correct number of peers')
        t.equal(e2.peers.length, 1, 'e2 has correct number of peers')
        t.end()
      }
    }
  })

  t.test('connect over websocket (e3 -> e1)', (t) => {
    var e1EmittedPeer = false
    var e3EmittedPeer = false
    var response = false
    e1.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, true, 'peer is incoming')
      t.equal(peer.ready, true, 'peer is ready')
      e1EmittedPeer = true
      maybeEnd()
    })
    e3.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      e3EmittedPeer = true
      maybeEnd()
    })
    e3.connect('websocket', 'localhost', { port: 7778 }, (err, peer) => {
      t.error(err)
      t.ok(peer, 'got peer response')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      response = true
      maybeEnd()
    })
    function maybeEnd () {
      if (e1EmittedPeer && e3EmittedPeer && response) {
        t.equal(e1.peers.length, 2, 'e1 has correct number of peers')
        t.equal(e3.peers.length, 1, 'e3 has correct number of peers')
        t.end()
      }
    }
  })

  t.test('getNewPeer over webrtc (e3 -> e2)', (t) => {
    var e2EmittedPeer = false
    var e3EmittedPeer = false
    var response = false
    e2.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, true, 'peer is incoming')
      t.equal(peer.ready, true, 'peer is ready')
      e2EmittedPeer = true
      maybeEnd()
    })
    e3.once('peer', (peer) => {
      t.ok(peer, 'got peer event')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      e3EmittedPeer = true
      maybeEnd()
    })
    e3.getNewPeer((err, peer) => {
      t.error(err)
      t.ok(peer, 'got peer response')
      t.equal(peer.incoming, false, 'peer is outgoing')
      t.equal(peer.ready, true, 'peer is ready')
      response = true
      maybeEnd()
    })
    function maybeEnd () {
      if (e2EmittedPeer && e3EmittedPeer && response) {
        t.equal(e1.peers.length, 2, 'e1 has correct number of peers')
        t.equal(e3.peers.length, 2, 'e3 has correct number of peers')
        t.end()
      }
    }
  })

  t.test('cleanup', (t) => {
    wrtc.electronDaemon.close()
    e1.close()
    e2.close()
    e3.close()
    e1.unaccept('tcp')
    e1.unaccept('websocket')
    e2.unaccept('webrtc')
    t.end()
  })

  t.end()
})
