/** Inject faces shared by the Desktop terminal panel's slot registrations. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { TerminalShell } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DesktopTerminalPanelSnapshot } from './desktop-terminal-panel-coordinator.ts'

/** Coordinator callbacks and reactive sources for the bottom terminal panel. */
export interface DesktopTerminalPanelInjected {
  readonly togglePanel: () => void
  readonly closePanel: () => void
  /** @param height - desired drawer height in pixels. */
  readonly setPanelHeight: (height: number) => void
  readonly toggleHistoryRail: () => void
  /** @param sessionId - owning Session. @param shellPath - explicit shell; omitted uses the remembered default. */
  readonly openTab: (sessionId: SessionId, shellPath?: string) => void
  /** @param sessionId - owning Session. @param key - tab key to close. */
  readonly closeTab: (sessionId: SessionId, key: string) => void
  /** @param key - tab key to make active; may belong to another Session when pinned. */
  readonly focusTab: (key: string) => void
  /** @param key - tab key to pin across Sessions or release back to its own. */
  readonly togglePin: (key: string) => void
  /** @param size - shared terminal font size in pixels, clamped by the coordinator. */
  readonly setTerminalFontSize: (size: number) => void
  /** @param key - tab key. @returns the Session owning the tab's terminal, if known. */
  readonly ownerOf: (key: string) => SessionId | undefined
  /** @param key - tab key. @param command - text to write. @param run - append Enter. */
  readonly insertCommand: (key: string, command: string, run: boolean) => void
  /** @param sessionId - target Session. @param signal - picker lifetime. @returns installed shells and the remembered default. */
  readonly listShells: (sessionId: SessionId, signal: AbortSignal) => Promise<{ shells: readonly TerminalShell[]; selectedShell: string | undefined }>
  /** @param key - tab key. @returns the live terminal view, when created. */
  readonly viewFor: (key: string) => TerminalView | undefined
  /** @param sessionId - Session whose restored tabs need live views before rendering. */
  readonly ensureViews: (sessionId: SessionId) => void
  readonly hooks: {
    readonly panel: HostObservable<DesktopTerminalPanelSnapshot>
    readonly onScreenSession: HostObservable<SessionId | undefined>
    readonly theme: HostObservable<ThemeSnapshot>
  }
  readonly keyedHooks: {
    readonly terminal: (key: string) => HostObservable<TerminalViewState> | undefined
  }
}

/** Launcher share: reads drawer visibility and toggles it. */
export interface DesktopTerminalLauncherInjected {
  readonly togglePanel: () => void
  readonly hooks: { readonly panel: HostObservable<DesktopTerminalPanelSnapshot> }
}
