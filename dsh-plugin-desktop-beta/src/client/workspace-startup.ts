/** Open launch folders only after the real Workspace and Session stores are ready. */
import type { DesktopWorkspaceLaunchBridge } from '../workspace-startup.ts'

export interface WorkspaceStartupTarget {
  ready(signal: AbortSignal): Promise<void>
  create(path: string): Promise<string>
  setRoots(workspaceId: string, roots: readonly string[]): Promise<void>
  open(workspaceId: string): Promise<void>
}

export function installWorkspaceStartup(target: WorkspaceStartupTarget, bridge: DesktopWorkspaceLaunchBridge): () => void {
  const abort = new AbortController()
  let running = false
  let requested = false
  const drain = async (): Promise<void> => {
    requested = true
    if (running) return
    running = true
    try {
      do {
        requested = false
        await target.ready(abort.signal)
        if (abort.signal.aborted) return
        const request = await bridge.take()
        if (!request || abort.signal.aborted) continue
        const primary = request.paths[0]
        try {
          if (!primary) throw new Error('The launch did not name a workspace folder')
          const workspaceId = await target.create(primary)
          if (abort.signal.aborted) return
          if (request.paths.length > 1) await target.setRoots(workspaceId, request.paths)
          if (abort.signal.aborted) return
          await target.open(workspaceId)
        } catch (error) {
          if (abort.signal.aborted) return
          // Do not silently open just the first folder after a refused multi-root update.
          await bridge.reportError(error instanceof Error ? error.message : String(error))
        }
        if (abort.signal.aborted) return
        await bridge.complete(request.id)
        requested = true
      } while (requested && !abort.signal.aborted)
    } catch (error) {
      if (!abort.signal.aborted) console.error('Desktop workspace launch failed', error)
    } finally { running = false }
  }
  const receive = (): void => { void drain() }
  const unsubscribe = bridge.onAvailable(receive)
  receive()
  return () => { abort.abort(); unsubscribe() }
}
