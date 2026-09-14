import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { WORKSPACE_LAUNCH_NEXT, WORKSPACE_LAUNCH_COMPLETE } from '../workspace-launch-contract.ts'

/** Consume native launch requests through the existing Workspace and Session controllers. */
export function startWorkspaceLaunches(ctx: Context): () => void {
  const abort = new AbortController()
  const signal = abort.signal
  const completed = new Map<string, string | undefined>()
  const delay = (): Promise<void> => new Promise(resolve => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, 1000)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
  const run = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        if (ctx.workspaces.list.getSnapshot().phase !== 'ready' || ctx.sessions.list.getSnapshot().phase !== 'ready') {
          await delay(); continue
        }
        const response = await fetch(WORKSPACE_LAUNCH_NEXT, { method: 'POST', signal })
        if (!response.ok) throw new Error(`Workspace request failed (${response.status})`)
        const request: unknown = await response.json()
        if (request === null) continue
        if (typeof request !== 'object' || !('id' in request) || typeof request.id !== 'string'
          || !('path' in request) || typeof request.path !== 'string') throw new Error('Invalid workspace launch request')
        if (!completed.has(request.id)) {
          let failure: string | undefined
          try {
            const workspace = await ctx.workspaces.create({ path: request.path })
            if (signal.aborted) return
            const session = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)
            if (signal.aborted) return
            ctx.sessions.open(session)
          } catch (error) { failure = String(error).slice(0, 1500) }
          if (completed.size >= 16) completed.delete(completed.keys().next().value!)
          completed.set(request.id, failure)
        }
        const error = completed.get(request.id)
        const result = await fetch(WORKSPACE_LAUNCH_COMPLETE, {
          method: 'POST', signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: request.id, ...(error === undefined ? {} : { error }) }),
        })
        if (!result.ok) throw new Error(`Workspace completion failed (${result.status})`)
      } catch (error) {
        if (signal.aborted) return
        console.warn('Desktop workspace launch:', error)
        await delay()
      }
    }
  }
  void run()
  return () => { abort.abort() }
}
