import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { startWorkspaceLaunches } from '../src/client/workspace-launch.ts'
import { WORKSPACE_LAUNCH_NEXT } from '../src/workspace-launch-contract.ts'

afterEach(() => { vi.unstubAllGlobals() })
it('uses existing controllers and retries an acknowledgement without opening another session', async () => {
  const open = vi.fn(); const create = vi.fn(async () => ({ workspaceId: 'workspace' }))
  const connect = vi.fn(async () => 'session')
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ phase: 'ready' }) }, create },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready' }) }, open },
    uiWorkspace: { connectWorkspace: connect },
  } as unknown as Context
  let completions = 0
  let stop = (): void => {}
  const request = vi.fn(async (url: string) => {
    if (url === WORKSPACE_LAUNCH_NEXT) return Response.json({ id: 'request', path: '/test 中文' })
    completions += 1
    if (completions === 1) return new Response('', { status: 503 })
    stop(); return Response.json({})
  })
  vi.stubGlobal('fetch', request)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  stop = startWorkspaceLaunches(ctx)
  try {
    await vi.waitFor(() => expect(completions).toBe(2), { timeout: 2500 })
    expect(create).toHaveBeenCalledExactlyOnceWith({ path: '/test 中文' })
    expect(connect).toHaveBeenCalledExactlyOnceWith('workspace')
    expect(open).toHaveBeenCalledExactlyOnceWith('session')
  } finally { stop(); warn.mockRestore() }
})
it('reports registration failure without switching the current session', async () => {
  const open = vi.fn(); let stop = (): void => {}; const completed = vi.fn()
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ phase: 'ready' }) }, create: async () => { throw new Error('gone') } },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready' }) }, open },
    uiWorkspace: { connectWorkspace: vi.fn() },
  } as unknown as Context
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    if (url === WORKSPACE_LAUNCH_NEXT) return Response.json({ id: 'request', path: '/missing' })
    completed(JSON.parse(String(options.body))); stop(); return Response.json({})
  })
  stop = startWorkspaceLaunches(ctx)
  try {
    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith({ id: 'request', error: 'Error: gone' }))
    expect(open).not.toHaveBeenCalled()
  } finally { stop() }
})
