/** Independent Desktop frame shared by compatibility and extended modes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import { ExtendedFrame } from './ExtendedFrame.tsx'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import {
  DESKTOP_SETTINGS_LOCALE_NAMESPACE,
  DESKTOP_SHELL_SETTINGS_NAMESPACE,
  type DesktopSettingsClientControl,
} from './desktop-settings.ts'
import type { DesktopShellSettings } from './DesktopSettingsSection.tsx'
import type { DesktopClientEnvironment } from './environment.ts'
import { DesktopFrameTitlebar } from './ExtendedTitlebar.tsx'
import { installExtendedStyles } from './extended-styles.ts'
import { DesktopLayoutState } from './layout-state.ts'
import { provideDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'

/** Own the extended root/sidebar surface without reusing enhanced-mode chrome. */
function applyExtendedOwnedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  const desktopLayout = new DesktopLayoutState()
  ctx.effect(
    () => provideDesktopLayout(ctx, desktopLayout),
    'desktop: extended layout service',
  )

  ctx.effect(
    () => installDesktopOwnedStyles(),
    'desktop: extended owned layout styles',
  )

  ctx.effect(() => {
    const presenter = new DesktopThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop: extended theme presenter')

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, ExtendedFrame), 'desktop: extended root slot')
}

export function applyFramedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'compatibility' && environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: framed shell received mode ${JSON.stringify(environment.mode)}`)
  }
  const api = settingsControl?.api ?? createDesktopSettingsApi()
  const setMode = settingsControl?.setMode ?? (async (mode: DesktopShellSettings['mode']) => {
    const desktopSettings = ctx.settingsScope.bind<DesktopShellSettings>({
      namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
    })
    await desktopSettings.set('mode', mode)
  })

  ctx.effect(() => {
    const contentViewport = document.getElementById('root')
    if (contentViewport === null) {
      throw new Error('dsh-plugin-desktop: framed shell requires the upstream root')
    }
    document.body.dataset.dshDesktopMode = environment.mode
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    contentViewport.dataset.dshDesktopContentViewport = ''
    const removeStyles = installExtendedStyles()
    return () => {
      removeStyles()
      delete contentViewport.dataset.dshDesktopContentViewport
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, `desktop: independent ${environment.mode} frame styles`)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-frame-titlebar',
    order: -1000,
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({ api, environment, setMode }),
  }, DesktopFrameTitlebar))
}

/** Compose the extended-owned layout beneath its independent Desktop frame. */
export function applyExtendedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: extended shell received mode ${JSON.stringify(environment.mode)}`)
  }
  applyExtendedOwnedShell(ctx, environment)
  applyFramedShell(ctx, environment, settingsControl)
}
