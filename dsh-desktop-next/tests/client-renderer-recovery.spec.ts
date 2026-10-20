import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { installRendererRecovery, rendererRecoveryInject } from '../src/client/renderer-recovery.ts'

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

function fixture(selected = false) {
  const generation = observable<{ id: number } | undefined>({ id: 1 })
  const state = observable('connected')
  const history = observable({ openState: 'loading' })
  const list = observable({ phase: 'ready', byId: selected ? { first: { id: 'first', retainedBy: { mainView: 1 } } } : {} })
  const binding = { session: history }
  const sessions = { list, binding: () => binding, refresh: vi.fn(async () => {}) }
  const connection = { generation, state, reconnect: vi.fn() }
  const panelInfo = observable<{ activePanelId: string | null }>({ activePanelId: null })
  const layout = { panelInfo, selectPanel: vi.fn((id: string) => panelInfo.set({ activePanelId: id })) }
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  const probe = vi.fn(async () => ({ ok: true }))
  const ctx = { get: (key: string) => key === 'sessions' ? sessions : connection, layout, remote: { session: { list: probe } } }
  const bridge = { profile: () => 'desktop', report: vi.fn(async (_status: string) => {}) }
  const install = () => installRendererRecovery(ctx as never, bridge)
  return { generation, state, history, list, sessions, connection, layout, storage, probe, bridge, install }
}

it('confirms a mounted client only after a live generation, successful reads and selected history', async () => {
  const f = fixture(true)
  const dispose = f.install()
  await settle()
  expect(f.bridge.report.mock.calls.map(([status]) => status)).toEqual(['connecting', 'syncing'])
  f.history.set({ openState: 'open' })
  expect(f.bridge.report).toHaveBeenLastCalledWith('healthy')
  expect(f.sessions.refresh).toHaveBeenCalledOnce()
  expect(f.connection.reconnect).not.toHaveBeenCalled()
  dispose()
})

it('accepts a genuinely empty, synchronized session catalog', async () => {
  const f = fixture()
  const dispose = f.install()
  await settle()
  expect(f.bridge.report).toHaveBeenLastCalledWith('healthy')
  dispose()
})

it('reaches healthy through the real Cordis service injection boundary', async () => {
  const f = fixture()
  const root = new Context()
  const services = { layout: f.layout, connection: f.connection, sessions: f.sessions, remote: { session: { list: f.probe } } }
  const releases = Object.entries(services).map(([name, value]) => root.reflect.provide(name, value))
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-api-remotes')
  const fiber = root.inject(['layout', ...rendererRecoveryInject], ctx => {
    ctx.effect(() => installRendererRecovery(ctx, f.bridge))
  })
  try {
    await fiber
    await settle()
    expect(f.probe).toHaveBeenCalledOnce()
    expect(f.bridge.report).toHaveBeenLastCalledWith('healthy')
  } finally {
    await fiber.dispose()
    for (const release of releases.reverse()) await release()
  }
})

it('rejects cached ready state when the new generation cannot read the Host', async () => {
  const f = fixture()
  f.probe.mockResolvedValueOnce({ ok: false })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const dispose = f.install()
  await settle()
  expect(f.bridge.report).not.toHaveBeenCalledWith('healthy')
  expect(f.sessions.refresh).not.toHaveBeenCalled()
  dispose()
})

it('fences late baseline completion after disconnect and confirms the replacement generation', async () => {
  const f = fixture()
  let finish!: () => void
  f.sessions.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const dispose = f.install()
  await settle()
  f.generation.set(undefined)
  finish()
  await settle()
  expect(f.bridge.report).not.toHaveBeenCalledWith('healthy')
  f.generation.set({ id: 2 })
  await settle()
  expect(f.bridge.report).toHaveBeenLastCalledWith('healthy')
  expect(f.sessions.refresh).toHaveBeenCalledTimes(2)
  dispose()
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

it('withdraws every observer and ignores pending work when the client fiber unmounts', async () => {
  const f = fixture(true)
  let finish!: () => void
  f.sessions.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const dispose = f.install()
  await settle()
  f.list.set({ ...f.list.getSnapshot() })
  const calls = f.bridge.report.mock.calls.length
  dispose()
  expect([f.generation, f.state, f.history, f.list, f.layout.panelInfo].map(source => source.listeners.size)).toEqual([0, 0, 0, 0, 0])
  finish(); await settle()
  f.generation.set({ id: 2 })
  expect(f.bridge.report).toHaveBeenCalledTimes(calls)
})
