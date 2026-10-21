/** Contract for the TinTin channel's native OpenFilm Studio view (WebContentsView + preload). */

/** Main process request channel for the Studio view lifecycle. */
export const OPENFILM_VIEW_CHANNEL = 'dsh-desktop:openfilm-view'

/** Main → renderer: what is selected in Studio and where the playhead is. */
export const OPENFILM_SELECTION_EVENT = 'dsh-desktop:openfilm-selection'

/** Main → renderer: Studio's "Reference in chat" (a ref the person pointed at). */
export const OPENFILM_REFER_EVENT = 'dsh-desktop:openfilm-refer'

/** Studio preload → main: the periodic selection/playhead report. */
export const OPENFILM_HOST_SELECTION = 'dsh-desktop:openfilm-host-selection'

/** Studio preload → main: a reference Studio's menus hand to the chat. */
export const OPENFILM_HOST_REFER = 'dsh-desktop:openfilm-host-refer'

/** Studio preload → main: what the pointer hovers in Studio (to light matching chat pills). */
export const OPENFILM_HOST_HOVER = 'dsh-desktop:openfilm-host-hover'

/** Main → Studio: a StudioCommand from the chat (reveal a reference, highlight, draft numbering). */
export const OPENFILM_COMMAND_EVENT = 'dsh-desktop:openfilm-command'

export interface OpenFilmBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One thing Studio points at (a clip, time, range, track, layer or file), as Studio serializes it. */
export interface OpenFilmStudioRef {
  kind: string
  [key: string]: unknown
}

/** Studio's report: the playhead, what is selected, and the range marked on the timeline. */
export interface OpenFilmSelection {
  projectId?: string
  time?: number
  refs?: OpenFilmStudioRef[]
  range?: { start: number; end: number } | null
  stage?: { w: number; h: number }
}

/** One request from the renderer to the main process. */
export type OpenFilmViewRequest =
  | { action: 'open'; url: string }
  | { action: 'show'; bounds: OpenFilmBounds }
  | { action: 'hide' }
  | { action: 'close' }
  | { action: 'focus' }

/** Whether the address is a local OpenFilm Studio page (http loopback, `/open` or `/`). */
export function isOpenFilmStudioUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'http:') return false
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false
  return url.pathname === '/open' || url.pathname === '/'
}

/** Whether bounds are sane integers a native view can take. */
export function isOpenFilmBounds(value: unknown): value is OpenFilmBounds {
  const bounds = value as Partial<OpenFilmBounds> | null
  if (!bounds || typeof bounds !== 'object') return false
  return ['x', 'y', 'width', 'height'].every((key) => {
    const n = bounds[key as keyof OpenFilmBounds]
    return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100_000
  })
}

/** Capability exposed by the context-isolated preload to the Desktop page. */
export interface DesktopOpenFilmBridge {
  open(url: string): Promise<{ ok: boolean; error?: string }>
  show(bounds: OpenFilmBounds): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  onSelection(listener: (selection: OpenFilmSelection) => void): () => void
  onRefer(listener: (ref: OpenFilmStudioRef) => void): () => void
  /** Chat → Studio: a StudioCommand (reveal/highlight/draft-refs, StudioHost.onCommand contract). */
  command(command: unknown): void
  /** Studio → chat: what the pointer hovers in Studio (null: nothing). */
  onHover(listener: (ref: OpenFilmStudioRef | null) => void): () => void
  /** Hand keyboard focus to the Studio view (Space = play/pause instead of page scroll). */
  focus(): Promise<void>
}
