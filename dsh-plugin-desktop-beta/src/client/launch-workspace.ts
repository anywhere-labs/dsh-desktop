import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  DESKTOP_OPEN_WORKSPACE_GLOBAL,
  DESKTOP_PENDING_WORKSPACE_GLOBAL,
} from '../launch-workspace-contract.ts'

/*
 * Wording constraint for this file: it is bundled into the browser client, and
 * `tests/package.spec.ts` asserts that bundle never matches the Node global
 * token followed by a dot or a bracket. Comments are kept in the bundle, so a
 * sentence ending on that token trips the assertion. Phrase around it.
 */

/** Folders parked on the page before the seam existed, in either shipped shape. */
type DesktopParkedWorkspacePaths = string | readonly string[]

/** Page seam the main side evaluates against to deliver launch folders. */
export interface DesktopLaunchWorkspaceWindow {
  __DSH_DESKTOP_OPEN_WORKSPACE__?: (paths: readonly string[]) => void
  __DSH_DESKTOP_PENDING_WORKSPACE__?: DesktopParkedWorkspacePaths
}

/** Everything the bridge needs from the client context, kept injectable for tests. */
export interface DesktopLaunchWorkspaceTarget {
  /** Settle once both workspace and session lists have arrived from the Host. */
  ready(): Promise<void>
  /**
   * Register one folder, reusing the existing Workspace when the path is known.
   * @param path - absolute folder the main side already admitted.
   * @returns the registered Workspace.
   */
  create(path: string): Promise<WorkspaceId>
  /**
   * Replace the Workspace's root folders, primary root first.
   *
   * The Host keeps a Session's working directory equal to the workspace's
   * primary root, so the remaining roots are attached before the Workspace is
   * opened and the first Session can start.
   * @param workspaceId - Workspace whose roots are replaced.
   * @param paths - absolute folders in launch order; the first is the primary root.
   */
  setRoots(workspaceId: WorkspaceId, paths: readonly string[]): Promise<void>
  /** Select one Workspace in the interface. */
  open(workspaceId: WorkspaceId): Promise<void>
  /** Record a failure that the native admission dialogs could not have caught. */
  reportError(message: string): void
}

/** Read either shipped shape of a parked hand-off as a folder list. */
function parkedWorkspacePaths(parked: DesktopParkedWorkspacePaths): readonly string[] {
  return typeof parked === 'string' ? [parked] : parked
}

/**
 * Register and open the folders one launch named.
 *
 * Waiting on `ready()` is not politeness: a Workspace row inserted before the
 * first Host baseline lands is wholesale-replaced when that baseline installs,
 * and the subsequent open then fails against an id the list no longer holds.
 *
 * The extra roots are attached before the open on purpose. A new Session takes
 * its working directory from the Workspace's primary root, so opening first
 * would let a user start a Session against a Workspace whose root policy is
 * still the single-folder one. When attaching them fails, the primary root is
 * already registered: the failure is reported and the open still runs, so the
 * launch degrades to the single-folder Workspace instead of opening nothing.
 * @param target - client-context seam.
 * @param paths - absolute folders the main side already admitted, primary first.
 */
export async function openDesktopLaunchWorkspace(
  target: DesktopLaunchWorkspaceTarget,
  paths: string | readonly string[],
): Promise<void> {
  const roots = typeof paths === 'string' ? [paths] : paths
  const primary = roots[0]
  if (primary === undefined) {
    target.reportError('failed to open the launch workspace: the launch named no folder')
    return
  }
  try {
    await target.ready()
    const workspaceId = await target.create(primary)
    if (roots.length > 1) {
      try {
        await target.setRoots(workspaceId, roots)
      } catch (cause) {
        target.reportError(
          `failed to attach the additional launch folders ${roots.join(', ')}: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
    await target.open(workspaceId)
  } catch (cause) {
    target.reportError(
      `failed to open the launch workspace ${roots.join(', ')}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

/**
 * Publish the launch-folder seam and drain anything delivered before it existed.
 *
 * The main side never waits for this plugin to install, so folders that arrive
 * first are parked on the page and collected here. That removes the timing
 * dependency in both directions.
 * @param target - client-context seam.
 * @param globalTarget - page object carrying the seam.
 * @returns disposer restoring whatever held the seam before.
 */
export function installDesktopLaunchWorkspaceBridge(
  target: DesktopLaunchWorkspaceTarget,
  globalTarget: DesktopLaunchWorkspaceWindow = window as DesktopLaunchWorkspaceWindow,
): () => void {
  const open = (paths: readonly string[]): void => { void openDesktopLaunchWorkspace(target, paths) }
  const previous = globalTarget[DESKTOP_OPEN_WORKSPACE_GLOBAL]
  globalTarget[DESKTOP_OPEN_WORKSPACE_GLOBAL] = open

  const parked = globalTarget[DESKTOP_PENDING_WORKSPACE_GLOBAL]
  if (parked !== undefined) {
    delete globalTarget[DESKTOP_PENDING_WORKSPACE_GLOBAL]
    open(parkedWorkspacePaths(parked))
  }

  return () => {
    if (globalTarget[DESKTOP_OPEN_WORKSPACE_GLOBAL] !== open) return
    if (previous === undefined) delete globalTarget[DESKTOP_OPEN_WORKSPACE_GLOBAL]
    else globalTarget[DESKTOP_OPEN_WORKSPACE_GLOBAL] = previous
  }
}
