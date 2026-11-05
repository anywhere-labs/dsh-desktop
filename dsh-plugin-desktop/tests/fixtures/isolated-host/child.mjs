import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'

const testHome = process.env.DSH_TEST_USER_HOME
if (testHome) {
  const realUserInfo = os.userInfo.bind(os)
  os.userInfo = options => ({ ...realUserInfo(options), homedir: testHome })
  os.homedir = () => testHome
  syncBuiltinESMExports()
}

const port = Object.assign(new EventEmitter(), { postMessage: message => process.send(message) })
process.parentPort = port
await import('../../../lib/host-process-entry.js')
process.on('message', data => port.emit('message', { data }))
process.on('disconnect', () => process.exit(0))
process.send({ ready: true })
