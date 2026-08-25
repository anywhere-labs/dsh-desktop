import type { DesktopClientEnvironment } from './environment.ts'

/**
 * Whether a previous application of this entry still owns the page.
 *
 * The mode markers are claimed synchronously at `apply()` entry and cleared on
 * failure, so any value here means another fiber's shell (advanced, extended,
 * or framed) is alive. Re-application while it stands would stack a second
 * frame over the live one, so the guard degrades to a no-op instead — the
 * loader may restart this entry freely and the stale fiber keeps presenting
 * until its own cleanup runs.
 */
export function isDesktopShellAlreadyApplied(doc: Document): boolean {
  return doc.body.dataset.dshDesktopMode !== undefined
}

/**
 * Claim the mode markers synchronously for one entry application.
 *
 * Plain writes on purpose: effect scheduling is asynchronous, which would
 * leave a re-entry window between two `apply()` calls. Every shell effect
 * re-sets these markers inside its own lifetime and owns their cleanup; this
 * early claim only closes the concurrency window.
 */
export function claimDesktopEntryMarkers(doc: Document, environment: DesktopClientEnvironment): void {
  doc.body.dataset.dshDesktopMode = environment.mode
  doc.body.dataset.dshDesktopPlatform = environment.platform
  doc.body.dataset.dshDesktopMaterial = environment.material
}

/**
 * Roll the claimed markers back after a failed startup.
 *
 * Any step of the registration walk can throw; a marker left behind then
 * would make `isDesktopShellAlreadyApplied` swallow every loader restart of
 * this entry until a full page reload (#517).
 */
export function clearDesktopEntryMarkers(doc: Document): void {
  delete doc.body.dataset.dshDesktopMode
  delete doc.body.dataset.dshDesktopPlatform
  delete doc.body.dataset.dshDesktopMaterial
}
