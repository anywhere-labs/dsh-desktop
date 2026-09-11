import { registerXinianRoutes, registerXinianWorkbench } from './host/routes.js';
export const name = 'xinian-commerce';
export const inject = ['webServer'];
export function apply(ctx) { const server = ctx.webServer; ctx.effect(() => registerXinianRoutes(server), 'xinian-commerce: routes'); ctx.effect(() => registerXinianWorkbench(server), 'xinian-commerce: workbench'); }
