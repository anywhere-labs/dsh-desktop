/** Compose Next capabilities into the official frontend. */
import { createElement, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { installDesktopSettingsStyles } from './desktop-settings-styles.ts'
import { installSidebarFooterStyles, setSidebarFooterBalanced, setSidebarFooterCompat } from './sidebar-footer-styles.ts'
import { NextSettingsAdapter } from './settings-adapter.ts'
import { NextDesktopSettings, NextDesktopActions } from './settings.tsx'
import { installWindowStyles } from './styles.ts'
import { registerDesktopOnboarding } from './onboarding.tsx'
import './onboarding.css'
import { registerPluginControls } from './plugin-controls.tsx'
import { installPluginControlsStyles } from './plugin-controls-styles.ts'
import { registerSessionTabs } from './session-tabs-register.ts'
import { installSessionTabsStyles } from './session-tabs-styles.ts'
import { registerComputerUseCommandUi } from './computer-use-command-ui.tsx'
import { installOfficialComputerUseStyles, registerDesktopSettingsIcon } from './upstream-family.ts'
import { desktopDirectoryPicker, registerDesktopDirectoryPicker, shadowsHostDirectoryFlow } from './directory-picker.ts'
import { SettingsRequests } from './settings-requests.tsx'
import type { DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop/src/client/desktop-settings-locales.ts'
import { installRendererRecovery } from './renderer-recovery.ts'
import { installClientDiagnostics } from './client-diagnostics.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop.settings': DesktopSettingsLocaleKey | 'sidebarFooterCompat' | 'sidebarFooterCompatBody' | 'sidebarFooterBalanced' | 'sidebarFooterBalancedBody'
      | 'tabs' | 'tabGeneral' | 'tabProfiles' | 'tabAccess' | 'tabDiagnostics'
    'desktop-next': 'settings' | 'language' | 'safeMode' | 'safeModeDetail' | 'recovery' | 'dismiss'
  }
}

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: Context): void {
  // Only the Desktop main window has the channel; an ordinary browser keeps its console.
  const diagnostic = window.desktopNext?.renderer?.diagnostic
  if (diagnostic) ctx.effect(() => installClientDiagnostics(ctx, diagnostic), 'Client failure reports')
  ctx.effect(() => ctx.locale.register('desktop-next', {
    zh: { settings: '桌面设置', language: 'zh', safeMode: '安全模式', safeModeDetail: '当前使用临时环境。退出安全模式并重启后返回原 Profile，临时数据不会保留。', dismiss: '关闭提示', recovery: '打开恢复助手' },
    en: { settings: 'Desktop settings', language: 'en', safeMode: 'Safe mode', safeModeDetail: 'You are using a temporary environment. Exiting Safe Mode and restarting returns to the original Profile and removes the temporary data.', dismiss: 'Dismiss notice', recovery: 'Open recovery assistant' },
  }), 'Next settings and recovery labels')
  ctx.effect(() => installDesktopSettingsStyles('dsh-desktop-next'), 'Shared Desktop settings styles')
  ctx.effect(installPluginControlsStyles, 'Plugin controls and permission dialog styles')
  ctx.effect(installSessionTabsStyles, 'Session tab strip styles')
  if (installOfficialComputerUseStyles) ctx.effect(installOfficialComputerUseStyles, 'Official Computer Use row styles')
  registerPluginControls(ctx)
  registerSessionTabs(ctx)
  registerComputerUseCommandUi(ctx)
  // On macOS and Windows the Desktop window adds workspaces through the system folder dialog
  // like upstream Desktop, whatever directory flow the Host mounted. Linux keeps the Host's
  // flow, and ordinary browsers have no bridge.
  const directoryPicker = desktopDirectoryPicker()
  if (directoryPicker && shadowsHostDirectoryFlow(document.documentElement.dataset.platform)) {
    registerDesktopDirectoryPicker(ctx, directoryPicker)
  }
  registerDesktopOnboarding(ctx)
  if (window.desktopNext?.state) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-renderer-health', order: 0,
      inject: () => ({ ctx }),
    }, RendererHealth))
    const permissions = window.desktopNext.permissions
    if (permissions) ctx.effect(() => {
      const dispose = ctx.reflect.provide('desktopPermissions', permissions)
      return () => { void dispose() }
    }, 'Native Desktop permissions')
    ctx.effect(installSidebarFooterStyles, 'Shared Desktop sidebar footer layout')
    const adapter = new NextSettingsAdapter(window.desktopNext)
    ctx.effect(() => {
      const syncSidebarFooterCompat = (): void => {
        const value = adapter.desktopSettings.getSnapshot().value
        setSidebarFooterCompat(value?.sidebarFooterCompat !== false)
        setSidebarFooterBalanced(value?.sidebarFooterBalanced !== false)
      }
      syncSidebarFooterCompat()
      return adapter.desktopSettings.subscribe(syncSidebarFooterCompat)
    }, 'Sync Desktop sidebar footer compatibility setting')
    const t = ctx.locale.bind('desktop-next')
    // The settings shell shows our display icon for this section ID: through its icon slot where the release
    // offers one, otherwise through the shell's Yarn patch, which maps the ID itself.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'desktop', order: 100, locale: 'desktop-next', label: () => t('settings'),
      inject: () => ({ adapter, openPlugins: () => ctx.layout.selectPanel('plugins' as MainPanelId) }),
    }, DesktopSettings))
    registerDesktopSettingsIcon?.(ctx, 'desktop')
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action', id: 'desktop-native-actions', order: 1, locale: 'desktop-next', inject: () => ({ adapter }),
    }, SettingsActions))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-settings-requests', order: 90, locale: 'desktop-next',
    }, SettingsRequests))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-next-safe-mode', order: 100, locale: 'desktop-next',
    }, SafeModeNotice))
  }
  ctx.effect(installWindowStyles, 'Next native materials and recovery notice')
}

/** The effect runs only after React mounts the assembled shell. */
function RendererHealth({ ctx }: { ctx: Context }) {
  useEffect(() => {
    const bridge = window.desktopNext?.renderer
    if (bridge) return installRendererRecovery(ctx, bridge)
  }, [ctx])
  return null
}

function SafeModeNotice({ t }: PropsLocale<'desktop-next'>) {
  const [safe, setSafe] = useState(false)
  useEffect(() => {
    let disposed = false
    void window.desktopNext?.state().then(state => { if (!disposed) setSafe(state.safeMode) }).catch(() => {})
    return () => { disposed = true }
  }, [])
  return safe ? createElement('aside', { className: 'dshNextSafeModeNotice', 'aria-label': t('safeMode') },
    createElement('button', { type: 'button', className: 'dshNextSafeModeDismiss', 'aria-label': t('dismiss'), onClick: () => setSafe(false) }, '×'),
    createElement('strong', null, t('safeMode')), createElement('p', null, t('safeModeDetail')),
    createElement('button', { type: 'button', onClick: () => { void window.desktopNext?.command({ type: 'controls', page: 'recovery' }).catch(() => {}) } }, t('recovery')),
  ) : null
}

function DesktopSettings({ t, adapter, close, openPlugins }: PropsLocale<'desktop-next'> & PropsRuntime<'settings.section'> & { adapter: NextSettingsAdapter; openPlugins(): void }) {
  return createElement(NextDesktopSettings, { adapter, language: t('language'), onOpenPlugins: () => { openPlugins(); close() } })
}

function SettingsActions({ t, adapter }: PropsLocale<'desktop-next'> & { adapter: NextSettingsAdapter }) {
  return createElement(NextDesktopActions, { adapter, language: t('language') })
}
