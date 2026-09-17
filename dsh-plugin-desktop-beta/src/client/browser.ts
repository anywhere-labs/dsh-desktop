/** Desktop-owned client surfaces for the native browser: header toggle and right column. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { DesktopBrowserPanel, DesktopBrowserToggle } from './BrowserPanel.tsx'
import { DesktopBrowserPanelController } from './browser-panel.ts'
import { en, zh, type DesktopBrowserLocaleKey } from './browser-locales.ts'
import { installDesktopBrowserStyles } from './browser-styles.ts'

/** Locale namespace owned by the Desktop browser surfaces. */
export const DESKTOP_BROWSER_LOCALE_NAMESPACE = 'desktop.browser'

/** Order of the header toggle among the Conversation's right-aligned utilities. */
const TOGGLE_ORDER = 60

/** Right-column controls the Desktop frame exposes on top of the shared layout service. */
interface DesktopRightbarControl {
  /** Report the panel as open; `track` reserves a real column beside the centre. */
  openRightbar?(track: boolean, fullscreen: boolean): void
  /** Release the column, restoring the official right sidebar. */
  closeRightbar?(): void
  /** Give the column an explicit width; the frame clamps it to its own limits. */
  setRightbar?(width: number, viewport: number): void
  /** Claim the column for the browser panel, above the shipped Sidebar's own report. */
  showBrowserColumn?(track: boolean, fullscreen: boolean): void
  /** Drop that claim, leaving the column to the shipped Sidebar's report. */
  hideBrowserColumn?(): void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop browser panel copy. */
    'desktop.browser': DesktopBrowserLocaleKey
  }
}

/** Register the header toggle and the browser's right column for desktop-owned presentations. */
export function applyDesktopBrowser(ctx: ClientContext): void {
  const controllers = new Map<string, DesktopBrowserPanelController>()
  /** Sessions whose panel is open; the column layer exists while this is not empty. */
  const shown = new Set<string>()
  // The right column is one root-scoped surface, so the browser registers a
  // single layer for the whole app and lets it render whichever Session is
  // current. One layer per Session would collide at the same priority as soon
  // as a second Session opened the panel.
  let layer: (() => void) | undefined
  const t = ctx.locale.bind(DESKTOP_BROWSER_LOCALE_NAMESPACE)

  /** The frame's own layout service, which owns the right column's geometry. */
  const layout = (): DesktopRightbarControl | undefined => ctx.get('layout') as DesktopRightbarControl | undefined

  /**
   * Drop the browser's claim on the column.
   *
   * What happens next belongs to the shipped right Sidebar: it reports its own
   * panel through `openRightbar`, so a Sidebar that is showing keeps its track
   * and a column nobody claims closes.
   */
  const handBackColumn = (): void => { layout()?.hideBrowserColumn?.() }

  /** The per-Session controller factory shared by the toggle and the column. */
  const controller = (sessionId: string): DesktopBrowserPanelController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing
    const created = new DesktopBrowserPanelController(sessionId, {
      onVisibility: open => {
        if (open) shown.add(sessionId)
        else shown.delete(sessionId)
        syncLayer()
      },
      onIdle: handBackColumn,
      onEnsure: ensureColumn,
      onFullscreen: fullscreen => { layout()?.showBrowserColumn?.(true, fullscreen) },
    })
    controllers.set(sessionId, created)
    return created
  }

  /** Reserve the column; the frame sizes the track from this report.
   *
   * The panel's own fullscreen intent rides along, because a track re-asserted
   * without it would quietly hand the conversation its width back mid-session.
   */
  const ensureColumn = (fullscreen: boolean): void => { layout()?.showBrowserColumn?.(true, fullscreen) }

  /** Register the panel's layer while any Session shows a panel, and drop it otherwise. */
  const syncLayer = (): void => {
    if (shown.size === 0) release()
    else acquire()
  }

  const release = (): void => {
    const dispose = layer
    if (dispose === undefined) return
    layer = undefined
    dispose()
    handBackColumn()
  }

  const acquire = (): void => {
    // The shipped right Sidebar owns the `rightbar` seat for good: the panel
    // draws its own layer over the same track, so the Sidebar stays mounted and
    // the commands that need its session surface keep working while it is
    // covered.
    layer ??= ctx.slots.inject('desktop.browser.column', () => ctx.slots.register({
      name: 'desktop.browser.column',
      locale: DESKTOP_BROWSER_LOCALE_NAMESPACE,
      inject: () => ({ controller }),
    }, DesktopBrowserPanel))
    // A first acquisition always starts as a shared column, never fullscreen.
    ensureColumn(false)
  }

  ctx.effect(
    () => ctx.locale.register(DESKTOP_BROWSER_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: browser dictionaries',
  )
  ctx.effect(
    () => installDesktopBrowserStyles(),
    'dsh-plugin-desktop: browser panel styles',
  )
  ctx.effect(
    () => () => {
      layer?.()
      layer = undefined
      shown.clear()
      for (const panel of controllers.values()) panel.dispose()
      controllers.clear()
      layout()?.hideBrowserColumn?.()
    },
    'dsh-plugin-desktop: browser panels',
  )
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-browser',
    order: TOGGLE_ORDER,
    locale: DESKTOP_BROWSER_LOCALE_NAMESPACE,
    label: () => t('toggle'),
    inject: () => ({ controller }),
  }, DesktopBrowserToggle))
}
