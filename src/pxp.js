'use strict'

const EventEmitter = require('events')
const json = require('ndjson')
const pumpify = require('pumpify').obj
const old = require('old')
const debug = require('debug')('peer-exchange:pxp')

const PXP_MESSAGES = [
  'hello',
  'getpeers',
  'relay',
  'incoming',
  'upgrade',
  'connect',
  'res'
]

class PXP extends EventEmitter {
  constructor (stream) {
    // TODO: rate limiting
    super()
    this.nonce = 0
    this.stream = pumpify(
      json.serialize(),
      stream,
      json.parse()
    )
    this.stream.on('data', this.onMessage.bind(this))
    this.stream.on('error', this.error.bind(this))
  }

  error (err) {
    debug('error: ' + err.message)
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
    debug(`received message: command="${command}", nonce=${nonce}, args=${args}`)
    if (command === 'res') {
      return this.emit(nonce, args)
    }
    var res = (...args) => {
      if (args.length === 1) args = args[0]
      this.stream.write([ 'res', nonce, args ])
    }
    this.emit(command, args, res)
  }

  send (command, ...args) {
    if (typeof args[args.length - 1] === 'function') {
      var cb = args[args.length - 1]
      args = args.slice(0, args.length - 1)
    }
    if (args.length === 1) args = args[0]
    var nonce = (this.nonce++).toString(36)
    debug(`sending message: command=${command}, nonce=${nonce}, args=${args}`)
    if (cb) this.once(nonce, cb)
    this.stream.write([ command, nonce, args ])
  }
}

module.exports = old(PXP)
