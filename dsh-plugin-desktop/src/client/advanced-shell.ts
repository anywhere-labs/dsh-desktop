import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { AdvancedFrame } from './AdvancedFrame.tsx'
import { DesktopLayoutState } from './layout-state.ts'
import { provideDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'

/** Own the enhanced layout and root slot without installing an independent frame. */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  if (environment.mode !== 'advanced') {
    throw new Error(`dsh-plugin-desktop: advanced shell received mode ${JSON.stringify(environment.mode)}`)
  }

  const desktopLayout = new DesktopLayoutState()
  ctx.effect(
    () => provideDesktopLayout(ctx, desktopLayout),
    'desktop: layout service',
  )

  ctx.effect(() => {
    document.body.dataset.dshDesktopMode = 'advanced'
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    const removeStyles = installDesktopOwnedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => {
    const presenter = new DesktopThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop: theme presenter')

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, AdvancedFrame), 'desktop: advanced root slot')
}
