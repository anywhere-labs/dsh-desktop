/**
 * Desktop find feature: the client-side wiring for Ctrl/Cmd+F.
 *
 * Installed for every Desktop mode — compatibility included — because Electron
 * ships no find UI of its own, so the keystroke is otherwise dead. The feature
 * only exists behind the Desktop renderer marker: an ordinary browser URL keeps
 * its own native find, and compatibility mode therefore still runs the upstream
 * client unmodified.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopFindBar } from './DesktopFindBar.tsx'
import type { DesktopClientEnvironment } from './environment.ts'
import { DesktopFindController } from './find-controller.ts'
import { en, zh } from './find-locales.ts'
import { installDesktopFindStyles } from './find-styles.ts'
import { createDocumentFindViewport } from './find-viewport.ts'

/** Locale namespace owned by the Desktop find bar. */
export const DESKTOP_FIND_LOCALE_NAMESPACE = 'desktop.find'

/** Slot id of the find-bar entry inside the frame-wide overlay seat. */
export const DESKTOP_FIND_SLOT_ID = 'desktop-find'

/**
 * Register the find bar, its shortcuts, copy, and styles.
 * @param ctx - browser Cordis context.
 * @param environment - validated Desktop renderer environment.
 */
export function applyDesktopFind(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  const controller = new DesktopFindController({ viewport: createDocumentFindViewport() })

  ctx.effect(
    () => ctx.locale.register(DESKTOP_FIND_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: find-bar dictionaries',
  )
  ctx.effect(
    () => installDesktopFindStyles(),
    'dsh-plugin-desktop: find-bar styles',
  )
  ctx.effect(() => {
    // Capture phase: the shortcut is a window-level gesture, and no editor or
    // composer on the page should be able to swallow it first.
    const onKeyDown = (event: KeyboardEvent): void => { controller.handleKeydown(event) }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, 'dsh-plugin-desktop: find-bar shortcuts')
  ctx.effect(
    () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: DESKTOP_FIND_SLOT_ID,
      order: 100,
      locale: DESKTOP_FIND_LOCALE_NAMESPACE,
      inject: () => ({ controller, environment }),
    }, DesktopFindBar)),
    'dsh-plugin-desktop: find-bar overlay seat',
  )
  ctx.effect(
    () => () => { controller.dispose() },
    'dsh-plugin-desktop: find-bar lifecycle',
  )
}
