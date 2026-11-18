/** Exercise the installed ws copies the Host serves WebSockets with in Beta and Next (#1571). */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
// Host packages that run a WebSocketServer: the gateway's Remote stream mux and the inspector's CDP and ingest servers.
const SERVERS = ['@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-experimental-inspector']

/** Map each ws copy the workspace's Host servers resolve to the servers that load it. */
function serverWsCopies(workspace) {
  const copies = new Map()
  for (const server of SERVERS) {
    let manifest
    try {
      manifest = createRequire(resolve(workspace, 'package.json')).resolve(`${server}/package.json`)
    } catch (error) {
      // check:layout also runs in CI jobs that do not install runtime dependencies.
      if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${server}/package.json'`)) return undefined
      throw error
    }
    const directory = dirname(createRequire(manifest).resolve('ws/package.json'))
    copies.set(directory, [...(copies.get(directory) ?? []), server])
  }
  return copies
}

/**
 * Run each server operation whose frame carries no payload and name those that hand the socket an empty
 * chunk. Electron's V8 sandbox points every empty ArrayBuffer at the sandbox's last byte, which lies outside
 * user space on arm64 kernels built with CONFIG_ARM64_VA_BITS=39 (Raspberry Pi 4). The kernel then fails the
 * whole writev with EFAULT and ws destroys the connection, so the gateway's heartbeat ping ends every client
 * connection and the window reconnects forever. ws 8.22.1 stopped writing these chunks.
 */
async function operationsWritingEmptyChunks(directory) {
  const { WebSocket, WebSocketServer } = require(directory)
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolveListening => server.once('listening', resolveListening))
  const accepted = new Promise(resolveAccepted => server.once('connection', (socket, request) => resolveAccepted([socket, request.socket])))
  const client = new WebSocket(`ws://127.0.0.1:${String(server.address().port)}`)
  const [socket, carrier] = await accepted
  await new Promise(resolveOpen => client.readyState === WebSocket.OPEN ? resolveOpen() : client.once('open', resolveOpen))
  const named = new Set()
  let operation
  const isEmpty = chunk => ArrayBuffer.isView(chunk) && chunk.byteLength === 0
  const write = carrier._write
  const writev = carrier._writev
  carrier._write = function (chunk, encoding, done) {
    if (isEmpty(chunk)) named.add(operation)
    return write.call(this, chunk, encoding, done)
  }
  carrier._writev = function (entries, done) {
    if (entries.some(entry => isEmpty(entry.chunk))) named.add(operation)
    return writev.call(this, entries, done)
  }
  // Each step waits until the client has received its frame, so no write lands in the next step's name.
  const step = async (name, received, write) => {
    operation = name
    const arrived = new Promise(resolveArrived => client.once(received, () => resolveArrived()))
    await new Promise((resolveWritten, rejectWritten) => write(error => error ? rejectWritten(error) : resolveWritten()))
    await arrived
  }
  try {
    await step('ping(), the gateway heartbeat', 'ping', done => socket.ping(done))
    await step('pong()', 'pong', done => socket.pong(done))
    await step("send('')", 'message', done => socket.send('', done))
    await step('send(Buffer.alloc(0))', 'message', done => socket.send(Buffer.alloc(0), done))
    await step('the automatic pong to an empty client ping', 'pong', done => client.ping(done))
    await step('close() without a code', 'close', done => { socket.close(); done() })
  } finally {
    client.terminate()
    await new Promise(resolveClosed => server.close(resolveClosed))
  }
  return [...named]
}

// Stable is frozen and ships no more releases, although the root lockfile resolves its copy too.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const copies = serverWsCopies(workspace)
  test(`${workspace}: the Host's WebSocket servers never write an empty payload chunk (#1571)`, {
    skip: copies === undefined && 'runtime dependencies are not installed; run corepack yarn install',
    timeout: 10_000,
  }, async () => {
    for (const [directory, servers] of copies) {
      const { version } = require(resolve(directory, 'package.json'))
      const operations = await operationsWritingEmptyChunks(directory)
      assert.deepEqual(operations, [], `ws ${version} (${servers.join(', ')}) writes an empty chunk on: ${operations.join('; ')}`)
    }
  })
}
