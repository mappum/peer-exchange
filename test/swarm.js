var test = require('tape')
var Swarm = require('../')
var PassThrough = require('stream').PassThrough
var dup = require('duplexify')
if (!process.browser) {
  var wrtc = require('electron-webrtc')()
}

function nodeTest (t, name, f) {
  if (!process.browser) return t.test(name, f)
}

function browserTest (t, name, f) {
  if (process.browser) return t.test(name, f)
}

function createStreams () {
  var conn1 = new PassThrough()
  var conn2 = new PassThrough()
  return [
    dup(conn1, conn2),
    dup(conn2, conn1)
  ]
}

test('create Swarm', function (t) {
  t.test('no networkId', function (t) {
    try {
      var swarm = Swarm()
      t.notOk(swarm, 'should have thrown')
    } catch (err) {
      t.pass('error thrown')
      t.equal(err.message, 'networkId must be a string', 'correct error message')
      t.end()
    }
  })

  t.test('invalid networkId', function (t) {
    try {
      var swarm = Swarm(123)
      t.notOk(swarm, 'should have thrown')
    } catch (err) {
      t.pass('error thrown')
      t.equal(err.message, 'networkId must be a string', 'correct error message')
      t.end()
    }
  })

  nodeTest(t, 'no webrtc implementation', function (t) {
    try {
      var swarm = Swarm('somenet')
      t.notOk(swarm, 'should have thrown')
    } catch (err) {
      t.pass('error thrown')
      t.equal(err.message, 'No WebRTC implementation found, please pass one in  as the "wrtc" option (for example, the "wrtc" or "electron-webrtc" packages).', 'correct error message')
      t.end()
    }
  })

  nodeTest(t, 'with webrtc implementation', function (t) {
    var swarm = Swarm('somenet', { wrtc: {} })
    t.ok(swarm instanceof Swarm, 'created swarm')
    t.end()
  })

  browserTest(t, 'with builtin webrtc implementation', function (t) {
    var swarm = Swarm('somenet')
    t.ok(swarm instanceof Swarm, 'created swarm')
    t.end()
  })

  t.end()
})

test('connect', function (t) {
  t.test('simple connect', function (t) {
    t.plan(18)
    var swarm1 = Swarm('somenet', { wrtc: wrtc })
    var swarm2 = Swarm('somenet', { wrtc: wrtc })
    var streams = createStreams()
    swarm1.on('peer', function (peer) {
      t.pass('got "peer" event from swarm1')
      t.equal(swarm1.peers.length, 1, 'correct peers length')
      t.equal(swarm1.peers[0], peer, 'correct peer object')
    })
    swarm2.on('peer', function (peer) {
      t.pass('got "peer" event from swarm2')
      t.equal(swarm2.peers.length, 1, 'correct peers length')
      t.equal(swarm2.peers[0], peer, 'correct peer object')
    })
    swarm1.on('connect', function (stream) {
      t.pass('received "connect" event from swarm1')
      stream.write('123')
      stream.once('data', function (data) {
        t.pass('received stream data')
        t.equal(data.toString(), '456', 'correct data')
      })
    })
    swarm2.on('connect', function (stream) {
      t.pass('received "connect" event from swarm2')
      stream.write('456')
      stream.once('data', function (data) {
        t.pass('received stream data')
        t.equal(data.toString(), '123', 'correct data')
      })
    })
    swarm1.connect(streams[0], function (err, peer) {
      t.pass('swarm1 connect callback called')
      t.error(err, 'no error')
      t.ok(peer, 'got peer object')
    })
    swarm2.connect(streams[1], { incoming: true }, function (err, peer) {
      t.pass('swarm2 connect callback called')
      t.error(err, 'no error')
      t.ok(peer, 'got peer object')
    })
  })

  t.test('connect with 2 outgoing', function (t) {
    var swarm1 = Swarm('somenet', { wrtc: wrtc })
    var swarm2 = Swarm('somenet', { wrtc: wrtc })
    var streams = createStreams()
    swarm2.on('error', function (err) {
      t.pass('got "error" event from swarm2')
      t.equal(err.message, 'Peer tried to connect to network "somenet" twice', 'correct error message')
      t.end()
    })
    swarm1.connect(streams[0])
    swarm2.connect(streams[1])
  })
})

test('cleanup', function (t) {
  if (wrtc) wrtc.close()
  t.end()
})
