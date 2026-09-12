const DESKTOP_MARKER_PREFIX = 'dsh-desktop-'

function copyDesktopMarkers(source: URL, target: URL): void {
  for (const [key, value] of source.searchParams) {
    if (key.startsWith(DESKTOP_MARKER_PREFIX)) target.searchParams.append(key, value)
  }
}

/** Build a same-origin workbench URL without dropping the Desktop shell markers. */
export function withDesktopNavigationMarkers(target: string, currentUrl: string): string {
  const current = new URL(currentUrl)
  const destination = new URL(target, current.origin)
  for (const key of [...destination.searchParams.keys()]) {
    if (key.startsWith(DESKTOP_MARKER_PREFIX)) destination.searchParams.delete(key)
  }
  copyDesktopMarkers(current, destination)
  return destination.href
}

/** Return to DSH Home while preserving the markers that re-compose the Desktop shell. */
export function dshHomeUrl(currentUrl: string): string {
  const current = new URL(currentUrl)
  const home = new URL('/', current.origin)
  copyDesktopMarkers(current, home)
  return home.href
}
