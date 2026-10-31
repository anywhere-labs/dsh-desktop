/** Apply-world coordinator for the Desktop terminal panel: tabs, views, and drawer chrome state. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TerminalView } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { TerminalShell, WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser-global UUID source; avoids a module-table request the Desktop client bundle does not seed. */
function panelUuid(): string {
  return globalThis.crypto.randomUUID()
}

/** The slice of the Client terminal service the coordinator drives; satisfied by `ctx.webTerminals`. */
export interface DesktopTerminalViewSource {
  view(sessionId: SessionId, key: string, contentId: string, terminalId?: WebTerminalId, shellPath?: string): TerminalView
  close(sessionId: SessionId, key: string, contentId: string, terminalId?: WebTerminalId): void
  launchShells(sessionId: SessionId, signal: AbortSignal): Promise<{ shells: readonly TerminalShell[]; selectedShell: string | undefined }>
  retainTabs(tabs: readonly { sessionId: SessionId; tabId: string; contentId: string }[]): void
}

/** One terminal tab: view registry key plus the durable content identity the Host binding hangs on. */
export interface DesktopTerminalPanelTab {
  key: string
  contentId: string
  createdAt: number
}

/** Per-Session tab strip state. */
export interface DesktopTerminalPanelSessionTabs {
  tabs: DesktopTerminalPanelTab[]
  activeKey: string | undefined
}

/** Reactive drawer chrome and tab layout shared by the launcher, the panel, and the holds bridge. */
export interface DesktopTerminalPanelSnapshot {
  open: boolean
  height: number
  historyRailOpen: boolean
  /** xterm font size shared by every tab, persisted. */
  fontSize: number
  tabsBySession: Record<string, DesktopTerminalPanelSessionTabs>
  /** Tabs pinned across sessions: they stay visible (and connected) on every workspace switch. */
  pinnedKeys: string[]
  /** Panel-level focused tab; may point at a pinned foreign tab. */
  focusedKey: string | undefined
}

/** One live TerminalView plus the identities close() needs later. */
interface RegisteredTerminal {
  readonly sessionId: SessionId
  readonly contentId: string
  readonly view: TerminalView
}

const STORAGE_KEY = 'dsh-desktop-terminal-panel.v1'
const MIN_HEIGHT = 200
const MAX_HEIGHT = 800
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 24
const DEFAULT_FONT_SIZE = 13
/** Custom DOM event asking the owning screen to take focus after a history insertion. */
export const TERMINAL_PANEL_FOCUS_EVENT = 'dsh-desktop-terminal-panel:focus'

/** Clamp the drawer height to its usable range. */
function clampHeight(height: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)))
}

/** Clamp the terminal font size to its usable range. */
function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)))
}

interface PersistedPanel {
  readonly open?: boolean
  readonly height?: number
  readonly historyRailOpen?: boolean
  readonly fontSize?: number
  readonly tabsBySession?: Record<string, DesktopTerminalPanelSessionTabs>
  readonly pinnedKeys?: readonly string[]
  readonly focusedKey?: string
}

function readPersistedPanel(): PersistedPanel {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return {}
    return value as PersistedPanel
  } catch (_unavailable) { return {} }
}

/** Validate one persisted session bucket before trusting it for restoration. */
function persistedTabs(value: PersistedPanel): Record<string, DesktopTerminalPanelSessionTabs> {
  const source = value.tabsBySession
  if (typeof source !== 'object' || source === null) return {}
  const out: Record<string, DesktopTerminalPanelSessionTabs> = {}
  for (const [sessionId, bucket] of Object.entries(source)) {
    if (typeof bucket !== 'object' || bucket === null || !Array.isArray(bucket.tabs)) continue
    const tabs = bucket.tabs.filter((tab): tab is DesktopTerminalPanelTab =>
      typeof tab === 'object' && tab !== null
      && typeof tab.key === 'string' && typeof tab.contentId === 'string' && typeof tab.createdAt === 'number')
    if (tabs.length === 0) continue
    out[sessionId] = { tabs, activeKey: typeof bucket.activeKey === 'string' ? bucket.activeKey : tabs[0]?.key }
  }
  return out
}

/**
 * Owns the terminal panel's cross-entry state. Terminal views are created
 * here because only the apply world may touch `webTerminals`; components
 * receive views and mutations through the inject face.
 */
export class DesktopTerminalPanelCoordinator {
  /** Drawer and tab state, bound into components as a hooks-compartment source. */
  readonly snapshot: SnapshotStore<DesktopTerminalPanelSnapshot>
  private readonly registry = new Map<string, RegisteredTerminal>()

  /**
   * @param terminals - the Client terminal model service backing every view.
   */
  constructor(private readonly terminals: DesktopTerminalViewSource) {
    const persisted = readPersistedPanel()
    const tabsBySession = persistedTabs(persisted)
    const liveKeys = new Set(Object.values(tabsBySession).flatMap(bucket => bucket.tabs.map(tab => tab.key)))
    this.snapshot = createSnapshotStore<DesktopTerminalPanelSnapshot>({
      open: persisted.open ?? false,
      height: clampHeight(persisted.height ?? 340),
      historyRailOpen: persisted.historyRailOpen ?? true,
      fontSize: clampFontSize(persisted.fontSize ?? DEFAULT_FONT_SIZE),
      tabsBySession,
      // A pinned or focused key whose tab vanished is dropped at restore.
      pinnedKeys: (persisted.pinnedKeys ?? []).filter(key => typeof key === 'string' && liveKeys.has(key)),
      focusedKey: persisted.focusedKey !== undefined && liveKeys.has(persisted.focusedKey) ? persisted.focusedKey : undefined,
    })
    this.snapshot.subscribe(() => { this.persist() })
    if (typeof window !== 'undefined') {
      this.flushOnHide = () => { this.persistNow() }
      window.addEventListener('pagehide', this.flushOnHide)
    }
  }

  private readonly flushOnHide: (() => void) | undefined = undefined

  /** Stop persistence timers and listeners on plugin unload. */
  dispose(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = undefined
    this.persistNow()
    if (typeof window !== 'undefined' && this.flushOnHide !== undefined) window.removeEventListener('pagehide', this.flushOnHide)
  }

  /** Flip the drawer, the Ctrl+J / launcher path. */
  toggle(): void {
    this.snapshot.update(draft => { draft.open = !draft.open })
  }

  /** Close the drawer; terminal processes keep running. */
  close(): void {
    this.snapshot.update(draft => { draft.open = false })
  }

  /**
   * Set the drawer height from the resize handle.
   * @param height - desired pixel height, clamped to the usable range.
   */
  setHeight(height: number): void {
    this.snapshot.update(draft => { draft.height = clampHeight(height) })
  }

  /** Flip the right-hand history rail. */
  toggleHistoryRail(): void {
    this.snapshot.update(draft => { draft.historyRailOpen = !draft.historyRailOpen })
  }

  /**
   * Set the shared terminal font size; screens refit on the next render.
   * @param size - desired pixel font size, clamped to 10–24.
   */
  setFontSize(size: number): void {
    this.snapshot.update(draft => { draft.fontSize = clampFontSize(size) })
  }

  /**
   * Pin or unpin a tab. Pinned tabs render on every Session's strip and keep
   * their mounted screen and Host shell across workspace switches.
   * @param key - tab key.
   */
  togglePin(key: string): void {
    this.snapshot.update(draft => {
      const index = draft.pinnedKeys.indexOf(key)
      if (index >= 0) draft.pinnedKeys.splice(index, 1)
      else draft.pinnedKeys.push(key)
    })
  }

  /**
   * Focus one tab on the strip, updating its owning Session bucket too.
   * @param key - tab key; may belong to another Session when pinned.
   */
  focusTab(key: string): void {
    this.snapshot.update(draft => {
      draft.focusedKey = key
      for (const [sessionId, bucket] of Object.entries(draft.tabsBySession)) {
        if (bucket.tabs.some(tab => tab.key === key)) {
          draft.tabsBySession[sessionId] = { ...bucket, activeKey: key }
          break
        }
      }
    })
  }

  /**
   * Find the Session owning a tab key.
   * @param key - tab key.
   * @returns the owning Session id, or undefined for an unknown tab.
   */
  ownerOf(key: string): SessionId | undefined {
    for (const [sessionId, bucket] of Object.entries(this.snapshot.getSnapshot().tabsBySession)) {
      if (bucket.tabs.some(tab => tab.key === key)) return sessionId as SessionId
    }
    return undefined
  }

  /**
   * Open a fresh tab for a Session, allocating its shell on first render.
   * @param sessionId - owning Session.
   * @param shellPath - explicit shell from the picker; omitted uses the remembered default.
   */
  openTab(sessionId: SessionId, shellPath?: string): void {
    const key = panelUuid()
    const contentId = panelUuid()
    const view = this.terminals.view(sessionId, key, contentId, undefined, shellPath)
    this.registry.set(key, { sessionId, contentId, view })
    this.snapshot.update(draft => {
      const bucket = draft.tabsBySession[sessionId as string] ?? { tabs: [], activeKey: undefined }
      const tab: DesktopTerminalPanelTab = { key, contentId, createdAt: Date.now() }
      draft.tabsBySession[sessionId as string] = {
        tabs: [...bucket.tabs, tab],
        activeKey: tab.key,
      }
    })
  }

  /**
   * Recreate views for restored tabs of one Session; existing Host terminals
   * are reattached through the persisted content binding.
   * @param sessionId - Session whose tabs are becoming visible.
   */
  ensureViews(sessionId: SessionId): void {
    const bucket = this.snapshot.getSnapshot().tabsBySession[sessionId as string]
    if (bucket === undefined) return
    for (const tab of bucket.tabs) {
      if (this.registry.has(tab.key)) continue
      const view = this.terminals.view(sessionId, tab.key, tab.contentId)
      this.registry.set(tab.key, { sessionId, contentId: tab.contentId, view })
    }
  }

  /**
   * Close a tab and terminate its terminal shell.
   * @param sessionId - owning Session.
   * @param key - tab key.
   */
  closeTab(sessionId: SessionId, key: string): void {
    const entry = this.registry.get(key)
    if (entry !== undefined) this.terminals.close(sessionId, key, entry.contentId)
    this.registry.delete(key)
    this.snapshot.update(draft => {
      draft.pinnedKeys = draft.pinnedKeys.filter(pinned => pinned !== key)
      if (draft.focusedKey === key) draft.focusedKey = undefined
      const bucket = draft.tabsBySession[sessionId as string]
      if (bucket === undefined) return
      const tabs = bucket.tabs.filter(tab => tab.key !== key)
      if (tabs.length === 0) delete draft.tabsBySession[sessionId as string]
      else {
        const activeKey = bucket.activeKey === key ? tabs[tabs.length - 1]?.key : bucket.activeKey
        draft.tabsBySession[sessionId as string] = { tabs, activeKey }
      }
    })
  }

  /**
   * Resolve the live view behind a tab key.
   * @param key - tab key.
   * @returns the view, or undefined before creation and after close.
   */
  viewFor(key: string): RegisteredTerminal['view'] | undefined {
    return this.registry.get(key)?.view
  }

  /**
   * Write text into a tab's terminal and ask its screen to take focus.
   * @param key - tab key.
   * @param command - text to insert at the shell prompt.
   * @param run - append Enter so the command executes immediately.
   */
  insertCommand(key: string, command: string, run: boolean): void {
    const entry = this.registry.get(key)
    if (entry === undefined) return
    entry.view.write(run ? `${command}\r` : command)
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent(TERMINAL_PANEL_FOCUS_EVENT, { detail: { key } }))
    }
  }

  /**
   * Enumerate shells available for a new tab picker.
   * @param sessionId - target Session.
   * @param signal - picker lifetime.
   * @returns installed shells and the remembered default.
   */
  listShells(sessionId: SessionId, signal: AbortSignal): Promise<{ shells: readonly TerminalShell[]; selectedShell: string | undefined }> {
    return this.terminals.launchShells(sessionId, signal)
  }

  /**
   * Snapshot the hold inventory so the panel's terminals survive the
   * sidebar's last-writer-wins retainTabs updates.
   * @returns every live tab as a retainTabs entry.
   */
  holdInventory(): { sessionId: SessionId; tabId: string; contentId: string }[] {
    const out: { sessionId: SessionId; tabId: string; contentId: string }[] = []
    for (const [sessionId, bucket] of Object.entries(this.snapshot.getSnapshot().tabsBySession)) {
      for (const tab of bucket.tabs) out.push({ sessionId: sessionId as SessionId, tabId: tab.key, contentId: tab.contentId })
    }
    return out
  }

  private persistTimer: ReturnType<typeof setTimeout> | undefined

  /** Debounced persistence; height drags publish at pointer cadence and coalesce into one write. */
  private persist(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.persistNow()
    }, 200)
  }

  /** Write the chrome state and tab layout immediately; histories persist through the declared panel store. */
  private persistNow(): void {
    if (typeof localStorage === 'undefined') return
    const snapshot = this.snapshot.getSnapshot()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        open: snapshot.open,
        height: snapshot.height,
        historyRailOpen: snapshot.historyRailOpen,
        fontSize: snapshot.fontSize,
        tabsBySession: snapshot.tabsBySession,
        pinnedKeys: snapshot.pinnedKeys,
        focusedKey: snapshot.focusedKey,
      }))
    } catch (_quotaOrMode) { /* persistence is best-effort; the live snapshot stays authoritative */ }
  }
}

/** One tab on the rendered strip plus the Session that owns its terminal. */
export interface DesktopTerminalPanelVisibleTab {
  readonly tab: DesktopTerminalPanelTab
  readonly ownerSessionId: SessionId
  readonly pinned: boolean
}

/**
 * Compute the rendered strip for the on-screen Session: pinned tabs first
 * (foreign ones included, in pin order), then the Session's own tabs.
 * @param snapshot - panel snapshot.
 * @param sessionId - on-screen Session, if any.
 * @returns tabs to render, in strip order.
 */
export function visibleTerminalTabs(
  snapshot: DesktopTerminalPanelSnapshot,
  sessionId: SessionId | undefined,
): DesktopTerminalPanelVisibleTab[] {
  const ownerOf = (key: string): SessionId | undefined => {
    for (const [owner, bucket] of Object.entries(snapshot.tabsBySession)) {
      if (bucket.tabs.some(tab => tab.key === key)) return owner as SessionId
    }
    return undefined
  }
  const pinned: DesktopTerminalPanelVisibleTab[] = []
  for (const key of snapshot.pinnedKeys) {
    const owner = ownerOf(key)
    if (owner === undefined) continue
    const tab = snapshot.tabsBySession[owner as string]?.tabs.find(item => item.key === key)
    if (tab !== undefined) pinned.push({ tab, ownerSessionId: owner, pinned: true })
  }
  const own = sessionId === undefined ? [] : (snapshot.tabsBySession[sessionId as string]?.tabs ?? [])
    .filter(tab => !snapshot.pinnedKeys.includes(tab.key))
    .map(tab => ({ tab, ownerSessionId: sessionId, pinned: false }))
  return [...pinned, ...own]
}

/**
 * Resolve which tab is active on the strip: the panel-level focus when it is
 * still visible (a pinned foreign tab stays active across Sessions), else the
 * Session bucket's own active key, else the first visible tab.
 * @param snapshot - panel snapshot.
 * @param sessionId - on-screen Session, if any.
 * @param visible - tabs from {@link visibleTerminalTabs}.
 * @returns the active tab key, or undefined when nothing is visible.
 */
export function resolveActiveTerminalTab(
  snapshot: DesktopTerminalPanelSnapshot,
  sessionId: SessionId | undefined,
  visible: readonly DesktopTerminalPanelVisibleTab[],
): string | undefined {
  if (snapshot.focusedKey !== undefined && visible.some(item => item.tab.key === snapshot.focusedKey)) {
    return snapshot.focusedKey
  }
  const bucketActive = sessionId === undefined ? undefined : snapshot.tabsBySession[sessionId as string]?.activeKey
  if (bucketActive !== undefined && visible.some(item => item.tab.key === bucketActive)) return bucketActive
  return visible[0]?.tab.key
}
