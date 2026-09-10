import { EventEmitter } from 'node:events'
const port = Object.assign(new EventEmitter(), { postMessage: message => process.send(message) })
process.parentPort = port
await import('../../../lib/host-process-entry.js')
process.on('message', data => port.emit('message', { data }))
process.on('disconnect', () => process.exit(0))
process.send({ ready: true })
