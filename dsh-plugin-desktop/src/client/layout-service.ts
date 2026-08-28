import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/**
 * Try to take ownership of the process-wide `layout` service.
 *
 * Harness 0.1.1-rc.* ships `dsh-client-ui-layout`, which registers the same
 * shared service for its own presentation. When that owner wins the race,
 * taking a root slot anyway would stack a second frame over the upstream one
 * and the duplicate registration would fail the whole entry — rolling back
 * every installed effect, styles included (#517). Losing the race therefore
 * degrades to `false`: the caller keeps mode markers but leaves presentation
 * upstream.
 *
 * Ownership is detected through the effect's synchronous `provide` failure.
 * Keeping the registration inside the owning effect preserves Cordis unload
 * and re-apply semantics without a separate process-global marker.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns whether this fiber now owns the service.
 */
export function claimDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): boolean {
  try {
    ctx.effect(() => {
      const dispose = ctx.reflect.provide('layout', layout)
      return () => { void dispose() }
    }, 'desktop: layout service')
    return true
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('service "layout" has been registered')) throw cause
    console.warn('dsh-plugin-desktop: layout service already owned; deferring desktop presentation')
    return false
  }
}
