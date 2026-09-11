import type { Context } from '@deepseek-ai/cordis'
import { registerXinianRoutes, registerXinianWorkbench, type XinianWebServer } from './host/routes.js'

export const name = 'xinian-commerce'
export const inject = ['webServer']
export function apply(ctx: Context): void { const server = (ctx as Context & { webServer: XinianWebServer }).webServer; ctx.effect(() => registerXinianRoutes(server), 'xinian-commerce: routes'); ctx.effect(() => registerXinianWorkbench(server), 'xinian-commerce: workbench') }
