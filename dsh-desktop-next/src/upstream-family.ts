/**
 * Upstream APIs that differ between the DSH releases Next and Beta follow. While Beta tracks a
 * newer upstream prerelease than Next, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); callers import these names from here so that the rest
 * of the source stays mirrored.
 */
import type { ModuleHooks } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StartupError } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { IndexInjection, WebRoute } from '@deepseek-ai/dsh-host-webserver'

export { OPTIONAL_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

/**
 * Render the composition a failed startup recorded before disposal. dsh 0.2.1 records none, so the
 * Host diagnostic has no section for it.
 */
export const startupCompositionDiagnostic: ((error: StartupError) => string[]) | undefined = undefined

// Plugin operation history for failure reports needs the plugin-manager operation event that dsh 0.2.1
// does not have, so the Host announces no run, and the shell neither keeps a history nor accepts
// operation evidence over IPC.
export const hostOperationDiagnostics: ((send: (message: object) => Promise<void>) => { observe(ctx: Context): void }) | undefined = undefined
export const recordPluginCommands: (<Runner>(ctx: Context, runner: Runner) => Runner) | undefined = undefined
export const createOperationHistory: ((directory: string) => {
  host(): (message: unknown) => boolean
  readonly runId: string | undefined
  readonly reportNote: readonly string[] | undefined
  append(report: string): void
  close(): Promise<void>
}) | undefined = undefined
export const isOperationEvidence: ((message: unknown) => boolean) | undefined = undefined

// dsh 0.2.1 ships no official Computer Use bundle: Computer Use (Next) serves every Agent through one global
// `/computer-use`, and the Host resolves no official provider.
export const officialComputerUse: {
  serves(ctx: Context, agent: Agent): boolean
  settings(): { officialSupported: boolean }
  commandRegistrar(ctx: Context): (definition: CommandDefinition) => () => void
} | undefined = undefined
export const OFFICIAL_CUA_PROVIDER_PACKAGE: string | undefined = undefined
export const installOfficialCuaResolution: ((runtimeDir: string) => ModuleHooks | undefined) | undefined = undefined

/**
 * Collect the Web boot injections for the Desktop window.
 * @param ctx - booted Host context with the Web server and connection services.
 * @returns the injection table rendered into the window document.
 */
export function webIndexInjections(ctx: Context): IndexInjection[] {
  return ctx.webServer.collectIndexInjections()
}

/** A Fetch responder; this release's Web server registers none, so it is never called. */
export type WebResourceResponder = (request: Request, peer?: unknown) => Promise<Response>
/** A named route as the Web server accepts it: a response handler. */
export type WebRegistration = WebRoute
/** The fallback seat as the Web server accepts it: a response handler. */
export type WebFallback = WebRoute['handler']

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
  return { ...route, handler: wrap.handler(route.handler) }
}

/**
 * Wrap the fallback seat's responder.
 * @param fallback - the fallback a plugin submitted.
 * @param wrap - Desktop policy for handlers and resources.
 * @returns the fallback with its wrapped responder.
 */
export function wrapFallback(fallback: WebFallback, wrap: ResponderWrappers): WebFallback {
  return wrap.handler(fallback)
}
