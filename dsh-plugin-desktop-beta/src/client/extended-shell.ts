/** Independent Desktop frame shared by compatibility and extended modes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import { ExtendedFrame } from './ExtendedFrame.tsx'
import type { DesktopSettingsClientControl } from './desktop-settings.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { installExtendedStyles } from './extended-styles.ts'
import { DesktopLayoutState } from './layout-state.ts'
import { installDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'

/** Own the extended root/sidebar surface without reusing enhanced-mode chrome. */
function applyExtendedOwnedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  const desktopLayout = new DesktopLayoutState(id => ctx.slots.entries('main').some(entry => entry.options.key === id))
  installDesktopLayout(ctx, desktopLayout)

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
      'main': { kind: 'keyed', scope: 'root' },
      'rightbar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, ExtendedFrame), 'desktop: extended root slot')

}

export function applyFramedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  _settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'compatibility' && environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: framed shell received mode ${JSON.stringify(environment.mode)}`)
  }
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
