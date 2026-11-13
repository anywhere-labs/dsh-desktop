import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, expect, it, vi } from 'vitest'
import * as startupEntries from '../src/host/startup-entries.ts'
import { pendingStartupEntries, readStartupEntries, type StartupLoaderEntry } from '../src/host/startup-entries.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it('lists what the Loader still waits on, the longest-waiting first, and members before their groups', () => {
  const settled: StartupLoaderEntry = { options: { id: 'done', name: 'done' }, fiber: { state: 2, inertia: undefined } }
  const importing: StartupLoaderEntry = { options: { id: 'import', name: '@fixture/import' }, _initTask: Promise.resolve() }
  const starting: StartupLoaderEntry = { options: { id: 'magpie-mcp-deepwiki', name: '@deepseek-ai/dsh-mcp-client' }, fiber: { state: 1, inertia: Promise.resolve() } }
  const stopping: StartupLoaderEntry = { options: { id: 'stop', name: '@fixture/stop' }, fiber: { state: 5, inertia: Promise.resolve() } }
  const group: StartupLoaderEntry = { options: { id: 'group', name: 'cordis:group', group: true }, fiber: { state: 1, inertia: Promise.resolve() }, subgroup: {} }
  const include: StartupLoaderEntry = { options: { id: 'include', name: 'cordis:include' }, fiber: { state: 1, inertia: Promise.resolve() }, subtree: {} }
  const created = new Map<StartupLoaderEntry, number>([[starting, 1_000], [stopping, 40_000]])
  expect(pendingStartupEntries([settled, group, include, importing, starting, stopping], entry => created.get(entry), 500, 60_500)).toEqual([
    { id: 'import', name: '@fixture/import', phase: 'importing', waitedMs: 60_000 },
    { id: 'magpie-mcp-deepwiki', name: '@deepseek-ai/dsh-mcp-client', phase: 'starting', waitedMs: 59_500 },
    { id: 'stop', name: '@fixture/stop', phase: 'stopping', waitedMs: 20_500 },
  ])
  // A tree whose members have all settled still names the container it waits on.
  expect(pendingStartupEntries([settled, include], () => undefined, 0, 2_000)).toEqual([{ id: 'include', name: 'cordis:include', phase: 'starting', waitedMs: 2_000 }])
  expect(pendingStartupEntries([settled], () => undefined, 0, 2_000)).toEqual([])
})

it('bounds what one answer carries', () => {
  const entries = Array.from({ length: 30 }, (_, index): StartupLoaderEntry => ({ options: { id: `${'i'.repeat(300)}${String(index)}`, name: 'n'.repeat(300) },
    _initTask: Promise.resolve() }))
  const listed = pendingStartupEntries(entries, entry => entries.indexOf(entry), 0, 100)
  expect(listed).toHaveLength(20)
  expect(listed[0]).toMatchObject({ waitedMs: 100 })
  expect(listed.every(entry => entry.id.length === 256 && entry.name.length === 256)).toBe(true)
})

it('answers from the live Loader while a plugin starts, and stops answering once its row is removed', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  let release!: () => void
  const connected = new Promise<void>(resolve => { release = resolve })
  ctx.loader.builtins.startup = startupEntries
  ctx.loader.builtins.mcp = { name: 'fixture-mcp', apply: () => connected }
  expect(readStartupEntries()).toBeUndefined()
  // `create` keeps an explicit id, the way the Host patch names its rows.
  const row = (id: string, name: string) => ({ id, name })
  await ctx.loader.create(row('desktop-next-startup-entries', 'cordis:startup'))
  await vi.waitFor(() => expect(readStartupEntries()).toEqual([]))
  const mounting = ctx.loader.create(row('magpie-mcp-deepwiki', 'cordis:mcp'))
  await vi.waitFor(() => expect(readStartupEntries()).toEqual([{ id: 'magpie-mcp-deepwiki', name: 'cordis:mcp', phase: 'starting', waitedMs: expect.any(Number) }]))
  release()
  await mounting
  await ctx.loader.await()
  expect(readStartupEntries()).toEqual([])
  ctx.loader.remove('desktop-next-startup-entries')
  await vi.waitFor(() => expect(readStartupEntries()).toBeUndefined())
})
