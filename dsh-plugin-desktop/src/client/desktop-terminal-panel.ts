/** Registration orchestration for the Desktop terminal panel: launcher, drawer, shortcut, and window holds. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DesktopTerminalPanelCoordinator } from './desktop-terminal-panel-coordinator.ts'
import { createDesktopTerminalPanelStore } from './desktop-terminal-panel-store.ts'
import { DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE, desktopTerminalPanelEn, desktopTerminalPanelZh } from './desktop-terminal-panel-locales.ts'
import { installDesktopTerminalPanelStyles } from './desktop-terminal-panel-styles.ts'
import { DesktopTerminalPanel } from './DesktopTerminalPanel.tsx'
import { DesktopTerminalLauncher } from './DesktopTerminalLauncher.tsx'
import type { DesktopTerminalLauncherInjected, DesktopTerminalPanelInjected } from './desktop-terminal-panel-face.ts'

/**
 * Wire the bottom terminal panel into the Desktop shell once its services
 * arrive: a sidebar footer launcher, the Ctrl+J toggle, the shell-overlay
 * drawer, and a retainTabs bridge keeping panel terminals off the Host's
 * idle reclamation list. Scoped because the services live in the composed
 * Web bundle, outside the Desktop plugin's own activation ordering.
 * @param ctx - Desktop client root Context.
 */
export function applyDesktopTerminalPanel(ctx: ClientContext): void {
  ctx.inject(['webTerminals', 'sidebarRight', 'shortcuts'], (scope: ClientContext) => {
    applyDesktopTerminalPanelServices(scope)
  })
}

/** Register every terminal panel surface against resolved services. @param ctx - scope holding webTerminals, sidebarRight, and shortcuts. */
function applyDesktopTerminalPanelServices(ctx: ClientContext): void {
  const coordinator = new DesktopTerminalPanelCoordinator(ctx.webTerminals)
  ctx.effect(() => () => coordinator.dispose(), 'dsh-plugin-desktop: terminal panel coordinator')
  const store = createDesktopTerminalPanelStore()
  const t = ctx.locale.bind(DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE)

  ctx.effect(() => ctx.locale.register(DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE, {
    zh: desktopTerminalPanelZh, en: desktopTerminalPanelEn,
  }), 'dsh-plugin-desktop: terminal panel dictionaries')
  ctx.effect(() => installDesktopTerminalPanelStyles('dsh-plugin-desktop'), 'dsh-plugin-desktop: terminal panel styles')

  ctx.effect(() => ctx.shortcuts.register({
    id: 'desktop.terminalPanel.toggle' as ShortcutCommandId,
    label: () => t('shortcutToggle'),
    aliases: ['terminal panel', 'toggle terminal panel', 'bottom terminal'],
    // Desktop-only default: browsers reserve Ctrl+J, so no web profile binding.
    defaults: {
      'desktop:macos': { code: 'KeyJ', modifiers: ['control'] },
      'desktop:windows': { code: 'KeyJ', modifiers: ['control'] },
      'desktop:linux': { code: 'KeyJ', modifiers: ['control'] },
    },
    regions: ['page', 'editable', 'terminal'],
    modals: [],
    resolve: () => ({ status: 'handled', run: () => coordinator.toggle() }),
  }), 'dsh-plugin-desktop: terminal panel shortcut')

  // The upstream sidebar terminal rewrites retainTabs from sidebar openTabs alone;
  // queuing the union behind a microtask keeps panel terminals held no matter
  // which listener runs first within the same store notification.
  ctx.effect(() => {
    let queued = false
    const sync = (): void => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        const sidebarTabs = ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.kind === 'terminal')
        ctx.webTerminals.retainTabs([...sidebarTabs, ...coordinator.holdInventory()])
      })
    }
    const unsubscribeSidebar = ctx.sidebarRight.openTabs.subscribe(sync)
    const unsubscribePanel = coordinator.snapshot.subscribe(sync)
    sync()
    return () => {
      unsubscribeSidebar()
      unsubscribePanel()
      ctx.webTerminals.retainTabs(ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.kind === 'terminal'))
    }
  }, 'dsh-plugin-desktop: terminal panel window holds')

  const theme: DesktopTerminalPanelInjected['hooks']['theme'] = {
    getSnapshot: (): ThemeSnapshot => ctx.theme.getTheme(),
    subscribe: listener => ctx.on('theme/change', listener),
  }
  const panelInjected: DesktopTerminalPanelInjected = {
    togglePanel: () => coordinator.toggle(),
    closePanel: () => coordinator.close(),
    setPanelHeight: height => coordinator.setHeight(height),
    toggleHistoryRail: () => coordinator.toggleHistoryRail(),
    openTab: (sessionId, shellPath) => coordinator.openTab(sessionId, shellPath),
    closeTab: (sessionId, key) => coordinator.closeTab(sessionId, key),
    focusTab: key => coordinator.focusTab(key),
    togglePin: key => coordinator.togglePin(key),
    setTerminalFontSize: size => coordinator.setFontSize(size),
    ownerOf: key => coordinator.ownerOf(key),
    insertCommand: (key, command, run) => coordinator.insertCommand(key, command, run),
    listShells: (sessionId, signal) => coordinator.listShells(sessionId, signal),
    viewFor: key => coordinator.viewFor(key),
    ensureViews: sessionId => coordinator.ensureViews(sessionId),
    hooks: {
      panel: coordinator.snapshot,
      onScreenSession: ctx.sidebarRight.mounted,
      theme,
    },
    keyedHooks: { terminal: key => coordinator.viewFor(key)?.state },
  }
  const launcherInjected: DesktopTerminalLauncherInjected = {
    togglePanel: () => coordinator.toggle(),
    hooks: { panel: coordinator.snapshot },
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'desktop-terminal-panel',
    order: 40,
    label: () => t('launcher'),
    locale: DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE,
    inject: () => launcherInjected,
  }, DesktopTerminalLauncher))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-terminal-panel',
    order: 40,
    locale: DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE,
    store,
    inject: () => panelInjected,
  }, DesktopTerminalPanel))
}
