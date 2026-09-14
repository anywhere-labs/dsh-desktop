import type { HostRpc } from './host-rpc.ts'
import type { WorkspaceLaunchDelivery, WorkspaceLaunchRequest } from './workspace-launch-contract.ts'

/** Keep native path admission and pending requests in the main process. */
export function bindWorkspaceLaunches(rpc: HostRpc, launches: WorkspaceLaunchDelivery): () => void {
  const releaseNext = rpc.handle('workspace-launch:next', (_args, signal) => launches.next(signal))
  const releaseComplete = rpc.handle('workspace-launch:complete', ([id, error]) => {
    if (typeof id !== 'string' || (error !== undefined && typeof error !== 'string')) {
      throw new Error('Invalid workspace launch completion')
    }
    return launches.complete(id, error)
  })
  return () => { releaseNext(); releaseComplete() }
}

/** The Host exposes delivery routes while the supervisor owns acknowledgement. */
export function createHostWorkspaceLaunches(rpc: HostRpc): WorkspaceLaunchDelivery {
  return {
    next: signal => rpc.call<WorkspaceLaunchRequest | null>('workspace-launch:next', [], signal),
    complete: (id, error) => rpc.call<boolean>('workspace-launch:complete', [id, error]),
  }
}
