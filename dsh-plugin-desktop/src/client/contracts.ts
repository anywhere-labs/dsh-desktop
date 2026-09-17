import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Sidebar geometry passed by the desktop root slot. */
export interface DesktopSidebarOwnerProps {
  /** Whether the sidebar is showing its compact rail. */
  collapsed: boolean
  /** Current rendered sidebar width. */
  width: number
}

/** Public panel transitions consumed by conversation and sidebar plugins. */
export type DesktopLayoutService = import('@deepseek-ai/dsh-client-ui-layout/client').ILayout

/** Insets reserved by Desktop-owned native chrome in CSS pixels. */
export interface DesktopWindowInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** Native caption hit-region geometry in CSS pixels. */
export interface DesktopWindowDragRegion {
  /** Height of the continuous top drag band. */
  readonly height: number
  /** Non-draggable native controls reserved on the left. */
  readonly leftInset: number
  /** Non-draggable native controls reserved on the right. */
  readonly rightInset: number
}

/** Generation-stable native window geometry exposed to Desktop client plugins. */
export interface DesktopWindowService {
  /** Installed Desktop product version for this renderer generation. */
  readonly version: string
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  readonly platform: 'darwin' | 'win32' | 'linux'
  /** Capability-gated native material active behind this renderer. */
  readonly material: 'off' | 'transparent' | 'mica'
  /** Windows Mica capability after the operating-system build gate. */
  readonly micaSupported: boolean
  /** Materials available on the active platform and operating-system build. */
  readonly availableMaterials: readonly ('off' | 'transparent' | 'mica')[]
  /** Content insets owned by the active Desktop presentation. */
  readonly safeAreaInsets: DesktopWindowInsets
  /** Top caption geometry; interactive children must opt out of app dragging. */
  readonly dragRegion: DesktopWindowDragRegion
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native window geometry for the current Desktop renderer generation. */
    desktopWindow: DesktopWindowService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The Desktop browser panel's own layer over the right track.
     *
     * It is not the `rightbar` seat: the shipped right Sidebar keeps that one, so
     * it stays mounted and its session surface keeps answering the commands that
     * need it. The Desktop frame draws this layer above the same track instead.
     */
    'desktop.browser.column': { kind: 'single'; scope: 'root'; owner: DesktopBrowserColumnOwnerProps }
  }
}

/** Column state the frame reports to the panel layer it draws. */
export interface DesktopBrowserColumnOwnerProps {
  /**
   * Whether the shipped right Sidebar raised its panel while the browser held
   * the column; the panel steps aside for the content that just arrived.
   */
  readonly sidebarTakeover: boolean
}
