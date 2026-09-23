/** Page seam the desktop client plugin publishes to accept a launch folder. */
export const DESKTOP_OPEN_WORKSPACE_GLOBAL = '__DSH_DESKTOP_OPEN_WORKSPACE__'

/** Slot holding a folder that arrived before the client plugin installed its seam. */
export const DESKTOP_PENDING_WORKSPACE_GLOBAL = '__DSH_DESKTOP_PENDING_WORKSPACE__'

/** Outcome reported by the injected delivery script. */
export type DesktopOpenWorkspaceDelivery = 'delivered' | 'pending'

/**
 * Build the fixed delivery script for one admitted folder.
 *
 * The script never awaits the page, so the main process is never blocked on a
 * renderer promise that is itself waiting on the Host connection. When the seam
 * is absent the folder is parked for the client plugin to drain on install,
 * which removes the timing dependency in both directions.
 * @param path - absolute folder already admitted by native policy.
 * @returns source evaluated in the Host page's main world.
 */
export function desktopOpenWorkspaceScript(path: string): string {
  return `(() => {
  const path = ${JSON.stringify(path)};
  const open = window.${DESKTOP_OPEN_WORKSPACE_GLOBAL};
  if (typeof open === 'function') { open(path); return 'delivered'; }
  window.${DESKTOP_PENDING_WORKSPACE_GLOBAL} = path;
  return 'pending';
})()`
}
