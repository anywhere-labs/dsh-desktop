/** Page seam the desktop client plugin publishes to accept launch folders. */
export const DESKTOP_OPEN_WORKSPACE_GLOBAL = '__DSH_DESKTOP_OPEN_WORKSPACE__'

/**
 * Slot holding launch folders that arrived before the client plugin installed
 * its seam.
 *
 * One launch now parks an array. An older main process parks a bare path
 * string, so the client bridge drains that shape too.
 */
export const DESKTOP_PENDING_WORKSPACE_GLOBAL = '__DSH_DESKTOP_PENDING_WORKSPACE__'

/** Outcome reported by the injected delivery script. */
export type DesktopOpenWorkspaceDelivery = 'delivered' | 'pending'

/** Folders one launch named, first one being the workspace's primary root. */
export type DesktopLaunchWorkspacePaths = string | readonly string[]

/** Normalize the single-path legacy call form to the list the seam takes. */
function toWorkspacePaths(paths: DesktopLaunchWorkspacePaths): readonly string[] {
  const list = typeof paths === 'string' ? [paths] : paths
  if (list.length === 0) throw new Error('dsh-plugin-desktop: launch workspace needs at least one folder')
  return list
}

/**
 * Build the fixed delivery script for the folders one launch named.
 *
 * The script never awaits the page, so the main process is never blocked on a
 * renderer promise that is itself waiting on the Host connection. When the seam
 * is absent the folders are parked for the client plugin to drain on install,
 * which removes the timing dependency in both directions.
 *
 * The seam always receives an array, even for one folder, so the client side
 * has a single shape to install; the single-path argument form stays readable
 * for callers that still name one folder.
 * @param paths - absolute folders already admitted by native policy.
 * @returns source evaluated in the Host page's main world.
 */
export function desktopOpenWorkspaceScript(paths: DesktopLaunchWorkspacePaths): string {
  return `(() => {
  const paths = ${JSON.stringify(toWorkspacePaths(paths))};
  const open = window.${DESKTOP_OPEN_WORKSPACE_GLOBAL};
  if (typeof open === 'function') { open(paths); return 'delivered'; }
  window.${DESKTOP_PENDING_WORKSPACE_GLOBAL} = paths;
  return 'pending';
})()`
}
