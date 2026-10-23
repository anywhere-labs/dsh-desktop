import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installRendererRecovery } from '../src/client/renderer-recovery.ts'

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; for (const listener of [...listeners]) listener() },
    listeners,
  }
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)) }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture() {
  const panelInfo = observable<{ activePanelId: string | null }>({ activePanelId: null })
  const layout = { panelInfo, selectPanel: vi.fn((id: string) => panelInfo.set({ activePanelId: id })) }
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  const bridge = { profile: () => 'desktop', report: vi.fn(async (_status: string) => {}) }
  const install = () => installRendererRecovery({ layout } as never, bridge)
  return { layout, storage, bridge, install }
}

it('reports a mounted shell healthy without any connection, Remote or session services', async () => {
  const f = fixture()
  const root = new Context()
  const provider = root.plugin({ apply(ctx: Context) { ctx.reflect.provide('layout', f.layout) } })
  await provider
  const fiber = root.plugin({
    inject: ['layout'],
    apply(ctx: Context) { ctx.effect(() => installRendererRecovery(ctx, f.bridge)) },
  })
  try {
    await fiber
    await settle()
    expect(f.bridge.report).toHaveBeenCalledExactlyOnceWith('healthy')
  } finally {
    await fiber.dispose()
    await provider.dispose()
  }
})

it('restores panel position per Profile and preserves updates without owning official drafts', async () => {
  const f = fixture()
  f.storage.set('dsh-next.panel.desktop', 'plugins')
  f.storage.set('dsh-next.panel.other', 'other-panel')
  const dispose = f.install()
  expect(f.layout.selectPanel).toHaveBeenCalledExactlyOnceWith('plugins')
  f.layout.panelInfo.set({ activePanelId: 'settings' })
  expect(f.storage.get('dsh-next.panel.desktop')).toBe('settings')
  f.layout.panelInfo.set({ activePanelId: null })
  expect(f.storage.has('dsh-next.panel.desktop')).toBe(false)
  expect(f.storage.get('dsh-next.panel.other')).toBe('other-panel')
  dispose()
  await settle()
})

it('withdraws its panel observer when the shell unmounts', async () => {
  const f = fixture()
  const dispose = f.install()
  dispose()
  expect(f.layout.panelInfo.listeners.size).toBe(0)
  f.layout.panelInfo.set({ activePanelId: 'plugins' })
  expect(f.storage.size).toBe(0)
  await settle()
  expect(f.bridge.report).toHaveBeenCalledExactlyOnceWith('healthy')
})

it('records a failed readiness report without throwing from the mount effect', async () => {
  const f = fixture()
  const error = new Error('IPC unavailable')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  f.bridge.report.mockRejectedValueOnce(error)
  const dispose = f.install()
  await settle()
  expect(log).toHaveBeenCalledWith('[next-recovery] readiness report failed', error)
  dispose()
})
