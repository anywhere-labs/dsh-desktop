import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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
 * Ownership is detected through the `provide` failure itself — reading the
 * store (`reflect.get`) would create a cross-fiber trace dependency during
 * application, which deadlocks the page.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns whether this fiber now owns the service.
 */
export function claimDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): boolean {
  try {
    const dispose = ctx.reflect.provide('layout', layout)
    // Cordis uses the factory result as the uninstall disposer, so the factory
    // must return it — a void-returning factory fails the SyncEffect overload.
    ctx.effect(() => () => { void dispose() }, 'desktop: layout service')
    return true
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('has been registered')) throw cause
    console.warn('dsh-plugin-desktop: layout service owned by upstream dsh-client-ui-layout; deferring to it')
    return false
  }
}
