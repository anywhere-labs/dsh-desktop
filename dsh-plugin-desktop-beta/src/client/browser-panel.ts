/**
 * Client controller for the Desktop browser panel.
 *
 * The panel chrome is ordinary DOM; the page itself is a native guest view
 * composited by the window server, so this controller owns exactly three
 * things: the panel's own open state, the placeholder rectangle it reports so
 * the shell can place the guest view, and the JSON channel that carries user
 * actions to the Host.
 */

import type { DesktopBrowserLayout, DesktopBrowserState } from '../desktop-browser-session.ts'

/** Absolute path of the Host channel; mirrors `DESKTOP_BROWSER_PATH`. */
const CHANNEL = '/api/dsh-desktop-browser'

/** Polling interval while the panel is visible. */
const OPEN_POLL_MS = 900

/** Polling interval while the panel is closed, so Agent requests still arrive. */
const CLOSED_POLL_MS = 2_000

/** Zoom levels offered by the panel's tool menu. */
export const BROWSER_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const

/** How much of the window one width step covers. */
export const BROWSER_COLUMN_STEP_RATIO = 0.08

/** Which transient surface currently covers the placeholder. */
export type BrowserPanelOcclusion = 'none' | 'menu' | 'history'

/** Immutable view state the React panel renders. */
export interface BrowserPanelSnapshot {
  /** Whether the panel is on screen. */
  readonly open: boolean
  /** Whether the last Host exchange succeeded. */
  readonly connected: boolean
  /** Latest Host state, or `null` before the first answer. */
  readonly state: DesktopBrowserState | null
  /** Last transport or policy failure, shown in the status row. */
  readonly error: string | undefined
  /** Current address-bar draft. */
  readonly address: string
  /** Zoom factor asked for in the fit layout. */
  readonly zoom: number
  /** Logical layout asked for. */
  readonly layout: DesktopBrowserLayout
  /** Transient surface that must hide the native view while open. */
  readonly occlusion: BrowserPanelOcclusion
  /** Panel epoch last applied from an Agent directive. */
  readonly appliedEpoch: number
  /** Whether the column currently covers the conversation instead of sharing the row. */
  readonly fullscreen: boolean
  /** Pages the active tab visited, newest first; empty until requested. */
  readonly history: readonly { readonly url: string; readonly title: string }[]
}

/** One viewport report sent to the Host. */
interface ViewportReport {
  readonly bounds: { x: number; y: number; width: number; height: number } | null
  readonly zoom: number
  readonly layout: DesktopBrowserLayout
  readonly visible: boolean
}

/** Controller options owned by the registration that hosts the panel. */
export interface DesktopBrowserPanelOptions {
  /** Notified whenever the panel's own visibility changes. */
  readonly onVisibility?: (open: boolean) => void
  /** Re-asserted while the panel stays open, so the column it lives in keeps its track. */
  readonly onEnsure?: (fullscreen: boolean) => void
  /** Ask the frame for another column width; the frame clamps it to its own limits. */
  readonly onResize?: (width: number, viewport: number) => void
  /** Ask the frame to give the column the whole row, or to share it again. */
  readonly onFullscreen?: (fullscreen: boolean) => void
  /** Release the column for a Session that is not showing the panel. */
  readonly onIdle?: () => void
}

/** Client-side owner of the Desktop browser panel. */
export class DesktopBrowserPanelController {
  private readonly sessionId: string
  private readonly options: DesktopBrowserPanelOptions
  private readonly listeners = new Set<() => void>()
  private snapshot: BrowserPanelSnapshot = {
    open: false,
    connected: false,
    state: null,
    error: undefined,
    address: '',
    zoom: 1,
    layout: 'fit',
    occlusion: 'none',
    appliedEpoch: 0,
    fullscreen: false,
    history: [],
  }
  private stage: HTMLElement | null = null
  private columnWidth = 0
  private columnWidthViewport = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private frame: number | undefined
  private disposed = false
  private lastReport: string = ''
  constructor(sessionId: string, options: DesktopBrowserPanelOptions = {}) {
    this.sessionId = sessionId
    this.options = options
  }

  /** Subscribe to snapshot changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Current snapshot; the identity changes only when the view state changes. */
  getSnapshot = (): BrowserPanelSnapshot => this.snapshot

  /** Start the polling loop once a panel instance mounts. */
  start(): void {
    if (this.disposed || this.timer !== undefined) return
    void this.poll()
  }

  /** Remember the column the frame currently gives this panel. */
  setColumn(width: number, viewport: number): void {
    this.columnWidth = width
    this.columnWidthViewport = viewport
  }

  /** Ask for a narrower column. */
  narrower(): void {
    this.stepColumn(-1)
  }

  /** Ask for a wider column. */
  wider(): void {
    this.stepColumn(1)
  }

  /** Give the column the whole row, or hand the conversation its width back. */
  toggleFullscreen(): void {
    const fullscreen = !this.snapshot.fullscreen
    this.update({ fullscreen })
    this.options.onFullscreen?.(fullscreen)
    this.scheduleGeometry()
  }

  /** Move the column by one step; the frame owns the limits. */
  private stepColumn(direction: -1 | 1): void {
    if (this.columnWidth <= 0 || this.columnWidthViewport <= 0) return
    const step = Math.round(this.columnWidthViewport * BROWSER_COLUMN_STEP_RATIO)
    this.options.onResize?.(this.columnWidth + direction * step, this.columnWidthViewport)
    this.scheduleGeometry()
  }

  /** Stop polling and release the placeholder. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    void this.post({ action: 'viewport', bounds: null }).catch(() => {})
    this.listeners.clear()
  }

  /** Attach or detach the element whose rectangle becomes the page viewport. */
  setStage(element: HTMLElement | null): void {
    this.stage = element
    this.scheduleGeometry()
  }

  /** Show or hide the panel. */
  setOpen(open: boolean): void {
    if (this.snapshot.open === open) return
    this.update({ open, error: undefined })
    this.notifyVisibility(open)
    // A column that was fullscreen when it closed comes back fullscreen.
    if (open && this.snapshot.fullscreen) this.options.onFullscreen?.(true)
    if (open) void this.post({ action: 'focus' }).catch(() => {})
    this.scheduleGeometry()
    void this.poll()
  }

  /** Tell the owning registration that the panel's visibility changed. */
  private notifyVisibility(open: boolean): void {
    try {
      this.options.onVisibility?.(open)
    } catch (cause) {
      // A column that cannot be claimed is a visible failure, not a silent one.
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error('[dsh-plugin-desktop] desktop browser column failed', cause)
      this.update({ error: message, open: false })
    }
  }

  /** Hand the column back when this Session is not the one showing a panel. */
  idle(): void {
    if (this.snapshot.open) return
    this.options.onIdle?.()
  }

  /** Flip the panel's visibility. */
  toggle(): void {
    this.setOpen(!this.snapshot.open)
  }

  /** Replace the address-bar draft. */
  setAddress(address: string): void {
    this.update({ address })
  }

  /** Choose a zoom factor for the fit layout. */
  setZoom(zoom: number): void {
    this.update({ zoom, layout: 'fit' })
    this.scheduleGeometry()
  }

  /** Choose the logical layout. */
  setLayout(layout: DesktopBrowserLayout): void {
    this.update({ layout })
    this.scheduleGeometry()
  }

  /** Mark a transient surface that must hide the native page while it is open. */
  setOcclusion(occlusion: BrowserPanelOcclusion): void {
    if (this.snapshot.occlusion === occlusion) return
    this.update({ occlusion })
    this.scheduleGeometry()
  }

  /** Run one action against the Host and fold the answer into the snapshot. */
  async act(action: Record<string, unknown>): Promise<Record<string, unknown>> {
    let answer: Record<string, unknown> = {}
    try {
      answer = await this.post(action)
      const state = answer.state as DesktopBrowserState | undefined
      this.update({
        connected: true,
        error: undefined,
        ...(state === undefined ? {} : { state, address: state.activeId === null ? this.snapshot.address : addressOf(state) }),
      })
    } catch (cause) {
      this.update({ connected: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
    this.scheduleGeometry()
    return answer
  }

  /** Load the active tab's own visit log for the history surface. */
  async loadHistory(): Promise<void> {
    const answer = await this.act({ action: 'history' })
    const history = Array.isArray(answer.history) ? answer.history : []
    this.update({
      history: history.flatMap(entry => {
        const record = entry as { url?: unknown; title?: unknown }
        return typeof record.url === 'string' ? [{ url: record.url, title: typeof record.title === 'string' ? record.title : '' }] : []
      }),
    })
  }

  /** Dismiss the current failure banner. */
  dismissError(): void {
    this.update({ error: undefined })
  }

  /** Navigate to the address bar's draft. */
  async submitAddress(): Promise<void> {
    const url = this.snapshot.address.trim()
    if (url === '') return
    await this.act({ action: 'navigate', url })
  }

  /** Recompute and send the placeholder rectangle. */
  private scheduleGeometry(): void {
    if (this.disposed || this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      void this.flushGeometry()
    })
  }

  /** Send the current placement, if it changed since the last report. */
  private async flushGeometry(): Promise<void> {
    const stage = this.stage
    // Window-level visibility belongs to the shell, which already hides the
    // guest view of a minimised or hidden window; this only reports the panel's
    // own state, so an occluded window never turns into a zero-sized page.
    const open = this.snapshot.open && this.snapshot.occlusion === 'none'
    let report: ViewportReport = { bounds: null, zoom: this.snapshot.zoom, layout: this.snapshot.layout, visible: false }
    if (stage !== null && this.snapshot.open) {
      const rect = stage.getBoundingClientRect()
      const visible = open && rect.width >= 1 && rect.height >= 1
      report = {
        bounds: visible || !open
          ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          : null,
        zoom: this.snapshot.zoom,
        layout: this.snapshot.layout,
        visible,
      }
    }
    const encoded = JSON.stringify(report)
    if (encoded === this.lastReport) return
    this.lastReport = encoded
    try {
      await this.post({ action: 'viewport', ...report })
    } catch {
      // Geometry is presentation only; the poll loop already reports failures.
    }
  }

  /** One polling round, scheduled again for the current open state. */
  private async poll(): Promise<void> {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    try {
      const answer = await this.request('GET')
      const state = answer.state as DesktopBrowserState | undefined
      const panel = answer.panel as { visible?: boolean; epoch?: number } | undefined
      const epoch = typeof panel?.epoch === 'number' ? panel.epoch : 0
      const directiveApplies = epoch > this.snapshot.appliedEpoch && panel?.visible !== this.snapshot.open
      this.update({
        connected: true,
        error: undefined,
        ...(state === undefined ? {} : { state }),
        ...(directiveApplies ? { open: panel?.visible === true, appliedEpoch: epoch } : epoch > this.snapshot.appliedEpoch ? { appliedEpoch: epoch } : {}),
        ...(state === undefined || state.activeId === null ? {} : { address: addressOf(state) }),
      })
      if (directiveApplies) {
        this.notifyVisibility(panel?.visible === true)
        this.scheduleGeometry()
      }
    } catch (cause) {
      this.update({ connected: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
    if (this.disposed) return
    this.timer = setTimeout(() => { void this.poll() }, this.snapshot.open ? OPEN_POLL_MS : CLOSED_POLL_MS)
    if (this.snapshot.open) {
      try {
        this.options.onEnsure?.(this.snapshot.fullscreen)
      } catch {
        // The next round retries; a lost track is re-asserted here.
      }
      this.scheduleGeometry()
    }
  }

  /** Post one action to the Host channel. */
  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await this.request('POST', JSON.stringify(body))
  }

  /** One channel exchange, with the Host's own failure codes surfaced. */
  private async request(method: 'GET' | 'POST', body?: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${CHANNEL}?sessionId=${encodeURIComponent(this.sessionId)}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
    })
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text === '' ? {} : JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`browser channel returned an unreadable answer (${String(response.status)})`)
    }
    if (!response.ok || payload.error !== undefined) {
      const detail = typeof payload.detail === 'string' ? payload.detail : undefined
      throw new Error(detail ?? String(payload.error ?? `browser channel failed (${String(response.status)})`))
    }
    return payload
  }

  /** Publish one snapshot change. */
  private update(patch: Partial<BrowserPanelSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    const changed = (Object.keys(next) as (keyof BrowserPanelSnapshot)[])
      .some(key => next[key] !== this.snapshot[key])
    if (!changed) return
    this.snapshot = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A broken view must not stop the channel.
      }
    }
  }
}

/** The address shown for one state: the active tab's URL. */
function addressOf(state: DesktopBrowserState): string {
  const active = state.tabs.find(tab => tab.id === state.activeId)
  return active?.url ?? ''
}
