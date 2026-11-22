import { installUnpackedPackageResolution } from './host/unpacked-package.ts'
/**
 * Upstream APIs that differ between the DSH releases Next and Beta follow. While Beta tracks a
 * newer upstream prerelease than Next, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); callers import these names from here so that the rest
 * of the source stays mirrored.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ProfileContext, StartupError } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { IndexInjection, WebEntryUrl, WebFallback as WebServerFallback, WebResource, WebResourceRoute, WebRoute } from '@deepseek-ai/dsh-host-webserver'

export { ON_DEMAND_BUNDLES, OPTIONAL_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'

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
// ones to saved reports. The modules live below src/upstream-family/.
export { hostOperationDiagnostics, recordPluginCommands } from './upstream-family/operation-diagnostics.ts'
export { createOperationHistory } from './upstream-family/desktop-operation-history.ts'
export { isOperationEvidence } from './upstream-family/operation-record.ts'

// The official Computer Use bundle of dsh 0.2.2 beside Computer Use (Next): the Agents it serves and the per-Agent
// `/computer-use` that leaves them. The release installs the bundle on demand into the Profile. The module lives below
// src/upstream-family/.
export { officialComputerUse } from './upstream-family/official-computer-use.ts'

// The official context menus of dsh 0.2.2 save originals and copy cross-origin images through the native file actions.
// The module lives below src/upstream-family/.
export { installFileActions } from './upstream-family/file-actions.ts'

// The official images of dsh 0.2.2 drag out as files through the native file drag: the shell copies the bytes or borrows a
// Session's workspace original that the Host authorizes, then starts the operating-system drag. The modules live below
// src/upstream-family/.
export { installDesktopFileDrag } from './upstream-family/file-drag.ts'
export { createFileDragAuthorization } from './upstream-family/file-drag-authorization.ts'
export { installHostFileDragResources } from './upstream-family/file-drag-resource.ts'

// The LiveShare bundle of dsh 0.2.2 signs its owner in through a Relay popup the page opens itself. The Desktop window
// opens that one popup, keeps it on web pages, and addresses the Relay's code to the Desktop document. The module lives
// below src/upstream-family/.
export { liveshareOwnerLogin } from './upstream-family/liveshare-owner-login.ts'

/**
 * Collect the Web boot injections for the Desktop window.
 * @param ctx - booted Host context with the Web server and connection services.
 * @returns the injection table rendered into the window document for its browser Peer.
 */
export function webIndexInjections(ctx: Context): IndexInjection[] {
  return ctx.webServer.collectIndexInjections(ctx.connection.browserPeer)
}

/**
 * The address the shell opens to sign its window in to the Host's loopback listener. dsh 0.2.3 moved the launch token
 * from Connection to the official token provider, which adds it to the Web server's entry addresses as `dsh web` prints
 * them.
 * @param ctx - booted Host context with the Web server and its authentication providers.
 * @param baseUrl - the listener's loopback origin.
 * @returns the address carrying the launch token, which the shell exchanges for its session cookie.
 */
export function hostLaunchUrl(ctx: Context, baseUrl: string): string {
  const entries: WebEntryUrl[] = []
  ctx.emit(ctx.webServer, 'webserver/entry-url', baseUrl, entries)
  const entry = entries.find(candidate => candidate.open)
  if (entry === undefined) throw new Error('No Host authentication provider offers a sign-in address for the Desktop window')
  return entry.url
}

/**
 * The command-line overlay layer of a ProfileContext. dsh 0.2.3 reads the overlay files on every composition.
 * @param _binName - the launcher name; dsh 0.2.3 evaluates overlays under the composing launcher.
 * @param overlayPaths - absolute overlay file paths in argument order.
 * @returns the context fields carrying that layer.
 */
export function profileOverlays(_binName: string, overlayPaths: readonly string[]): Pick<ProfileContext, 'overlayPaths'> {
  return { overlayPaths }
}

/**
 * Check that a route handler's request carries Host credentials. The dsh 0.2.3 Web server admits a request before
 * dispatching it and hands the handler the Peer it admitted, so an anonymous admission is the only refusal left.
 * @param _connection - the Host's Connection service, which already applied its source and credential checks.
 * @param args - the arguments the Web server passed to the handler.
 * @returns 401 for a request admitted without a live Peer, or undefined.
 */
export function requestRejection(_connection: Context['connection'], args: Parameters<WebRoute['handler']>): number | undefined {
  const [, , peer] = args
  return peer === undefined || peer.signal.aborted ? 401 : undefined
}

/** A Fetch responder: the Peer is absent for an HTTP request and present for an in-process read. */
export type WebResourceResponder = WebResource
/** A named route as the Web server accepts it: a response handler or a Fetch resource. */
export type WebRegistration = WebRoute | WebResourceRoute
/** The fallback seat as the Web server accepts it: a response handler, or a handler or Fetch resource with its access rule. */
export type WebFallback = WebRoute['handler'] | WebServerFallback

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
 * Wrap the fallback seat's responder, keeping its access rule.
 * @param fallback - the fallback a plugin submitted.
 * @param wrap - Desktop policy for handlers and resources.
 * @returns the fallback with its wrapped responder.
 */
export function wrapFallback(fallback: WebFallback, wrap: ResponderWrappers): WebFallback {
  if (typeof fallback === 'function') return wrap.handler(fallback)
  return 'resource' in fallback
    ? { ...fallback, resource: wrap.resource(fallback.resource) }
    : { ...fallback, handler: wrap.handler(fallback.handler) }
}

/** Profile selections retired by this upstream family; session data is never rewritten. */
export const RETIRED_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-experimental-agent-team-profile', '@deepseek-ai/dsh-experimental-agent-team-web-profile', '@deepseek-ai/dsh-experimental-tool-worktree']

/** Office skills now reside in their package and must be readable by external tools. */
export function installOfficeSkillResolution(runtimeDir: string) { return installUnpackedPackageResolution(runtimeDir, '@deepseek-ai/dsh-skill-office', 'Office skills') }

export { OFFICIAL_CUA_PROVIDER_PACKAGE, installOfficialCuaResolution } from './upstream-family/official-cua.ts'
