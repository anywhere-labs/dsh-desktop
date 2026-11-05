import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { HostPermissions } from '../src/host-permissions.ts'

function fixture() {
  const connection = Object.assign(new EventEmitter(), { connected: true, send: vi.fn() })
  return { connection, service: new HostPermissions(connection as unknown as NodeJS.Process) }
}

it('correlates concurrent permission replies and preserves actual statuses', async () => {
  const { connection, service } = fixture()
  const screen = service.query('screen')
  const microphone = service.request('microphone')
  expect(connection.send.mock.calls.map(([request]) => request)).toEqual([
    { type: 'permission', requestId: 1, action: 'query', permission: 'screen' },
    { type: 'permission', requestId: 2, action: 'request', permission: 'microphone' },
  ])
  connection.emit('message', { type: 'permission-result', requestId: 2, snapshot: { permission: 'microphone', status: 'denied', canRequest: false, canOpenSettings: true } })
  connection.emit('message', { type: 'permission-result', requestId: 1, snapshot: { permission: 'screen', status: 'granted', canRequest: false, canOpenSettings: true } })
  expect((await screen).status).toBe('granted')
  expect((await microphone).status).toBe('denied')
  service.dispose()
  expect(connection.listenerCount('message')).toBe(0)
})

it('rejects invalid replies and tears down pending requests on disconnect', async () => {
  const { connection, service } = fixture()
  const first = service.query('screen')
  connection.emit('message', { type: 'permission-result', requestId: 1, snapshot: { permission: 'microphone', status: 'granted', canRequest: false, canOpenSettings: true } })
  await expect(first).rejects.toThrow('Invalid Desktop permission response')
  const second = service.query('accessibility')
  connection.emit('disconnect')
  await expect(second).rejects.toThrow('disconnected')
  await expect(service.request('microphone')).rejects.toThrow('unavailable')
})

it('bounds unanswered requests instead of leaving plugin unload waiting', async () => {
  vi.useFakeTimers()
  const { service } = fixture()
  try {
    const result = expect(service.query('screen')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(5000)
    await result
  } finally { service.dispose(); vi.useRealTimers() }
})
