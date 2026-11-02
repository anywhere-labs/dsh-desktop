/** Exercise the installed meshcall client the Agents Anywhere bridge uses in Beta and Next (#1574). */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const BRIDGE = '@agents-anywhere/dsh-bridge-next'
const WRITE_COMPLETES_AFTER_MS = 300
const STALE_SUBSCRIPTION = 'The Connector no longer runs this sync subscription'

function meshcallDirectory(workspace) {
  let bridge
  try {
    bridge = createRequire(resolve(workspace, 'package.json')).resolve(`${BRIDGE}/package.json`)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${BRIDGE}/package.json'`)) return undefined
    throw error
  }
  // The copy the bridge resolves is the one its Connector link runs in the Host.
  return dirname(createRequire(bridge).resolve('meshcall/package.json'))
}

/**
 * Connect a client to a loopback peer whose acknowledgement of each call.open write arrives late, as on a
 * congested Connector pipe, and collect every unhandled rejection meanwhile. Upstream's fail-loud turns
 * one into `dsh: fatal load failure` and ends the Host.
 */
async function slowOpenWrites(directory, answerOpen) {
  const { MeshCallClient } = await import(pathToFileURL(join(directory, 'dist/src/index.js')).href)
  const { WebSocketServer } = createRequire(join(directory, 'package.json'))('ws')
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolveListening => server.once('listening', resolveListening))
  const events = []
  server.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(String(data))
    if (frame.kind === 'hello') socket.send(JSON.stringify({ kind: 'hello.ack', protocol: frame.protocol, connection_id: 'compat' }))
    else if (frame.kind === 'call.open' && answerOpen) {
      // The Connector answers a batch of a subscription it has already replaced.
      socket.send(JSON.stringify({ kind: 'call.error', call_id: frame.call_id, error: { code: 'subscription_unknown', message: STALE_SUBSCRIPTION } }))
      events.push('peer answered')
    }
  }))
  const client = new MeshCallClient(`ws://127.0.0.1:${String(server.address().port)}`, 'compat', { deadlineGraceMs: 0, pingIntervalMs: null, retry: false })
  await client.connect()
  // meshcall 0.3.0 keeps the open WebSocket in `socket`; FrameWriter waits for each send callback.
  const socket = client.socket
  assert.equal(typeof socket?.send, 'function', 'meshcall no longer exposes its socket; update this test for the new client')
  const send = socket.send.bind(socket)
  socket.send = (data, done) => send(data, error => {
    if (!String(data).includes('"call.open"')) return done(error)
    setTimeout(() => { events.push('call.open written'); done(error) }, WRITE_COMPLETES_AFTER_MS)
  })
  const unhandled = []
  const record = reason => { unhandled.push(reason) }
  process.on('unhandledRejection', record)
  return {
    client, events, unhandled,
    async close() {
      process.off('unhandledRejection', record)
      await client.close()
      await new Promise(resolveClosed => server.close(resolveClosed))
    },
  }
}

/** Settle `call` the way the bridge does (it awaits and catches every call) and return its failure. */
async function failureOf(call, events) {
  try {
    await call
  } catch (error) {
    events.push('caller caught')
    return error
  }
  assert.fail('the call should have failed')
}

// Stable is frozen and ships no more releases, although the root resolution patches its copy too.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const directory = meshcallDirectory(workspace)
  test(`${workspace}: a call that fails while its call.open is still being written leaves no unhandled rejection (#1574)`, {
    skip: directory === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async t => {
    await t.test('its local deadline expires (MeshCallError: Call deadline exceeded)', async () => {
      const peer = await slowOpenWrites(directory, false)
      try {
        const error = await failureOf(peer.client.unary('aa.local.v2.Logs', 'write', { entries: [] }, { timeoutMs: 50 }), peer.events)
        assert.equal(error.code, 'deadline_exceeded')
        assert.deepEqual(error.details, { source: 'client' })
        assert.deepEqual(peer.events, ['call.open written', 'caller caught'])
        assert.deepEqual(peer.unhandled, [])
      } finally {
        await peer.close()
      }
    })

    await t.test('the caller aborts it (CallCancelledError from SyncFeed.close)', async () => {
      const peer = await slowOpenWrites(directory, false)
      try {
        const abort = new AbortController()
        const call = peer.client.unary('aa.dsh.v2.Sync', 'ingestBatch', { batch: {} }, { signal: abort.signal })
        setTimeout(() => abort.abort(), 20)
        const error = await failureOf(call, peer.events)
        assert.equal(error.name, 'CallCancelledError')
        assert.deepEqual(peer.events, ['call.open written', 'caller caught'])
        assert.deepEqual(peer.unhandled, [])
      } finally {
        await peer.close()
      }
    })

    await t.test('the peer rejects it before the write is acknowledged', async () => {
      const peer = await slowOpenWrites(directory, true)
      try {
        const error = await failureOf(peer.client.unary('aa.dsh.v2.Sync', 'ingestBatch', { batch: {} }), peer.events)
        assert.equal(error.message, STALE_SUBSCRIPTION)
        assert.deepEqual(peer.events, ['peer answered', 'call.open written', 'caller caught'])
        assert.deepEqual(peer.unhandled, [])
      } finally {
        await peer.close()
      }
    })

    await t.test('a snapshot client stream is aborted (ingestSnapshot)', async () => {
      const peer = await slowOpenWrites(directory, false)
      try {
        const abort = new AbortController()
        const pages = (async function* () { yield { captureId: 'compat', items: [{}] } })()
        const call = peer.client.clientStream('aa.dsh.v2.Sync', 'ingestSnapshot', { request: {} }, pages, { signal: abort.signal })
        setTimeout(() => abort.abort(), 20)
        const error = await failureOf(call, peer.events)
        assert.equal(error.name, 'CallCancelledError')
        assert.deepEqual(peer.events, ['call.open written', 'caller caught'])
        assert.deepEqual(peer.unhandled, [])
      } finally {
        await peer.close()
      }
    })
  })
}
