import { afterEach, expect, it, vi } from 'vitest'
import type { Context, Exporter, Message } from '@deepseek-ai/cordis'
import { clientError, formatLogMessage, installClientDiagnostics, MAX_CLIENT_REPORTS_PER_SECOND } from '../src/client/client-diagnostics.ts'
import { MAX_CLIENT_STACK_CHARS, type ClientDiagnostic } from '../src/client-diagnostic.ts'

afterEach(() => { vi.unstubAllGlobals() })

function client(buffer: Partial<Message>[] = []) {
  const page = new EventTarget()
  vi.stubGlobal('window', page)
  let crashed: ((key: string, registration: { registrant?: string }, error: unknown, info: { abdicated: boolean }) => void) | undefined
  const exporters = new Set<Exporter>()
  const unsubscribe = vi.fn()
  const ctx = {
    slots: { onEntryError: (listener: typeof crashed) => { crashed = listener; return unsubscribe } },
    logger: { buffer, exporter: (exporter: Exporter) => { exporters.add(exporter); return () => { exporters.delete(exporter) } } },
  } as unknown as Context
  const reports: ClientDiagnostic[] = []
  let time = 0
  const stop = installClientDiagnostics(ctx, report => { reports.push(report) }, () => time)
  return { page, reports, exporters, unsubscribe, stop, crash: (...args: Parameters<NonNullable<typeof crashed>>) => crashed!(...args), at: (value: number) => { time = value } }
}

const message = (overrides: Partial<Message>): Message =>
  ({ sn: 1, ts: 0, name: 'loader', type: 'error', level: 0, args: [], ...overrides }) as Message

it('opens the channel, then reports a crashed slot entry with the plugin that registered it', () => {
  const { reports, crash } = client()
  const error = new TypeError('render failed')
  crash('sidebar.footer.action', { registrant: 'dsh-wallpaper-engine' }, error, { abdicated: true })
  crash('factory:panel', {}, 'thrown text', { abdicated: false })
  expect(reports).toEqual([
    { kind: 'ready' },
    { kind: 'slot-crash', slot: 'sidebar.footer.action', plugin: 'dsh-wallpaper-engine', abdicated: true, error: { name: 'TypeError', message: 'render failed', stack: error.stack } },
    { kind: 'slot-crash', slot: 'factory:panel', plugin: null, abdicated: false, error: { name: 'Error', message: 'thrown text', stack: '' } },
  ])
})

it('reports client logger warnings and errors, buffered ones first, with the plugin whose fiber logged them', () => {
  const fiber = { entry: { options: { id: 'x1', name: 'dsh-wallpaper-engine/client' } } }
  const { reports, exporters } = client([
    message({ sn: 3, type: 'error', name: 'loader', args: [new Error('import failed')] }),
    message({ sn: 4, type: 'info', name: 'hmr', args: ['ready'] }),
  ])
  for (const exporter of exporters) exporter.export(message({ sn: 9, type: 'warn', name: 'wallpaper', args: ['frame %s took %dms', 'main', 42, { late: true }], fiber: new WeakRef(fiber) as never }))
  expect(reports.slice(1)).toEqual([
    { kind: 'log', level: 'error', logger: 'loader', entry: null, message: expect.stringContaining('Error: import failed'), sn: 3 },
    { kind: 'log', level: 'warn', logger: 'wallpaper', entry: 'dsh-wallpaper-engine/client', message: 'frame main took 42ms {"late":true}', sn: 9 },
  ])
})

it('reports errors and rejections nothing caught, and stops when disposed', () => {
  const { page, reports, exporters, unsubscribe, stop } = client()
  page.dispatchEvent(Object.assign(new Event('error'), { error: new RangeError('out of range'), message: 'out of range' }))
  page.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'plain reason' }))
  expect(reports.slice(1)).toEqual([
    { kind: 'uncaught', rejection: false, error: expect.objectContaining({ name: 'RangeError', message: 'out of range' }) },
    { kind: 'uncaught', rejection: true, error: { name: 'Error', message: 'plain reason', stack: '' } },
  ])
  stop()
  page.dispatchEvent(Object.assign(new Event('error'), { error: new Error('after stop') }))
  expect(reports).toHaveLength(3)
  expect(exporters.size).toBe(0)
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('sends at most fifty reports a second and then says how many it dropped', () => {
  const { reports, crash, at } = client()
  for (let index = 0; index < MAX_CLIENT_REPORTS_PER_SECOND + 10; index++) crash('slot', {}, new Error(String(index)), { abdicated: false })
  expect(reports).toHaveLength(1 + MAX_CLIENT_REPORTS_PER_SECOND)
  at(1000)
  crash('slot', {}, new Error('next second'), { abdicated: false })
  expect(reports.slice(-2)).toEqual([{ kind: 'dropped', count: 10 }, expect.objectContaining({ kind: 'slot-crash', error: expect.objectContaining({ message: 'next second' }) })])
})

it('bounds what it sends', () => {
  const error = Object.assign(new Error('x'.repeat(20_000)), { stack: 'y'.repeat(40_000) })
  const bounded = clientError(error)
  expect(bounded.message).toHaveLength(8192)
  expect(bounded.stack).toHaveLength(MAX_CLIENT_STACK_CHARS)
  expect(bounded.stack.endsWith('…')).toBe(true)
  expect(formatLogMessage(['100%% done, %s', 'now', 'extra'])).toBe('100% done, now extra')
  expect(formatLogMessage(['missing %s'])).toBe('missing %s')
})
