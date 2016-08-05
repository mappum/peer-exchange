var test = require('tape')
var wrtc = require('electron-webrtc')()
var Exchange = require('../lib/exchange.js')
var transports = require('../lib/transports.js')

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

test('accept connections', (t) => {
  e1.accept('tcp', { port: 7777 })
  e1.accept('websocket', { port: 7778 })
  e2.accept('webrtc')
  t.end()
})

test('connect over tcp (e2 -> e1)', (t) => {
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

test('connect over websocket (e3 -> e1)', (t) => {
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

var p1
var p2
test('getNewPeer over webrtc (e3 -> e2)', (t) => {
  var e2EmittedPeer = false
  var e3EmittedPeer = false
  var response = false
  e2.once('peer', (peer) => {
    t.ok(peer, 'got peer event')
    t.equal(peer.incoming, true, 'peer is incoming')
    t.equal(peer.ready, true, 'peer is ready')
    e2EmittedPeer = true
    p1 = peer
    maybeEnd()
  })
  e3.once('peer', (peer) => {
    t.ok(peer, 'got peer event')
    t.equal(peer.incoming, false, 'peer is outgoing')
    t.equal(peer.ready, true, 'peer is ready')
    e3EmittedPeer = true
    p2 = peer
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

test('write data over webrtc (e3 -> e2)', (t) => {
  p1.once('data', (data) => {
    t.ok(data, 'received data')
    t.equal(data.toString(), 'hello peer', 'data is correct')
    t.end()
  })
  p2.write(new Buffer('hello peer'))
})

test('errors', (t) => {
  t.test('connecting with different network id', (t) => {
    var ex = new Exchange('different-id')
    ex.connect('tcp', 'localhost', { port: 7777 }, (err, peer) => {
      t.ok(err, 'got error')
      t.equal(err.message, 'Peer\'s network id ("test") is different than ours ("different-id")', 'correct error message')
      t.end()
    })
  })

  t.test('sending multiple handshakes', (t) => {
    var ex = new Exchange('test')
    var selfPeer = null
    var otherPeer = null
    e1.once('peer', (peer) => {
      t.ok(peer, 'got incoming peer')
      selfPeer = peer
      maybeSendHandshake()
    })
    ex.connect('tcp', 'localhost', { port: 7777 }, (err, peer) => {
      t.error(err, 'no error')
      t.ok(peer, 'got outgoing peer')
      peer.once('error', (err) => {
        t.ok(err, 'got error')
        t.equal(err.message, 'Received a duplicate "hello" message', 'correct error message')
        t.end()
      })
      otherPeer = peer
      maybeSendHandshake()
    })
    function maybeSendHandshake () {
      if (!selfPeer || !otherPeer) return
      selfPeer._sendHello()
    }
  })

  t.test('getNewPeer on peer with no accepting peers', (t) => {
    var e4 = new Exchange('test')
    e4.accept('tcp', { port: 7780 })

    var e5 = new Exchange('test')
    e5.connect('tcp', 'localhost', { port: 7780 }, (err, peer) => {
      t.error(err, 'no error')
      t.ok(peer, 'got peer')
      e5.getNewPeer((err, peer) => {
        t.ok(err, 'got error')
        t.notOk(peer, 'no peer')
        t.equal(err.message, 'Peer does not have any peers to exchange', 'correct error message')
        e4.close()
        e5.close()
        t.end()
      })
    })
  })

  t.test('error emitted when trying to listen on bound port', (t) => {
    var e4 = new Exchange('test')
    e4.once('error', (err) => {
      t.ok(err, 'got error')
      t.equal(err.message, 'listen EADDRINUSE :::7777', 'correct error message')
      e4.close(t.end)
    })
    e4.accept('tcp', { port: 7777 })
  })

  t.test('error emitted when calling accept on same transport multiple times', (t) => {
    var e4 = new Exchange('test')
    e4.once('error', (err) => {
      t.ok(err, 'got error')
      t.equal(err.message, 'Already accepting with "tcp" transport', 'correct error message')
      e4.once('error', (err) => {
        t.ok(err, 'got error')
        t.equal(err.message, 'Already accepting with "tcp" transport', 'correct error message')
        e4.close(t.end)
      })
      e4.accept('tcp', { port: 7801 })
    })
    e4.accept('tcp', { port: 7800 })
    e4.accept('tcp', { port: 7801 })
  })

  t.end()
})

test('remove acceptPeers on disconnect', (t) => {
  var e4 = new Exchange('test')
  e4.accept('tcp', { port: 7780 })

  var e5 = new Exchange('test')
  e5.accept('tcp', { port: 7781 })
  e5.connect('tcp', 'localhost', { port: 7780 }, (err, peer) => {
    t.error(err, 'no error')
    t.ok(peer, 'got peer')
    t.equal(e4._acceptPeers.tcp.length, 1, 'e5 was added to e4\'s acceptPeers')
    setTimeout(function () {
      t.equal(e4.peers.length, 1, 'e5 was added to e4\'s peers')
      var e6 = new Exchange('test')
      e6.connect('tcp', 'localhost', { port: 7780 }, (err, peer) => {
        t.error(err, 'no error')
        t.ok(peer, 'got peer')
        t.equal(e4._acceptPeers.tcp.length, 1, 'e6 was not added to e4\'s acceptPeers')
        setTimeout(function () {
          t.equal(e4.peers.length, 2, 'e6 was added to e4\'s peers')
          e4.once('disconnect', () => {
            t.pass('e5 closed')
            t.equal(e4._acceptPeers.tcp.length, 0, 'e5 was removed from e4\'s acceptPeers')
            t.equal(e4.peers.length, 1, 'e5 was removed from e4\'s peers')
            e6.getNewPeer((err, peer) => {
              t.ok(err, 'got error')
              t.notOk(peer, 'no peer')
              t.equal(err.message, 'Peer does not have any peers to exchange', 'correct error message')
              e4.close(() => e6.close(t.end))
            })
          })
          e5.close()
        }, 250)
      })
    }, 250)
  })
})

test('accept/unaccept after connect', (t) => {
  var e4 = new Exchange('test')
  e4.accept('tcp', { port: 7780 })

  var e5 = new Exchange('test')
  e5.connect('tcp', 'localhost', { port: 7780 }, (err, peer) => {
    t.error(err, 'no error')
    t.ok(peer, 'got peer')
    t.equal(e4._acceptPeers.tcp.length, 0, 'e5 was not added to e4\'s acceptPeers')
    t.equal(e4.peers.length, 1, 'e5 was added to e4\'s peers')

    e5.accept('tcp', { port: 7781 }, (err) => {
      t.error(err, 'no error')
      setTimeout(() => {
        t.equal(e4._acceptPeers.tcp.length, 1, 'e5 was added to e4\'s acceptPeers')

        e5.unaccept('tcp', (err) => {
          t.error(err, 'no error')
          setTimeout(() => {
            t.equal(e4._acceptPeers.tcp.length, 0, 'e5 was removed from e4\'s acceptPeers')
            e4.close(() => e5.close(t.end))
          }, 200)
        })
      }, 100)
    })
  })
})

test('cleanup', (t) => {
  wrtc.electronDaemon.close()
  e1.close()
  e2.close()
  e3.close()
  t.end()
})
