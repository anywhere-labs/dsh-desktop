/**
 * Upstream APIs that differ between the DSH releases Next and Beta follow. While Beta tracks a
 * newer upstream prerelease than Next, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); callers import these names from here so that the rest
 * of the source stays mirrored.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { StartupError } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { IndexInjection, WebResource, WebResourceRoute, WebRoute } from '@deepseek-ai/dsh-host-webserver'

export { OPTIONAL_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'

/**
 * Render the plugin states and missing-service observations a failed startup recorded before
 * disposal, as upstream Desktop's fatal diagnostic does from dsh 0.2.2.
 * @param error - startup audit failure.
 * @returns the composition section, or a notice when capturing the composition failed.
 */
export function startupCompositionDiagnostic(error: StartupError): string[] {
  if (error.composition === undefined) return ['Startup composition diagnostic unavailable.']
  const { plugins, services, omittedPlugins, omittedServices } = error.composition
  const sources = [...new Set(plugins.map(plugin => plugin.source))]
  return ['--- startup composition ---',
    'Provider lists contain observed registrations only; an empty list means the provider is unknown.',
    'Source identifies the Loader tree, not necessarily the overriding patch.',
    `Omitted plugin rows: ${String(omittedPlugins)}; omitted missing-service observations: ${String(omittedServices)}.`,
    '--- missing services ---', ...services.map(service => JSON.stringify(service)),
    '--- plugin sources (sourceIndex) ---', ...sources.map((source, index) => JSON.stringify({ index, source })),
    '--- plugins (inactive first) ---', ...plugins.map(({ source, ...plugin }) => JSON.stringify({ ...plugin, sourceIndex: sources.indexOf(source) }))]
}

// Plugin operation history for failure reports, built on the `plugin-manager/operation` event of dsh
// 0.2.2: the Host announces its run and sends records, and the shell journals them and appends recent
// ones to saved reports. The modules live below src/upstream-family/, which only Beta carries.
export { hostOperationDiagnostics, recordPluginCommands } from './upstream-family/operation-diagnostics.ts'
export { createOperationHistory } from './upstream-family/desktop-operation-history.ts'
export { isOperationEvidence } from './upstream-family/operation-record.ts'

// The official Computer Use bundle of dsh 0.2.2 beside Computer Use (Next): the Agents it serves, the per-Agent
// `/computer-use` that leaves them, and the unpacked copy its provider starts the helper from. The modules live
// below src/upstream-family/, which only Beta carries.
export { officialComputerUse } from './upstream-family/official-computer-use.ts'
export { OFFICIAL_CUA_PROVIDER_PACKAGE, installOfficialCuaResolution } from './upstream-family/official-cua.ts'

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
