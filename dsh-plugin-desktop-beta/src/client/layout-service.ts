import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/** Install the layout selected by Advanced or Extended profile composition. */
export function installDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): void {
  if (ctx.reflect.get('layout', false) !== undefined) {
    throw new Error('dsh-plugin-desktop: advanced and extended modes require exclusive layout ownership')
  }

  ctx.effect(() => {
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: {
      getSnapshot: () => layout.getPanelInfo(),
      subscribe: listener => layout.subscribe(listener),
    } } })
    const dispose = ctx.reflect.provide('layout', layout)
    const disposePanels = ctx.slots.subscribe('main', () => layout.retainMainPanels())
    layout.retainMainPanels()
    return () => {
      layout.dispose()
      disposePanels()
      disposePanelInfo()
      void dispose()
    }
  }, 'desktop: layout service')
}
