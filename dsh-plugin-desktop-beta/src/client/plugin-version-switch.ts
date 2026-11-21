/**
 * Replace an installed third-party bundle with another version or source when the official Plugins page offers no
 * update for it: a Git branch, a Git spec that pins no full commit, a local directory or a tarball. With HMR the
 * official manager refuses to install over an installed package (`already-installed`), so the replacement follows
 * the order the official `updateBundle` uses: check the target, remove the installed copy, install the target, and
 * install the removed source again when the target does not install.
 */
import type { BundleInfo, ChangeResult, InspectOptions, InstallBundleOptions, InstallSpecKind, PluginSpecInspection } from '@deepseek-ai/dsh-api-remotes/client'

/** A generated Remote's answer: the Host's value, or the transport failure. */
export type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } }

/** The manager operations a replacement uses. */
export interface VersionSwitchManager {
  inspect(spec: string, options?: InspectOptions): Promise<RemoteAnswer<PluginSpecInspection>>
  removeBundle(name: string): Promise<RemoteAnswer<ChangeResult>>
  installBundle(spec: string, options?: InstallBundleOptions): Promise<RemoteAnswer<ChangeResult>>
}

/** A bundle the replacement can act on: its name, the spec it was saved with, its version, and its switch. */
export interface VersionSwitchTarget {
  readonly name: string
  readonly source: string
  readonly version?: string
  readonly enabled: boolean
}

/** The step a running replacement reached. */
export type VersionSwitchStep = 'checking' | 'removing' | 'installing' | 'restoring'

/**
 * How a replacement ended.
 * - `refused`: the target was not accepted; nothing changed.
 * - `not-removed`: the installed copy could not be removed; nothing changed.
 * - `installed`: the target replaced the installed copy.
 * - `restored`: the target did not install, and the removed source is installed again.
 * - `lost`: the target did not install, and neither did the removed source; `previous` is the spec to install by hand.
 */
export type VersionSwitchOutcome =
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'not-removed'; readonly reason: string }
  | { readonly status: 'installed'; readonly result: ChangeResult }
  | { readonly status: 'restored'; readonly reason: string; readonly restore: ChangeResult }
  | { readonly status: 'lost'; readonly reason: string; readonly restoreReason: string; readonly previous: string }

/**
 * The bundle this replacement offers itself for, or undefined. The official page already updates a bundle it lists
 * with `update`, ships or manages the official ones, and never removes a bundle carrying plugin management.
 * @param bundle - the bundle as `listBundles` lists it.
 * @returns the target, or undefined when the official page covers it or it cannot be removed.
 */
export function versionSwitchTarget(bundle: BundleInfo | undefined): VersionSwitchTarget | undefined {
  if (bundle === undefined || bundle.official || !bundle.installed || bundle.availability !== 'profile') return undefined
  if (bundle.source === undefined || bundle.update !== undefined) return undefined
  if (!bundle.removable || bundle.readOnlyReason !== undefined) return undefined
  return { name: bundle.name, source: bundle.source, enabled: bundle.enabled, ...bundle.version === undefined ? {} : { version: bundle.version } }
}

/** A failed change in the words the manager gave for it. */
export function changeReason(change: ChangeResult): string {
  const diagnostic = change.error?.diagnostic?.trim()
  if (diagnostic) return diagnostic
  const output = change.packageResult?.output.trim()
  if (output) return output.split(/\r?\n/).slice(-8).join('\n')
  return change.error?.code ?? change.application
}

const failed = (change: ChangeResult): boolean => change.application === 'failed' || change.application === 'cancelled'

/** Settle one manager call into a change; a transport failure reads as the failed step it is. */
async function settle(stage: ChangeResult['stage'], target: string, call: Promise<RemoteAnswer<ChangeResult>>): Promise<ChangeResult> {
  try {
    const answer = await call
    if (answer.ok) return answer.value
    return { changed: false, application: 'failed', stage, target, error: { code: 'operation-error', diagnostic: answer.error.message } }
  } catch (error) {
    return { changed: false, application: 'failed', stage, target, error: { code: 'operation-error', diagnostic: error instanceof Error ? error.message : String(error) } }
  }
}

/**
 * The form a spec takes when the manager refuses it before reading it: a local path or tarball, or a registry spec.
 * @param spec - a trimmed install spec.
 * @returns `path` for an absolute or `file:`/`link:` path, `registry` otherwise.
 */
function uncheckedKind(spec: string): InstallSpecKind {
  return /^(?:file|link):/i.test(spec) || /^[\\/]/.test(spec) || /^[a-z]:[\\/]/i.test(spec) ? 'path' : 'registry'
}

/**
 * Check a target spec before anything is removed. The manager refuses `already-installed` for a registry name or a
 * directory naming the installed package, which is the replacement's own case; any other refusal means the target
 * cannot install, and a package named otherwise would install beside the removed one instead of replacing it.
 * @returns the reason the target is refused, or the spec's form when it may replace the installed copy.
 */
async function checkTarget(manager: VersionSwitchManager, target: VersionSwitchTarget, spec: string): Promise<{ reason: string } | { kind: InstallSpecKind }> {
  let answer: RemoteAnswer<PluginSpecInspection>
  try { answer = await manager.inspect(spec, {}) } catch (error) { return { reason: error instanceof Error ? error.message : String(error) } }
  if (!answer.ok) return { reason: answer.error.message }
  const inspection = answer.value
  if (inspection.status === 'refused') {
    // The package under this name is the one being replaced, so the refusal is the replacement, not a problem.
    if (inspection.problem === 'already-installed') return { kind: uncheckedKind(spec) }
    return { reason: inspection.reason }
  }
  if (inspection.name !== undefined && inspection.name !== target.name) return { reason: `${spec} is the package ${inspection.name}, not ${target.name}` }
  if (inspection.bundle === false) return { reason: `${spec} declares no dsh.bundle` }
  return { kind: inspection.kind }
}

/**
 * Replace an installed bundle with the package another spec names, keeping its switch.
 * @param manager - the official manager's Remote.
 * @param target - the installed bundle.
 * @param spec - what to install instead: a Git spec, an absolute directory or tarball, or `name@version`.
 * @param onStep - told each step as it starts.
 * @returns how the replacement ended.
 */
export async function switchBundleVersion(
  manager: VersionSwitchManager, target: VersionSwitchTarget, spec: string, onStep: (step: VersionSwitchStep) => void = () => {},
): Promise<VersionSwitchOutcome> {
  const next = spec.trim()
  if (next === '') return { status: 'refused', reason: 'the package spec must not be empty' }
  onStep('checking')
  const checked = await checkTarget(manager, target, next)
  if ('reason' in checked) return { status: 'refused', reason: checked.reason }
  onStep('removing')
  const removal = await settle('remove', target.name, manager.removeBundle(target.name))
  if (failed(removal)) return { status: 'not-removed', reason: changeReason(removal) }
  onStep('installing')
  // A registry target is saved exactly, as the official update saves it; other forms carry their own exactness.
  const options: InstallBundleOptions = { enabled: target.enabled, ...checked.kind === 'registry' ? { saveExact: true } : {} }
  const result = await settle('install', next, manager.installBundle(next, options))
  let reason: string | undefined
  if (failed(result)) reason = changeReason(result)
  else if (result.bundle !== target.name) {
    reason = result.bundle === undefined
      ? `${next} installed no bundle named ${target.name}`
      : `${next} installed ${result.bundle}, not ${target.name}`
  }
  if (reason === undefined) return { status: 'installed', result }
  onStep('restoring')
  // A target that installed, as the wrong package or one that failed to start, goes before the removed source returns.
  const installed = failed(result) ? (result.stage === 'enable' ? target.name : undefined) : result.bundle
  if (installed !== undefined) await settle('remove', installed, manager.removeBundle(installed))
  const restore = await settle('install', target.source, manager.installBundle(target.source, { enabled: target.enabled }))
  if (failed(restore)) return { status: 'lost', reason, restoreReason: changeReason(restore), previous: target.source }
  return { status: 'restored', reason, restore }
}
