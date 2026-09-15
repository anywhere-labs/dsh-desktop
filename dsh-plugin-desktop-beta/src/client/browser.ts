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
  const occupants = new Map<string, () => void>()
  const t = ctx.locale.bind(DESKTOP_BROWSER_LOCALE_NAMESPACE)

  /** The frame's own layout service, which owns the right column's geometry. */
  const layout = (): DesktopRightbarControl | undefined => ctx.get('layout') as DesktopRightbarControl | undefined

  /** The per-Session controller factory shared by the toggle and the column. */
  const controller = (sessionId: string): DesktopBrowserPanelController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing
    const created = new DesktopBrowserPanelController(sessionId, {
      onVisibility: open => { if (open) acquire(sessionId); else release(sessionId) },
      onEnsure: ensureColumn,
    })
    controllers.set(sessionId, created)
    return created
  }

  /** Reserve the column; the frame sizes the track from this report. */
  const ensureColumn = (): void => { layout()?.openRightbar?.(true, false) }

  const release = (sessionId: string): void => {
    const dispose = occupants.get(sessionId)
    if (dispose === undefined) return
    occupants.delete(sessionId)
    dispose()
    layout()?.closeRightbar?.()
  }

  const acquire = (sessionId: string): void => {
    if (occupants.has(sessionId)) throw new Error('the browser column is already open')
    // The shipped right Sidebar owns `rightbar` at the default priority; the
    // browser shadows it while open and hands the column back on close.
    const occupant = ctx.slots.inject('rightbar', () => ctx.slots.register({
      name: 'rightbar',
      priority: -1,
      locale: DESKTOP_BROWSER_LOCALE_NAMESPACE,
      inject: () => ({ controller }),
    }, DesktopBrowserPanel))
    occupants.set(sessionId, occupant)
    ensureColumn()
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
      for (const dispose of occupants.values()) dispose()
      occupants.clear()
      for (const panel of controllers.values()) panel.dispose()
      controllers.clear()
      layout()?.closeRightbar?.()
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
