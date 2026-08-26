import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DesktopDeveloperMenuItems,
  DesktopNativeActions,
  DesktopRestartMenuItems,
} from '../src/client/DesktopNativeActions.tsx'
import {
  DesktopModeControl,
  DesktopVersionControl,
  selectDesktopFrameMode,
} from '../src/client/ExtendedTitlebar.tsx'
import {
  desktopBrowserUrlsShouldRender,
  DesktopSettingsSection,
  resolveDesktopLanConfirmation,
} from '../src/client/DesktopSettingsSection.tsx'
import { DesktopTerminalSettingsAction } from '../src/client/DesktopTerminalSettingsAction.tsx'
import {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
  type DesktopSettingsView,
} from '../src/client/desktop-settings-api.ts'
import {
  applyDesktopSettings,
  DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  DESKTOP_SETTINGS_LOCALE_NAMESPACE,
  DESKTOP_SHELL_SETTINGS_NAMESPACE,
  persistDesktopModeSelection,
} from '../src/client/desktop-settings.ts'
import { en, zh, type DesktopSettingsLocaleKey } from '../src/client/desktop-settings-locales.ts'
import { installDesktopSettingsStyles } from '../src/client/desktop-settings-styles.ts'

const VIEW: DesktopSettingsView = {
  current: 'desktop',
  profiles: [
    { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
    { name: 'headless', exists: true, webCapable: false, selectable: false, deletable: false },
    { name: 'work', exists: true, webCapable: true, selectable: true, deletable: true },
  ],
  market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: true },
  web: { localUrl: 'http://127.0.0.1:43120/', lanUrls: [] },
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Desktop settings API', () => {
  it('validates the bounded launcher projection', () => {
    expect(parseDesktopSettingsView(VIEW)).toEqual(VIEW)
    expect(() => parseDesktopSettingsView({ ...VIEW, profiles: [...VIEW.profiles, VIEW.profiles[0]] }))
      .toThrow('duplicate profile')
    expect(() => parseDesktopSettingsView({ ...VIEW, market: { ...VIEW.market, requested: 'unknown' } }))
      .toThrow('invalid Desktop settings response')
    expect(() => parseDesktopSettingsView({ ...VIEW, web: { ...VIEW.web, localUrl: 'https://example.com/' } }))
      .toThrow('invalid browser URL')
    expect(parseDesktopRestartAcceptance({ accepted: true, restartRequired: true }))
      .toEqual({ accepted: true, restartRequired: true })
    expect(parseDesktopRestartAcceptance({ accepted: true, restartRequired: false }))
      .toEqual({ accepted: true, restartRequired: false })
    expect(() => parseDesktopRestartAcceptance({ accepted: true })).toThrow('invalid Desktop restart response')
    expect(parseDesktopActionAcceptance({ accepted: true })).toBeUndefined()
    expect(() => parseDesktopActionAcceptance({ accepted: true, detail: 'extra' }))
      .toThrow('invalid Desktop action response')
  })

  it('names the section Desktop settings and describes browser opening as permission', () => {
    expect(zh.nav).toBe('桌面设置')
    expect(en.nav).toBe('Desktop settings')
    expect(Object.values(zh)).not.toContain('将在启动时创建')
    expect(Object.values(en)).not.toContain('Created when first started')
    expect(zh.openBrowser).toBe('允许在浏览器中打开')
    expect(zh.openBrowser).not.toMatch(/启动后|自动/u)
    expect(zh.webIntro).not.toMatch(/启动后|自动/u)
    expect(zh.browserCompatibilityNotice).toContain('兼容模式')
    expect(zh.browserCompatibilityNotice).toContain('仅在')
    expect(zh.browserCompatibilityNotice).toContain('先选择')
    expect(zh.browserCompatibilityNotice).not.toContain('切换到兼容模式')
    expect(en.openBrowser).toMatch(/allow.+(?:open|opening).+browser/iu)
    expect(en.openBrowser).not.toMatch(/after startup|automatically/iu)
    expect(en.webIntro).not.toMatch(/after startup|automatically/iu)
    expect(en.browserCompatibilityNotice).toMatch(/only.+compatibility mode/iu)
    expect(en.browserCompatibilityNotice).toMatch(/select compatibility mode first/iu)
    expect(en.browserCompatibilityNotice).not.toMatch(/switch(?:es|ing)?.+profile/iu)
    expect(zh.beta).toBe('Beta')
    expect(en.beta).toBe('Beta')
    expect(zh.lanWarningBody).toContain('所有在你局域网内的人都能直接操作你的电脑')
    expect(zh.lanWarningBody).toContain('浏览器安全限制')
    expect(zh.lanWarningBody).toContain('HTTP')
    expect(zh.lanWarningBody).toContain('安全模块可能不可用')
    expect(zh.lanWarningBody).toContain('无法正常使用')
    expect(en.lanWarningBody).toContain('Anyone on your local network can directly operate your computer')
    expect(en.lanWarningBody).toContain('Browser security restrictions')
    expect(en.lanWarningBody).toContain('HTTP')
    expect(en.lanWarningBody).toContain('security modules')
    expect(en.lanWarningBody).toContain('not to work correctly')
  })

  it('shows actual URLs only when browser access is permitted and requires explicit LAN confirmation', () => {
    expect(desktopBrowserUrlsShouldRender(false, 'loopback')).toBe(false)
    expect(desktopBrowserUrlsShouldRender(true, 'loopback')).toBe(true)
    expect(desktopBrowserUrlsShouldRender(true, 'lan')).toBe(true)
    expect(desktopBrowserUrlsShouldRender(false, 'lan')).toBe(false)

    const dismiss = vi.fn()
    const enableLan = vi.fn()
    resolveDesktopLanConfirmation(false, dismiss, enableLan)
    expect(dismiss).toHaveBeenCalledOnce()
    expect(enableLan).not.toHaveBeenCalled()

    dismiss.mockClear()
    resolveDesktopLanConfirmation(true, dismiss, enableLan)
    expect(dismiss).toHaveBeenCalledOnce()
    expect(enableLan).toHaveBeenCalledOnce()
  })

  it('withdraws browser and LAN access before selecting a custom Desktop mode', async () => {
    const set = vi.fn(async () => {})
    const scope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: {
          mode: 'compatibility' as const,
          macosMaterial: 'transparent' as const,
          windowsMaterial: 'acrylic' as const,
          port: 43_120,
          openBrowser: true,
          networkExposure: 'lan' as const,
          logLevel: 'info' as const,
        },
        base: undefined,
        user: undefined,
        revision: 1,
        writable: true,
        mode: 'host' as const,
      }),
      set,
    }

    await persistDesktopModeSelection(scope, 'advanced')
    expect(set.mock.calls).toEqual([
      ['networkExposure', 'loopback'],
      ['openBrowser', false],
      ['mode', 'advanced'],
    ])
  })

  it('withdraws browser and LAN access while the settings mirror is still loading', async () => {
    const set = vi.fn(async () => {})
    const scope = {
      getSnapshot: () => ({
        status: 'loading' as const,
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host' as const,
      }),
      set,
    }

    await persistDesktopModeSelection(scope, 'extended')

    expect(set.mock.calls).toEqual([
      ['networkExposure', 'loopback'],
      ['openBrowser', false],
      ['mode', 'extended'],
    ])
  })

  it('uses the strict same-origin routes and request bodies', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input)
      if (path === desktopSettingsPaths.terminalOpen
        || path === desktopSettingsPaths.restart
        || path === desktopSettingsPaths.recoveryRestart
        || path === desktopSettingsPaths.rendererReload
        || path === desktopSettingsPaths.developerToolsToggle
        || path === desktopSettingsPaths.updateCheck
        || path === desktopSettingsPaths.diagnosticsExport) {
        return json({ accepted: true })
      }
      return path === desktopSettingsPaths.settings || path === desktopSettingsPaths.profileCreate || path === desktopSettingsPaths.profileDelete
        ? json(VIEW)
        : json({ accepted: true, restartRequired: true })
    })
    const api = createDesktopSettingsApi(fetcher)

    await expect(api.read()).resolves.toEqual(VIEW)
    await expect(api.createProfile('work')).resolves.toEqual(VIEW)
    await expect(api.selectProfile('work')).resolves.toEqual({ accepted: true, restartRequired: true })
    await expect(api.deleteProfile('work')).resolves.toEqual(VIEW)
    await expect(api.selectMarket('community-market')).resolves.toEqual({ accepted: true, restartRequired: true })
    await expect(api.openTerminal()).resolves.toBeUndefined()
    await expect(api.restart()).resolves.toBeUndefined()
    await expect(api.restartToRecovery()).resolves.toBeUndefined()
    await expect(api.reloadRenderer()).resolves.toBeUndefined()
    await expect(api.toggleDeveloperTools()).resolves.toBeUndefined()
    await expect(api.checkForUpdates()).resolves.toBeUndefined()
    await expect(api.exportDiagnostics()).resolves.toBeUndefined()

    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      desktopSettingsPaths.settings,
      desktopSettingsPaths.profileCreate,
      desktopSettingsPaths.profileSelect,
      desktopSettingsPaths.profileDelete,
      desktopSettingsPaths.marketSelect,
      desktopSettingsPaths.terminalOpen,
      desktopSettingsPaths.restart,
      desktopSettingsPaths.recoveryRestart,
      desktopSettingsPaths.rendererReload,
      desktopSettingsPaths.developerToolsToggle,
      desktopSettingsPaths.updateCheck,
      desktopSettingsPaths.diagnosticsExport,
    ])
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      body: JSON.stringify({ name: 'work' }),
    })
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ name: 'work' }),
    })
    expect(fetcher.mock.calls[4]?.[1]).toMatchObject({
      body: JSON.stringify({ provider: 'community-market' }),
    })
    expect(fetcher.mock.calls[5]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[6]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[7]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[8]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[9]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[10]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
  })

  it('does not reflect an untrusted error body into its public error', async () => {
    const api = createDesktopSettingsApi(async () => json({ error: '/Users/private/profile failed' }, 400))
    await expect(api.read()).rejects.toThrow('Desktop settings request failed (400)')
    await expect(api.read()).rejects.not.toThrow('/Users/private')
  })
})

describe('Desktop native action presentation', () => {
  const api = {
    exportDiagnostics: vi.fn(async () => {}),
    openTerminal: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    restartToRecovery: vi.fn(async () => {}),
    reloadRenderer: vi.fn(async () => {}),
    toggleDeveloperTools: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => {}),
  }
  const t = (key: DesktopSettingsLocaleKey): string => en[key]

  it('uses accessible icon actions in the extended title bar', () => {
    const markup = renderToStaticMarkup(createElement(DesktopNativeActions, {
      api,
      t,
      placement: 'titlebar',
    }))

    expect(markup.match(/dshDesktopTitlebarIconButton/g)).toHaveLength(3)
    expect(markup).toContain('aria-label="Open DSH Terminal"')
    expect(markup).toContain('aria-label="Restart options"')
    expect(markup).toContain('aria-label="Developer options"')
  })

  it('renders the Host-supplied version through the shadcn hover-card trigger', () => {
    const markup = renderToStaticMarkup(createElement(DesktopVersionControl, {
      version: '2.0.3',
      checkForUpdates: api.checkForUpdates,
      t,
    }))

    expect(markup).toContain('v2.0.3')
    expect(markup).toContain('aria-label="Current version v2.0.3"')
    expect(markup).toContain('data-slot="hover-card-trigger"')
  })

  it('renders the active presentation pill through a shadcn hover-card trigger', () => {
    const markup = renderToStaticMarkup(createElement(DesktopModeControl, {
      mode: 'extended',
      setMode: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      t,
    }))

    expect(markup).toContain('Extended window')
    expect(markup).toContain('aria-label="Desktop appearance and behavior: Extended window"')
    expect(markup).toContain('data-slot="hover-card-trigger"')
  })

  it('persists a presentation change before requesting the confirmed restart', async () => {
    const order: string[] = []
    const setMode = vi.fn(async (mode: string) => { order.push(`mode:${mode}`) })
    const restart = vi.fn(async () => { order.push('restart') })

    await selectDesktopFrameMode('advanced', setMode, restart)

    expect(order).toEqual(['mode:advanced', 'restart'])
  })

  it('keeps explicit text labels in settings', () => {
    const markup = renderToStaticMarkup(createElement(DesktopNativeActions, {
      api,
      t,
      placement: 'settings',
    }))

    expect(markup).toContain('Open DSH Terminal')
    expect(markup).toContain('Export Diagnostics')
    expect(markup).toContain('Restart')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).not.toContain('Developer options')
  })

  it('groups reload with both restart actions and leaves only Developer Tools in its menu', () => {
    const restartMarkup = renderToStaticMarkup(createElement(DesktopRestartMenuItems, {
      busy: false,
      t,
      onReload: vi.fn(),
      onRestart: vi.fn(),
      onRestartToRecovery: vi.fn(),
    }))
    const developerMarkup = renderToStaticMarkup(createElement(DesktopDeveloperMenuItems, {
      busy: false,
      t,
      onToggleDeveloperTools: vi.fn(),
    }))

    expect(restartMarkup.match(/role="menuitem"/g)).toHaveLength(3)
    expect(restartMarkup.indexOf('Reload')).toBeLessThan(restartMarkup.indexOf('Restart'))
    expect(restartMarkup.indexOf('Restart')).toBeLessThan(restartMarkup.indexOf('Restart in Recovery Mode'))
    expect(restartMarkup).not.toContain('Toggle Developer Tools')
    expect(developerMarkup.match(/role="menuitem"/g)).toHaveLength(1)
    expect(developerMarkup).toContain('Toggle Developer Tools')
    expect(developerMarkup).not.toContain('Reload')
  })

  it('installs a self-contained vertical settings menu in every presentation mode', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      id: '',
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installDesktopSettingsStyles()
      expect(css).toMatch(/data-placement="settings"\] \.dshDesktopActionMenu \{[^}]*position: absolute;[^}]*display: grid;[^}]*grid-auto-flow: row;[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 220px;/)
      expect(css).toMatch(/data-placement="settings"\] \.dshDesktopActionMenuItem \{[^}]*display: flex;[^}]*width: 100%;[^}]*white-space: nowrap;/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Desktop settings Slot registration', () => {
  it('registers the official Desktop section, native actions, and both settings scopes', async () => {
    const scope = {
      getSnapshot: () => ({
        status: 'loading' as const,
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host' as const,
      }),
      subscribe: () => () => {},
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    } satisfies SettingsScope<unknown>
    const bind = vi.fn(() => scope)
    const register = vi.fn(() => () => {})
    const inject = vi.fn((_name: string, mount: () => unknown) => mount())
    const localeRegister = vi.fn(() => () => {})
    const ctx = {
      settingsScope: { bind },
      locale: {
        bind: (namespace: string) => (key: string) => `${namespace}:${key}`,
        register: localeRegister,
      },
      effect: vi.fn(),
      slots: { inject, register },
    } as unknown as ClientContext

    const control = applyDesktopSettings(ctx, {
      version: '2.0.3',
      mode: 'compatibility',
      platform: 'darwin',
      material: 'off',
      micaSupported: false,
    })

    expect(bind).toHaveBeenNthCalledWith(1, { namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE })
    expect(bind).toHaveBeenNthCalledWith(2, { namespace: DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE })
    expect(inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(inject).toHaveBeenCalledWith('settings.action', expect.any(Function))
    const [options, component] = register.mock.calls[0] as unknown as [
      { id: string; order: number; locale: string; label: () => string; inject: () => Record<string, unknown> },
      unknown,
    ]
    expect(options).toMatchObject({
      name: 'settings.section',
      id: 'desktop',
      order: 100,
      locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    })
    expect(options.label()).toBe(`${DESKTOP_SETTINGS_LOCALE_NAMESPACE}:nav`)
    expect(options.inject()).toMatchObject({
      platform: 'darwin',
      initialMode: 'compatibility',
      micaSupported: false,
      setMode: expect.any(Function),
    })
    expect(component).toBe(DesktopSettingsSection)

    const [actionOptions, actionComponent] = register.mock.calls[1] as unknown as [
      { id: string; order: number; locale: string; inject: () => Record<string, unknown> },
      unknown,
    ]
    expect(actionOptions).toMatchObject({
      name: 'settings.action',
      id: 'open-desktop-terminal',
      order: 1,
      locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    })
    expect(actionOptions.inject()).toHaveProperty('api')
    expect(actionComponent).toBe(DesktopTerminalSettingsAction)
    await control.setMode('extended')
    expect(scope.set).toHaveBeenCalledWith('mode', 'extended')
  })
})
