import { registerCommerceOpsRoutes, registerCommerceOpsWorkbenchPage } from './host/routes.js';
export const name = 'commerce-ops';
export const inject = ['webServer'];
export function apply(ctx) {
    const webServer = ctx.webServer;
    ctx.effect(() => registerCommerceOpsRoutes(webServer), 'commerce-ops: routes');
    ctx.effect(() => registerCommerceOpsWorkbenchPage(webServer), 'commerce-ops: workbench page');
}
