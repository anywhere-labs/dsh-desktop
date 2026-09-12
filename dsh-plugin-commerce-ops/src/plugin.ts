import type { Context } from '@deepseek-ai/cordis'
import { registerCommerceOpsRoutes, registerCommerceOpsWorkbenchPage, type CommerceWebServer } from './host/routes.js'

export const name = 'commerce-ops'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const webServer = (ctx as Context & { readonly webServer: CommerceWebServer }).webServer
  ctx.effect(() => registerCommerceOpsRoutes(webServer), 'commerce-ops: routes')
  ctx.effect(() => registerCommerceOpsWorkbenchPage(webServer), 'commerce-ops: workbench page')
}
