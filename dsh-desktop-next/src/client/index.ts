/** Compose Next capabilities into the official frontend. */
import { createElement, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { installDesktopSettingsStyles } from '../../../dsh-plugin-desktop-beta/src/client/desktop-settings-styles.ts'
import { installSidebarFooterStyles } from '../../../dsh-plugin-desktop-beta/src/client/sidebar-footer-styles.ts'
import { NextSettingsAdapter } from './settings-adapter.ts'
import { NextDesktopSettings, NextDesktopActions } from './settings.tsx'
import { installWindowStyles } from './styles.ts'
import { registerPluginControls } from './plugin-controls.tsx'
import { installPluginControlsStyles } from './plugin-controls-styles.ts'
import { SettingsRequests } from './settings-requests.tsx'
import type { DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop-beta/src/client/desktop-settings-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop.settings': DesktopSettingsLocaleKey
    'desktop-next': 'settings' | 'language' | 'safeMode' | 'safeModeDetail' | 'recovery' | 'dismiss'
  }
}

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('desktop-next', {
    zh: { settings: '桌面设置', language: 'zh', safeMode: '安全模式', safeModeDetail: '当前使用临时环境。退出安全模式并重启后返回原 Profile，临时数据不会保留。', dismiss: '关闭提示', recovery: '打开恢复助手' },
    en: { settings: 'Desktop settings', language: 'en', safeMode: 'Safe mode', safeModeDetail: 'You are using a temporary environment. Exiting Safe Mode and restarting returns to the original Profile and removes the temporary data.', dismiss: 'Dismiss notice', recovery: 'Open recovery assistant' },
  }), 'Next settings and recovery labels')
  ctx.effect(installDesktopSettingsStyles, 'Shared Desktop settings styles')
  ctx.effect(installPluginControlsStyles, 'Plugin controls and permission dialog styles')
  registerPluginControls(ctx)
  if (window.desktopNext) {
    const permissions = window.desktopNext.permissions
    if (permissions) ctx.effect(() => {
      const dispose = ctx.reflect.provide('desktopPermissions', permissions)
      return () => { void dispose() }
    }, 'Native Desktop permissions')
    ctx.effect(installSidebarFooterStyles, 'Shared Desktop sidebar footer layout')
    const adapter = new NextSettingsAdapter(window.desktopNext)
    const t = ctx.locale.bind('desktop-next')
    // The shared settings shell maps the legacy section ID to our display icon.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'desktop', order: 100, locale: 'desktop-next', label: () => t('settings'),
      inject: () => ({ adapter, openPlugins: () => ctx.layout.selectPanel('plugins' as MainPanelId) }),
    }, DesktopSettings))
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
  ctx.effect(installWindowStyles, 'Next native materials and header interactions')
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
