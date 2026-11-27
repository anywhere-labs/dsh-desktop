import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { callManagement, ManagementError, managementErrorText, readManagementWhenReady } from '../../src/panel/management-client.js'

const state = { settings: { enabled: true }, live: { ready: true }, checks: [] }
test('initial read waits for the Host route to register without parsing a plain-text 404', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('not found', { status: 404 }) : Response.json(state))
  const loaded = readManagementWhenReady(new AbortController().signal)
  await setImmediate()
  assert.equal(calls, 1)
  t.mock.timers.tick(1_000)
  assert.deepEqual(await loaded, state)
  assert.equal(calls, 2)
})

test('unmount cancels the readiness wait and writes are never retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('not found', { status: 404 }) })
  const controller = new AbortController()
  const loaded = readManagementWhenReady(controller.signal)
  const rejected = assert.rejects(loaded, { name: 'AbortError' })
  await setImmediate()
  controller.abort()
  await rejected
  t.mock.timers.tick(20_000)
  assert.equal(calls, 1)
  await assert.rejects(callManagement({ action: 'save' }), (error: unknown) => error instanceof ManagementError && error.kind === 'unavailable')
  assert.equal(calls, 2)
})

test('real errors remain visible and non-JSON responses have localized messages', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Forbidden', { status: 403 }))
  await assert.rejects(readManagementWhenReady(new AbortController().signal), (cause: unknown) => {
    assert.ok(cause instanceof ManagementError)
    assert.match(managementErrorText(cause, 'zh'), /403/u)
    assert.match(managementErrorText(cause, 'en'), /Could not read/u)
    return true
  })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Invalid timeout' }, { status: 400 }))
  await assert.rejects(callManagement({ action: 'save' }), /Invalid timeout/u)
  t.mock.method(globalThis, 'fetch', async () => new Response('not json'))
  await assert.rejects(callManagement(), (cause: unknown) => cause instanceof ManagementError && cause.kind === 'invalid')
})
