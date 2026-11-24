import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { latestConnectionState, watchConnections, type LiveStatus } from '../../src/panel/connections.js'
import type { ConnectionState } from '../../src/management-contract.js'

test('live reader handles split frames, reconnects with a new baseline, and stops on unmount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests: { body: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const signal = options.signal as AbortSignal
    return new Response(new ReadableStream<Uint8Array>({
      start(body) { requests.push({ body, signal }); signal.addEventListener('abort', () => { body.error(new Error('aborted')) }, { once: true }) },
    }))
  })
  const values: ConnectionState[] = []
  const statuses: LiveStatus[] = []
  const stop = watchConnections(value => values.push(value), status => statuses.push(status))
  const encode = (text: string) => new TextEncoder().encode(text)
  const state = (revision: number): ConnectionState => ({ instanceId: 'host', revision, ready: true, connections: 0, sessions: 0, clients: [] })
  try {
    const first = JSON.stringify(state(8))
    requests[0]!.body.enqueue(encode(first.slice(0, 12)))
    await setImmediate()
    assert.equal(values.length, 0)
    requests[0]!.body.enqueue(encode(first.slice(12) + '\n\n'))
    await setImmediate()
    assert.deepEqual(values, [state(8)])
    assert.deepEqual(latestConnectionState(state(8), state(7)), state(8), 'a delayed push cannot rewind manual refresh')
    assert.deepEqual(latestConnectionState(state(8), { ...state(0), instanceId: 'restarted' }), { ...state(0), instanceId: 'restarted' })
    assert.equal(statuses.at(-1), 'live')
    requests[0]!.body.close()
    await setImmediate()
    assert.equal(statuses.at(-1), 'reconnecting')
    t.mock.timers.tick(2_000)
    await setImmediate()
    assert.equal(requests.length, 2)
    requests[1]!.body.enqueue(encode(JSON.stringify(state(0)) + '\n'))
    await setImmediate()
    assert.deepEqual(values.at(-1), state(0), 'a restarted Host may have a lower revision')
    assert.equal(statuses.at(-1), 'live')
    t.mock.timers.tick(45_000)
    await setImmediate()
    assert.equal(statuses.at(-1), 'reconnecting', 'missing heartbeats make a stalled stream visibly stale')
  } finally { stop() }
  await setImmediate()
  t.mock.timers.tick(60_000)
  await setImmediate()
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.signal.aborted, true)
})
