import { DESKTOP_WORKSPACE_ARGUMENT, desktopLaunchWorkspaceRequest } from '../../dsh-plugin-desktop/src/launch-workspace-path.ts'

/** Modern Electron launches carry an application directory as argv[1] in development.
 * Only an explicit attached workspace flag is user intent; neither that app entry nor
 * background Node re-entry arguments may silently become a workspace. */
export function desktopWorkspaceLaunchPaths(argv: readonly string[], platform: NodeJS.Platform = process.platform): readonly string[] | undefined {
  if (!argv.some(argument => argument.startsWith(`${DESKTOP_WORKSPACE_ARGUMENT}=`))) return undefined
  return desktopLaunchWorkspaceRequest(argv, platform)?.paths
}

/** Native launch requests remain with the runtime until their owning document acknowledges them. */
export interface DesktopWorkspaceLaunch {
  readonly id: number
  readonly paths: readonly string[]
}
interface PendingLaunch extends DesktopWorkspaceLaunch {
  readonly profile: string
  document?: string
}

export class DesktopWorkspaceLaunches {
  private sequence = 0
  private readonly pending: PendingLaunch[] = []

  enqueue(profile: string, paths: readonly string[]): void {
    if (paths.length) this.pending.push({ id: ++this.sequence, profile, paths: [...paths] })
  }

  /** A reload reclaims the same request; a different Profile cannot receive it. */
  take(profile: string, document: string): DesktopWorkspaceLaunch | null {
    const request = this.pending.find(item => item.profile === profile)
    if (!request || request.document === document) return null
    request.document = document
    return { id: request.id, paths: [...request.paths] }
  }

  complete(profile: string, document: string, id: number): boolean {
    const index = this.pending.findIndex(item => item.id === id && item.profile === profile && item.document === document)
    if (index < 0) return false
    this.pending.splice(index, 1)
    return true
  }
}

/** Only the app preload exposes this document-bound transport. */
export interface DesktopWorkspaceLaunchBridge {
  take(): Promise<DesktopWorkspaceLaunch | null>
  complete(id: number): Promise<void>
  reportError(message: string): Promise<void>
  onAvailable(listener: () => void): () => void
}
