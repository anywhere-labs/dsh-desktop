import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'

const home = process.env.DSH_TEST_USER_HOME
if (home) {
  const originalUserInfo = os.userInfo
  os.userInfo = options => ({
    ...originalUserInfo(options),
    homedir: options?.encoding === 'buffer' ? Buffer.from(home) : home,
  })
  os.homedir = () => home
  syncBuiltinESMExports()
}
const port = Object.assign(new EventEmitter(), { postMessage: message => process.send(message) })
process.parentPort = port
await import('../../../lib/host-process-entry.js')
process.on('message', data => port.emit('message', { data }))
process.on('disconnect', () => process.exit(0))
process.send({ ready: true })
