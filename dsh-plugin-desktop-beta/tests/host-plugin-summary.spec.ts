import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { LogInput } from '../src/log-record.ts'

const inventory = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@deepseek-ai/dsh-host-plugin-inventory', () => ({ readPluginInventory: inventory.read }))
const { PLUGIN_CHANGE_SETTLE_MS, PluginSummary, recordSkippedBundles } = await import('../src/host/plugin-summary.ts')

afterEach(() => { inventory.read.mockReset(); vi.useRealTimers() })

const running = { get: (name: string) => name === 'loader' ? {} : undefined, fiber: { state: 2 } } as unknown as Context
const entry = (entryId: string, fiberPhase: string | null, extra: Record<string, unknown> = {}) =>
  ({ entryId, moduleName: `${entryId}-module`, enabled: true, fiberPhase, ...extra })

function summary() {
  const records: LogInput[] = []
  return { records, plugins: new PluginSummary(input => { records.push(input) }) }
}

it('lists enabled plugins that failed, never loaded or still wait, and counts the rest', async () => {
  inventory.read.mockResolvedValue({ entries: [
    entry('wallpaper', 'failed', { diagnostic: 'TypeError: tick failed' }),
    entry('broken-import', null),
    entry('needs-storage', 'pending'),
    entry('chat', 'active'),
    entry('switched-off', null, { enabled: false }),
  ] })
  const { records, plugins } = summary()
  await plugins.summarize(running, 'ready')
  expect(records).toEqual([
    { source: 'host.plugins', event: 'plugin.failed', level: 'error', message: 'TypeError: tick failed', fields: { pluginId: 'wallpaper', module: 'wallpaper-module' } },
    { source: 'host.plugins', event: 'plugin.not-loaded', level: 'warn', fields: { pluginId: 'broken-import', module: 'broken-import-module' } },
    { source: 'host.plugins', event: 'plugin.pending', level: 'warn', fields: { pluginId: 'needs-storage', module: 'needs-storage-module' } },
    { source: 'host.plugins', event: 'plugins.summary', level: 'warn', fields: { reason: 'ready', entries: 5, enabled: 4, active: 1, failed: 1, notLoaded: 1, pending: 1 } },
  ])
})

it('lists an entry again only when its problem changes, and once more when it becomes active', async () => {
  const { records, plugins } = summary()
  inventory.read.mockResolvedValue({ entries: [entry('wallpaper', 'failed', { diagnostic: 'first' }), entry('market', null)] })
  await plugins.summarize(running, 'ready')
  records.length = 0
  inventory.read.mockResolvedValue({ entries: [entry('wallpaper', 'failed', { diagnostic: 'second' }), entry('market', 'active')] })
  await plugins.summarize(running, 'plugins-changed')
  expect(records.map(record => [record.event, record.fields?.pluginId ?? record.fields?.reason])).toEqual([
    ['plugin.failed', 'wallpaper'], ['plugin.recovered', 'market'], ['plugins.summary', 'plugins-changed'],
  ])
  records.length = 0
  await plugins.summarize(running, 'plugins-changed')
  expect(records.map(record => record.event)).toEqual(['plugins.summary'])
})

it('records an inventory it cannot read instead of rejecting, and skips a Host without a Loader', async () => {
  const { records, plugins } = summary()
  inventory.read.mockRejectedValue(new Error('disabled expression threw'))
  await expect(plugins.summarize(running, 'ready')).resolves.toBeUndefined()
  expect(records).toEqual([expect.objectContaining({ event: 'summary.failed', level: 'warn', error: expect.any(Error) })])
  await plugins.summarize({ get: () => undefined, fiber: { state: 2 } } as unknown as Context, 'ready')
  expect(records).toHaveLength(1)
})

it('records each skipped bundle with why, up to fifty', () => {
  const records: LogInput[] = []
  recordSkippedBundles(Array.from({ length: 52 }, (_, index) => ({ packageName: `bundle-${String(index)}`, reason: `requires dsh ^0.3 (${String(index)})` })), input => { records.push(input) })
  expect(records[0]).toEqual({ source: 'host.profile', event: 'bundle.skipped', level: 'warn', message: 'requires dsh ^0.3 (0)', fields: { bundle: 'bundle-0' } })
  expect(records).toHaveLength(51)
  expect(records.at(-1)).toEqual({ source: 'host.profile', event: 'bundle.skipped.omitted', level: 'warn', fields: { count: 2 } })
})

it('summarizes again once plugin operations and plugin commands settle, and stops with its context', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  const { plugins } = summary()
  const summarize = vi.spyOn(plugins, 'summarize').mockResolvedValue()
  const fiber = ctx.plugin({ name: 'test-plugin-summary', apply: (child: Context) => { plugins.observe(child) } })
  await fiber.await()
  const emit = ctx.emit.bind(ctx) as (...args: unknown[]) => void
  emit('plugin-manager/operation', { phase: 'started' })
  vi.advanceTimersByTime(PLUGIN_CHANGE_SETTLE_MS)
  expect(summarize).not.toHaveBeenCalled()
  emit('plugin-manager/operation', { phase: 'settled' })
  vi.advanceTimersByTime(PLUGIN_CHANGE_SETTLE_MS - 1)
  emit('desktop/plugin-command', { phase: 'settled' })
  vi.advanceTimersByTime(PLUGIN_CHANGE_SETTLE_MS)
  expect(summarize).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'plugins-changed')
  emit('plugin-manager/operation', { phase: 'unknown' })
  await fiber.dispose()
  vi.advanceTimersByTime(PLUGIN_CHANGE_SETTLE_MS)
  expect(summarize).toHaveBeenCalledOnce()
})
