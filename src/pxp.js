'use strict'

const EventEmitter = require('events')
const json = require('ndjson')
const duplexify = require('duplexify')
const old = require('old')

const PXP_MESSAGES = [
  'hello',
  'getpeers',
  'relay',
  'incoming',
  'upgrade',
  'connect'
]

class PXP extends EventEmitter {
  constructor (stream) {
    // TODO: rate limiting
    super()
    this.nonce = 0
    this.stream = duplexify(
      json.serialize(),
      stream,
      json.parse()
    )
    this.stream.on('data', this.onMessage.bind(this))
    this.stream.on('error', this.error.bind(this))
  }

  error (err) {
    this.emit('error', err)
  }

  onMessage (message) {
    var [ command, nonce, args ] = message
    if (message.length < 2) {
      let err = new Error('Peer sent invalid PXP message')
      return this.error(err)
    }
    if (!PXP_MESSAGES.includes(command)) {
      let err = new Error(`Peer sent unknown PXP message: "${command}"`)
      return this.error(err)
    }
    if (command === 'res') {
      return this.emit(nonce, args)
    }
    var res = (...args) => {
      if (args.length === 1) args = args[0]
      this.stream.write([ command, nonce, args ])
    }
    this.emit(command, args, res)
  }

  send (message, ...args) {
    if (typeof args[args.length - 1] === 'function') {
      var cb = args[args.length - 1]
      args = args.slice(0, args.length - 1)
    }
    if (args.length === 1) args = args[0]
    var nonce = (this.nonce++).toString(36)
    this.stream.write([ message, nonce, args ])
    if (cb) this.once(nonce, cb)
  }
}

module.exports = old(PXP)
