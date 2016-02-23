# peer-exchange

[![npm version](https://img.shields.io/npm/v/peer-exchange.svg)](https://www.npmjs.com/package/peer-exchange)
[![Build Status](https://travis-ci.org/mappum/peer-exchange.svg?branch=master)](https://travis-ci.org/mappum/peer-exchange)
[![Dependency Status](https://david-dm.org/mappum/peer-exchange.svg)](https://david-dm.org/mappum/peer-exchange)

**Decentralized peer discovery and signaling**

`peer-exchange` provides functionality similar to [`signalhub`](https://github.com/mafintosh/signalhub), where P2P nodes can get addresses of new peers and establish connections by relaying signaling data. However, this module differs by getting all nodes to provide this "hub" service, rather than a few centralized servers. This makes the network decentralized, scalable, and robust.

Note that `signalhub` may still be better for some applications, for instance when finding peers in small swarms where peers are hard to find (e.g. torrent swarms). In the future, a DHT could help with finding initial peers for this sort of use case.

## Usage

`npm install peer-exchange`

```js
var Exchange = require('peer-exchange')

var ex = new Exchange('some-network-id') // pick some ID for your network

// optionally specify you want to accept incoming connections
ex.accept('websocket', { port: 8000 })
ex.accept('tcp', { port: 8001 })
ex.accept('webrtc')

ex.on('peer', (peer) => {
  console.log('connected to peer:', peer.socket.transport, peer.remoteAddress)
})

// bootstrap by connecting to a few already-known initial peers
ex.connect('websocket', '10.0.0.1', { port: 8000 }, (err, peer) => { ... })
ex.connect('tcp', '10.0.0.2', { port: 8000 }, (err, peer) => {
  // `peer` is a duplex stream

  // now that we're connected, we can request more peers from our current peers.
  // this selects a peer at random and queries it for a new peer:
  ex.getNewPeer((err, peer) => {
    console.log('a random peer sent us a new peer:', peer.socket.transport, peer.remoteAddress)
    // `peer` is a duplex stream
  })
})
```

### API

## Exchange

```js
var Exchange = require('peer-exchange')
```

#### Methods


#### `var ex = new Exchange(networkId, [opts])`

Creates a new exchange, which is used to manage connections to peers in a P2P network. After we establish some initial connections, we can query our current peers for new peers. Additionally, we will share peers when we receive queries.

`networkId` should be a string unique to the network. Nodes can only peer with other nodes that use the same ID. If you need to participate in multiple networks, create multiple `Exchange` instances with different IDs.

`opts` can contain the following properties:
 - `wrtc`, *Object* - A WebRTC implementation for Node.js clients (e.g. [`wrtc`](https://github.com/js-platform/node-webrtc) or [`electron-webrtc`](https://github.com/mappum/electron-webrtc)). In browsers, the built-in implementation is used by default.
 - `transports`, *Object* - Manually specify connection transport interfaces. By default, the available transports are `websocket`, `tcp` (if in Node.js), and `webrtc` (if `wrtc` opt is supplied or if in browser). The built-in transports are exposed as `require('peer-exchange').transports`.

----
#### `ex.connect(transport, host, opts, [callback])`

Manually connects to a peer. This is necessary to bootstrap our exchange with initial peers which we can query for additional peers.

`transport` should be a string that specifies the name of the transport to connect with (e.g. `'websocket'` or `'tcp'`).

`host` is the network address of the remote peer.

`opts` is an object containing transport options (e.g. `{ port: 8000 }`).

`callback` will be called with
`callback(err, peer)`.

----
#### `ex.getNewPeer([callback])`

Randomly selects a peer we are connected to, and queries it for a new peer. A connection will be made with the new peer, using the already-connected peer as a relay (for signaling, NAT traversal, etc.).

This will error if our exchange is not yet connected to any peers.

`callback` will be called with `callback(err, peer)`.

----
#### `ex.accept(transport, opts, [callback])`

Begins accepting incoming peer connections on a transport.

`transport` should be a string that specifies the name of the transport to accept connections with (e.g. `'websocket'`, `'webrtc'`, or `'tcp'`).

`opts` is an object containing transport options (e.g. `{ port: 8000 }`).

`callback` is called with `callback(err)` when the exchange is ready to accept incoming connections (or when an error occurs during setup).

----
#### `ex.unaccept(transport)`

Stops accepting incoming peer connections on a transport.

`transport` should be a string that specifies the name of the transport to accept connections with (e.g. `'websocket'`, `'webrtc'`, or `'tcp'`).

----
#### `ex.close([callback])`

Closes all peer connections in the exchange and stops accepting incoming connections.

`callback` is called with `callback(err)` when the exchange is closed (or when an error occurs).

----

#### Properties

#### `ex.peers`

An array of connected peers. Useful for iterating through peers or getting the number of connections, but mutating this array will cause undefined behavior.

#### `ex.id`

The network ID provided in the constructor.

----

#### Events

#### `ex.on('peer', function (peer) { ... })`

Emitted whenever a new peer connection is established (both incoming and outgoing).

#### `ex.on('error', function (err) { ... })`

Emitted when an error occurs.

----

## Peer

`Peer` objects are returned by `Exchange#connect()`, `Exchange#getNewPeer()`, and `Exchange#on('peer')`.

`Peer` is a duplex stream, which streams data over the transport to/from the remote peer.

### Methods

#### `peer.getNewPeer([callback])`

Queries this peer for a new peer. A connection will be made with the new peer, using the already-connected peer as a relay (for signaling, NAT traversal, etc.).

`callback` will be called with `callback(err, peer)`.

----
#### `peer.destroy()`

Closes this peer connection and frees its resources.

----
#### Properties

#### `peer.socket`

The transport DuplexStream for this peer connection.

#### `peer.socket.transport`

A string containing the name of the transport this connection is using.

#### `peer.remoteAddress`

A string containing the network address of the remote peer.

----
#### Events

#### `ex.on('close', function () { ... })`

Emitted when the connection closes.

#### `ex.on('error', function (err) { ... })`

Emitted when an error occurs.

----
## Transport Interface

**TODO**

(See `src/transports.js` for now)

## Security Notes

Some efforts were made to make this module DoS-resistant, but there are probably still some weaknesses.

It is recommended to use an authenticated transport (e.g. 'wss') for initial nodes to prevent MITM (attackers would be able to control all your peers, which can be very bad in some applications).
