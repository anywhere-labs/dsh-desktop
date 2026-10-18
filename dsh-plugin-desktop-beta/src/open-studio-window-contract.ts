/** Contract for the OpenFilm Studio window the TinTin channel opens from its sidebar entry. */

/** Main-world key of the context-isolated bridge. */
export const OPEN_STUDIO_WINDOW_BRIDGE = 'dshDesktopOpenStudio'

/** Single IPC channel: one validated Studio page address. */
export const OPEN_STUDIO_WINDOW_CHANNEL = 'dsh-desktop:open-studio-window'

/**
 * Only a local OpenFilm Studio page may be opened: plain http on the loopback
 * host, at `/open` (the address the CLI prints, key in the query) or `/`.
 * Anything else — another host, another scheme, a path outside Studio — is
 * refused, so a compromised renderer cannot use this bridge as an arbitrary
 * browser window.
 */
export function isStudioWindowUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'http:') return false
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false
  return url.pathname === '/open' || url.pathname === '/'
}

/** Capability exposed by the context-isolated preload to the Desktop page. */
export interface DesktopOpenStudioBridge {
  /** Open (or focus) the OpenFilm Studio window on a validated local address. */
  open(url: string): Promise<void>
}
