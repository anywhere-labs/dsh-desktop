import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SELECTION_KEY = 'dsh.sessions.current'

interface SessionListSnapshot {
  current: string | undefined
  phase: 'pending' | 'ready'
}

interface ClientSessionsInstance {
  list: {
    getSnapshot(): SessionListSnapshot
  }
  refresh(): Promise<void>
}

interface ClientSessionsCtor {
  new (ctx: Context, remote: unknown): ClientSessionsInstance
  prototype: {
    followCurrent(): void
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

type SessionListResult =
  | {
      ok: true
      value: {
        items: Array<{
          sessionId: string
          updatedAt: number
          running: boolean
          blank: boolean
        }>
      }
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        details: Record<string, never>
      }
    }

let nextModuleLoad = 0

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function persistedSelection(): Map<string, string> {
  const storage = new Map<string, string>([
    [SELECTION_KEY, JSON.stringify({ sessionId: 's-restored' })],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
  })
  return storage
}

async function flushProjection(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function loadClientSessions(): Promise<ClientSessionsCtor> {
  const bundleUrl = new URL(
    '../node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js',
    import.meta.url,
  )
  const source = await readFile(bundleUrl, 'utf8')
  const fixedSelectionGuard = 'if (phase === "ready" && persisted !== void 0) this.selection.set({});'
  if (!source.includes(fixedSelectionGuard)) {
    throw new Error('installed alpha session-controller is missing the startup selection patch')
  }

  const exportNeedle = 'exports.MutableSessionEventSource = MutableSessionEventSource;'
  if (!source.includes(exportNeedle)) {
    throw new Error('alpha session-controller bundle no longer exposes the expected export block')
  }
  const exposed = source
    .replace(
      exportNeedle,
      `exports.__testClientSessions = ClientSessions;\n\t\t${exportNeedle}`,
    )
    .replace(/\n\/\/# sourceMappingURL=.*$/u, '')
  const require = createRequire(bundleUrl)
  const modules = new Map<string, Record<string, unknown>>()
  const moduleLoader = {
    load(definition: {
      id: string
      factory: (requireFn: NodeRequire) => Record<string, unknown>
    }) {
      const value = definition.factory(require)
      modules.set(definition.id, value)
      return value
    },
  }
  ;(globalThis as { window?: unknown }).window = { __ModuleLoader__: moduleLoader }
  const dataUrl = `data:text/javascript;base64,${Buffer.from(
    `${exposed}\n// test-load ${nextModuleLoad++}`,
  ).toString('base64')}`
  await import(/* @vite-ignore */ dataUrl)
  const loaded = modules.get('@deepseek-ai/dsh-api-session-controller')
  const ctor = loaded?.__testClientSessions
  if (typeof ctor !== 'function') throw new Error('alpha session-controller test seam was not exposed')
  return ctor as unknown as ClientSessionsCtor
}

function service(
  ClientSessions: ClientSessionsCtor,
  list: () => Promise<SessionListResult>,
): ClientSessionsInstance {
  return new ClientSessions(new Context(), { session: { list } })
}

describe('alpha session-controller startup restore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('keeps the persisted selection while the first Session baseline is pending', async () => {
    const storage = persistedSelection()
    const ClientSessions = await loadClientSessions()
    const baseline = deferred<SessionListResult>()
    const sessions = service(ClientSessions, () => baseline.promise)

    void sessions.refresh()
    await flushProjection()

    expect(sessions.list.getSnapshot()).toMatchObject({ current: undefined, phase: 'pending' })
    expect(storage.get(SELECTION_KEY)).toContain('s-restored')
  })

  it('keeps the persisted selection when the first Session baseline fails', async () => {
    const storage = persistedSelection()
    const ClientSessions = await loadClientSessions()
    const sessions = service(ClientSessions, async () => ({
      ok: false,
      error: { code: 'internal', message: 'host unavailable', details: {} },
    }))

    await sessions.refresh()
    await flushProjection()

    expect(sessions.list.getSnapshot()).toMatchObject({ current: undefined, phase: 'pending' })
    expect(storage.get(SELECTION_KEY)).toContain('s-restored')
  })

  it('keeps a persisted selection through a delayed baseline that validates it', async () => {
    const storage = persistedSelection()
    const ClientSessions = await loadClientSessions()
    // This test targets projection/persistence only; suppress the unrelated
    // event-window opening that follows a successfully restored current id.
    ClientSessions.prototype.followCurrent = () => {}
    const baseline = deferred<SessionListResult>()
    const sessions = service(ClientSessions, () => baseline.promise)

    const refresh = sessions.refresh()
    await flushProjection()
    expect(storage.get(SELECTION_KEY)).toContain('s-restored')

    baseline.resolve({
      ok: true,
      value: {
        items: [{
          sessionId: 's-restored',
          updatedAt: 1,
          running: false,
          blank: false,
        }],
      },
    })
    await refresh
    await flushProjection()

    expect(sessions.list.getSnapshot()).toMatchObject({ current: 's-restored', phase: 'ready' })
    expect(storage.get(SELECTION_KEY)).toContain('s-restored')
  })

  it('clears a missing persisted selection only after an authoritative ready baseline', async () => {
    const storage = persistedSelection()
    const ClientSessions = await loadClientSessions()
    const baseline = deferred<SessionListResult>()
    const sessions = service(ClientSessions, () => baseline.promise)

    const refresh = sessions.refresh()
    await flushProjection()
    expect(storage.get(SELECTION_KEY)).toContain('s-restored')

    baseline.resolve({ ok: true, value: { items: [] } })
    await refresh
    await flushProjection()

    expect(sessions.list.getSnapshot()).toMatchObject({ current: undefined, phase: 'ready' })
    expect(storage.get(SELECTION_KEY)).not.toContain('s-restored')
  })
})
