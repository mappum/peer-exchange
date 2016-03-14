'use strict'

function remove (array, object) {
  var index = array.indexOf(object)
  if (index !== -1) {
    array.splice(index, 1)
    return true
  }
  return false
}

function getRandom (array) {
  return array[Math.floor(Math.random() * array.length)]
}

// HACK: recursively looks for socket property that has a remote address
function getRemoteAddress (socket) {
  if (socket.remoteAddress) return socket.remoteAddress
  if (socket.socket) {
    let address = getRemoteAddress(socket.socket)
    if (address) return address
  }
  if (socket._socket) {
    let address = getRemoteAddress(socket._socket)
    if (address) return address
  }
}

module.exports = { remove, getRandom, getRemoteAddress }
