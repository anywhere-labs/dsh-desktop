import { readDesktopWorkspaceSources, updateDesktopWorkspaceSource } from './workspace-sources-api.ts'
import type { WorkspaceSourcesSnapshot } from './workspace-sources-store.ts'

/** Return the attached root that contains a path, with primary roots included by the caller. */
export function workspaceRootForPath(
  path: string,
  roots: readonly string[],
  platform: string,
): string | undefined {
  const normalize = (value: string): string => {
    let result = value.replaceAll('\\', '/')
    while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1)
    return platform === 'win32' ? result.toLocaleLowerCase('en-US') : result
  }
  const candidate = normalize(path)
  return roots
    .filter(root => {
      const normalizedRoot = normalize(root)
      const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`
      return candidate === normalizedRoot || candidate.startsWith(prefix)
    })
    .sort((left, right) => right.length - left.length)[0]
}

export type WorkspaceSourcesQueue = <T>(workspacePath: string, operation: () => Promise<T>) => Promise<T>

/** Serialize every source read/write for a Workspace so older reads cannot overwrite mutations. */
export function createWorkspaceSourcesQueue(): WorkspaceSourcesQueue {
  const queues = new Map<string, Promise<unknown>>()
  return <T>(workspacePath: string, operation: () => Promise<T>): Promise<T> => {
    const previous = queues.get(workspacePath) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    queues.set(workspacePath, current)
    return current.finally(() => {
      if (queues.get(workspacePath) === current) queues.delete(workspacePath)
    })
  }
}

/** Serialize root changes through the same queue as snapshot reads and mutations. */
export function createWorkspaceRootSelection(
  readSources: typeof readDesktopWorkspaceSources = readDesktopWorkspaceSources,
  updateSources: typeof updateDesktopWorkspaceSource = updateDesktopWorkspaceSource,
  serialize: WorkspaceSourcesQueue = createWorkspaceSourcesQueue(),
): (
  workspacePath: string,
  root: string,
  onRootChange: (path: string) => Promise<void>,
  publish: (snapshot: WorkspaceSourcesSnapshot) => void,
) => Promise<void> {
  return (workspacePath, root, onRootChange, publish) =>
    serialize(workspacePath, async () => {
      // Persist first: Host workspaceFiles authorization checks the selected root
      // before it allows the new tree's first directory listing.
      const previous = await readSources(workspacePath)
      if (previous.selectedRoot === root) {
        await onRootChange(root)
        return
      }
      const selected = await updateSources('select', workspacePath, root)
      try {
        await onRootChange(root)
      } catch (error) {
        let restored: WorkspaceSourcesSnapshot | undefined
        try {
          restored = await updateSources('select', workspacePath, previous.selectedRoot)
          publish(restored)
        } catch (rollbackError) {
          console.error('dsh-plugin-desktop: failed to restore the previous Workspace source selection', rollbackError)
          // Host still authorizes `root`; keep the other Files tabs aligned with it.
          publish(selected)
        }
        try {
          await onRootChange(restored === undefined ? root : previous.selectedRoot)
        } catch (rollbackError) {
          console.error('dsh-plugin-desktop: failed to align the file root with Host authorization', rollbackError)
        }
        throw error
      }
      publish(selected)
    })
}
