/**
 * Upstream APIs that differ between the DSH releases Next and Beta follow. While Beta tracks a
 * newer upstream prerelease than Next, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); callers import these names from here so that the rest
 * of the source stays mirrored.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { IndexInjection, WebResource, WebResourceRoute, WebRoute } from '@deepseek-ai/dsh-host-webserver'

export { OPTIONAL_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'

/**
 * Collect the Web boot injections for the Desktop window.
 * @param ctx - booted Host context with the Web server and connection services.
 * @returns the injection table rendered into the window document for its browser Peer.
 */
export function webIndexInjections(ctx: Context): IndexInjection[] {
  return ctx.webServer.collectIndexInjections(ctx.connection.browserPeer)
}

/** A Fetch responder: the Peer is absent for an HTTP request and present for an in-process read. */
export type WebResourceResponder = WebResource
/** A named route as the Web server accepts it: a response handler or a Fetch resource. */
export type WebRegistration = WebRoute | WebResourceRoute
/** The fallback seat as the Web server accepts it: a response handler or a Fetch resource. */
export type WebFallback = WebRoute['handler'] | Pick<WebResourceRoute, 'resource'>

/** Desktop policy applied around whichever responder a registration carries. */
export interface ResponderWrappers {
  handler(inner: WebRoute['handler']): WebRoute['handler']
  resource(inner: WebResourceResponder): WebResourceResponder
}

/**
 * Wrap a named route's responder, keeping its kind and path.
 * @param route - the registration a plugin submitted.
 * @param wrap - Desktop policy for handlers and resources.
 * @returns the registration with its wrapped responder.
 */
export function wrapRegistration(route: WebRegistration, wrap: ResponderWrappers): WebRegistration {
  return 'resource' in route ? { ...route, resource: wrap.resource(route.resource) } : { ...route, handler: wrap.handler(route.handler) }
}

/**
 * Wrap the fallback seat's responder.
 * @param fallback - the fallback a plugin submitted.
 * @param wrap - Desktop policy for handlers and resources.
 * @returns the fallback with its wrapped responder.
 */
export function wrapFallback(fallback: WebFallback, wrap: ResponderWrappers): WebFallback {
  return typeof fallback === 'function' ? wrap.handler(fallback) : { resource: wrap.resource(fallback.resource) }
}
