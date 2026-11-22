import type { Context } from '@deepseek-ai/cordis'
import { readPluginInventory } from '@deepseek-ai/dsh-host-plugin-inventory'
import { expect, it, vi } from 'vitest'
import { readLoaderInventory } from '../src/host/official-diagnostics.ts'

// The real official reader, unmocked: the Desktop's lean read must give the same projection it gives.
it('gets the official projection of every Loader entry without reading plugin metadata or preset compositions', async () => {
  const failure = new Error('apply failed: missing service')
  const parent = { tree: { ctx: { baseUrl: 'file:///profile/' } } }
  const entries = [
    { id: 'chat', options: { name: 'dsh-chat' }, parent, disabled: false, fiber: { state: 2, await: async () => {} } },
    { id: 'group', options: { name: 'group', group: true }, parent, disabled: false, fiber: { state: 2, await: async () => {} } },
    { id: 'broken', options: { name: 'dsh-broken' }, parent, disabled: false, fiber: { state: 3, await: () => Promise.reject(failure) } },
    { id: 'waiting', options: { name: 'dsh-waiting' }, parent, disabled: false, fiber: { state: 0, await: async () => {} } },
    { id: 'stopping', options: { name: 'dsh-stopping' }, parent, disabled: false, fiber: { state: 5, await: async () => {} } },
    { id: 'missing', options: { name: 'dsh-missing' }, parent, disabled: false, fiber: undefined },
    { id: 'off', options: { name: 'dsh-off' }, parent, disabled: true, fiber: undefined },
  ]
  const loader = { entries: () => entries.values() }
  const metaOf = vi.fn(() => ({ title: 'A plugin' }))
  const compositionInventory = vi.fn(async () => [])
  const services: Record<string, unknown> = { loader, pluginPackages: { metaOf }, agentPresets: { compositionInventory }, pluginManager: {} }
  const ctx = { loader, baseUrl: 'file:///profile/', get: (name: string) => services[name] } as unknown as Context

  const full = await readPluginInventory(ctx)
  expect(metaOf).toHaveBeenCalledTimes(6)
  expect(compositionInventory).toHaveBeenCalledOnce()
  metaOf.mockClear()
  compositionInventory.mockClear()

  const lean = await readLoaderInventory(ctx)
  expect(metaOf).not.toHaveBeenCalled()
  expect(compositionInventory).not.toHaveBeenCalled()
  expect(lean).toEqual(full.entries.map(({ meta: _meta, ...entry }) => entry))
  expect(lean).toEqual([
    { entryId: 'chat', moduleName: 'dsh-chat', enabled: true, fiberPhase: 'active' },
    { entryId: 'broken', moduleName: 'dsh-broken', enabled: true, fiberPhase: 'failed', diagnostic: 'apply failed: missing service' },
    { entryId: 'waiting', moduleName: 'dsh-waiting', enabled: true, fiberPhase: 'pending' },
    { entryId: 'stopping', moduleName: 'dsh-stopping', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'missing', moduleName: 'dsh-missing', enabled: true, fiberPhase: null },
    { entryId: 'off', moduleName: 'dsh-off', enabled: false, fiberPhase: null },
  ])
  await expect(readLoaderInventory({ get: () => undefined } as unknown as Context)).rejects.toThrow('The Loader is unavailable')
})
