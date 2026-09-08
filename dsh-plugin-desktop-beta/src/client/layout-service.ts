import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/** Install the layout selected by Advanced or Extended profile composition. */
export function installDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): void {
  if (ctx.reflect.get('layout', false) !== undefined) {
    throw new Error('dsh-plugin-desktop: advanced and extended modes require exclusive layout ownership')
  }

  ctx.effect(() => {
    const dispose = ctx.reflect.provide('layout', layout)
    return () => { void dispose() }
  }, 'desktop: layout service')
}
