import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/**
 * Provide the Desktop-owned layout service for one plugin-fiber lifetime.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns disposer for the service registration.
 */
export function provideDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): () => void {
  const dispose = ctx.reflect.provide('layout', layout)
  return () => { void dispose() }
}
