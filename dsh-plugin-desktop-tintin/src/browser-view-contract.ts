/** Contract for the TinTin channel's embedded browser view (WebContentsView + preload). */

/** Main process request channel for the embedded browser view lifecycle. */
export const BROWSER_VIEW_CHANNEL = 'dsh-desktop:browser-view'

export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One request from the renderer to the main process. */
export type BrowserViewRequest =
  | { action: 'open' }
  | { action: 'show'; bounds: BrowserViewBounds }
  | { action: 'hide' }
  | { action: 'close' }

/** Whether bounds are sane integers a native view can take. */
export function isBrowserBounds(value: unknown): value is BrowserViewBounds {
  const bounds = value as Partial<BrowserViewBounds> | null
  if (!bounds || typeof bounds !== 'object') return false
  return ['x', 'y', 'width', 'height'].every((key) => {
    const n = bounds[key as keyof BrowserViewBounds]
    return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100_000
  })
}

/** Capability exposed by the context-isolated preload to the Desktop page. */
export interface DesktopBrowserViewBridge {
  open(): Promise<{ ok: boolean; error?: string }>
  show(bounds: BrowserViewBounds): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
}
