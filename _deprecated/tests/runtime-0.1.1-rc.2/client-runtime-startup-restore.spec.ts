import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { IApiClient, RpcResponse, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function workspace(
  id: string,
  sessionIds: SessionId[] = [],
  createdAt = '2026-01-02T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

interface SessionRuntimeCtor {
  new (ctx: Context, api: IApiClient, remote: unknown): {
    list: {
      getSnapshot(): {
        current: SessionId | undefined
        phase: 'pending' | 'ready'
      }
    }
    refresh(): Promise<void>
  }
}

interface WorkspaceRuntimeCtor {
  new (ctx: Context, api: IApiClient, sessions: unknown): {
    startInitialSelection(): () => void
    refresh(): Promise<void>
  }
}

let nextModuleLoad = 0

async function loadClientRuntime(): Promise<{
  SessionRuntime: SessionRuntimeCtor
  WorkspaceRuntime: WorkspaceRuntimeCtor
}> {
  const bundleUrl = new URL('../node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js', import.meta.url)
  const require = createRequire(bundleUrl)
  const moduleLoader = {
    modules: new Map<string, unknown>(),
    load(definition: { id: string; factory: (requireFn: NodeRequire) => unknown }) {
      const value = definition.factory(require)
      this.modules.set(definition.id, value)
      return value
    },
  }
  ;(globalThis as { window?: unknown }).window = { __ModuleLoader__: moduleLoader }
  await import(`${pathToFileURL(bundleUrl.pathname).href}?test-load=${nextModuleLoad++}`)
  return moduleLoader.modules.get('@deepseek-ai/dsh-client-runtime') as {
    SessionRuntime: SessionRuntimeCtor
    WorkspaceRuntime: WorkspaceRuntimeCtor
  }
}

let nextRpc = 0

function ok<T>(value: T): RpcResponse<T> {
  return {
    rpcId: `fake-${nextRpc++}` as never,
    result: { ok: true, value },
  }
}

function fakeRemote() {
  return {
    commands: {
      list: async () => ({ ok: true, value: [] }),
      execute: async () => ({ ok: true, value: undefined }),
    },
  } as const
}

class FakeApiClient {
  readonly calls: Array<{ method: string; payload: unknown }> = []

  onList: () => Promise<RpcResponse<{ items: never[] }>> = async () => ok({ items: [] })
  onCreate: () => Promise<RpcResponse<{ sessionId: SessionId }>> = async () => ok({ sessionId: sid('s-new') })
  onHistory: () => Promise<RpcResponse<{ events: never[]; hasMore: boolean }>> = async () => ok({ events: [], hasMore: false })
  onWorkspaceList: () => Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds?: never[] }>> = async () => ok({ items: [] })

  readonly sessions: Pick<IApiClient['sessions'], 'list' | 'create' | 'history'> = {
    list: async (payload: unknown) => this.record('session.list', payload, await this.onList()),
    create: async (payload: unknown) => this.record('session.create', payload, await this.onCreate()),
    history: async (payload: unknown) => this.record('session.history', payload, await this.onHistory()),
  }

  readonly workspace: Pick<IApiClient['workspace'], 'list'> = {
    list: async (payload: unknown) => this.record(
      'workspace.list',
      payload,
      await this.onWorkspaceList().then(response => ({
        ...response,
        result: {
          ok: true as const,
          value: { archivedSessionIds: [] as never[], ...(response.result as { ok: true; value: { items: WorkspaceView[] } }).value },
        },
      })),
    ),
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, response: T): T {
    this.calls.push({ method, payload })
    return response
  }
}

describe('client runtime startup restore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('keeps a persisted selection while the authoritative session baseline is still pending', async () => {
    const { SessionRuntime, WorkspaceRuntime } = await loadClientRuntime()
    const storage = new Map<string, string>([
      ['dsh.sessions.current', JSON.stringify({ sessionId: 's-restored' })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    })

    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api as unknown as IApiClient, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api as unknown as IApiClient, sessions)
    const stop = workspaces.startInitialSelection()

    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('recent')],
    }))
    let resolveSessionList!: (response: RpcResponse<{ items: never[] }>) => void
    api.onList = () => new Promise(resolve => { resolveSessionList = resolve })
    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-new') }))

    const sessionRefresh = sessions.refresh()
    await workspaces.refresh()
    await flush()

    expect(api.callsOf('session.create')).toEqual([])
    expect(sessions.list.getSnapshot().current).toBeUndefined()
    expect(sessions.list.getSnapshot().phase).toBe('pending')
    expect(storage.get('dsh.sessions.current')).toContain('s-restored')

    resolveSessionList(ok({
      items: [{
        sessionId: sid('s-restored'),
        updatedAt: Date.parse('2026-01-03T00:00:00.000Z'),
        running: false,
        blank: false,
        cwd: '/w/recent',
      }] as never[],
    }))

    await sessionRefresh
    await flush()

    expect(api.callsOf('session.create')).toEqual([])
    expect(sessions.list.getSnapshot().current).toBe('s-restored')
    expect(storage.get('dsh.sessions.current')).toContain('s-restored')
    stop()
  })

  it('clears a deleted selection after an authoritative missing baseline and opens the workspace default', async () => {
    const { SessionRuntime, WorkspaceRuntime } = await loadClientRuntime()
    const storage = new Map<string, string>([
      ['dsh.sessions.current', JSON.stringify({ sessionId: 's-deleted' })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    })

    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api as unknown as IApiClient, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api as unknown as IApiClient, sessions)
    const stop = workspaces.startInitialSelection()

    api.onWorkspaceList = () => Promise.resolve(ok({ items: [workspace('recent')] }))
    api.onList = () => Promise.resolve(ok({ items: [] }))
    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-new') }))

    await Promise.all([workspaces.refresh(), sessions.refresh()])
    await flush()

    expect(sessions.list.getSnapshot().phase).toBe('ready')
    expect(storage.get('dsh.sessions.current')).not.toContain('s-deleted')
    expect(api.callsOf('session.create')).toEqual([{ workspaceId: 'recent' }])
    expect(sessions.list.getSnapshot().current).toBe('s-new')
    stop()
  })
})
