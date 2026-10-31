/** Desktop-wide pnpm policy applied to every package-manager operation. */

/**
 * DSH Desktop accepts explicitly requested package versions immediately.
 * Keep this process-local: never rewrite a user's pnpm configuration file.
 */
export const PNPM_IGNORE_MINIMUM_RELEASE_AGE = '--config.minimumReleaseAge=0'

/**
 * The bundled pnpm is released with DSH Desktop and cannot update itself, so its
 * update notice would recommend a `pnpm self-update` that never takes effect.
 * Keep this process-local: never rewrite a user's pnpm configuration file.
 */
export const PNPM_DISABLE_UPDATE_NOTIFIER = '--config.updateNotifier=false'

/**
 * Keep the same release-age and update-notice policies in the app environment
 * so package-manager calls made by the Host, plugins, terminal and their
 * descendants do not depend on which wrapper launched them. The explicit pnpm
 * arguments above remain in place for commands started without this Electron
 * parent process.
 */
export function applyDesktopPackageManagerPolicy(environment: NodeJS.ProcessEnv): void {
  environment.pnpm_config_minimum_release_age = '0'
  environment.pnpm_config_update_notifier = 'false'
  environment.YARN_NPM_MINIMAL_AGE_GATE = '0'
}

/** Prefix a direct pnpm argv without adding the same Desktop policy twice. */
export function withDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv.includes(PNPM_IGNORE_MINIMUM_RELEASE_AGE)) return [...argv]
  return [PNPM_IGNORE_MINIMUM_RELEASE_AGE, ...argv]
}

/**
 * `dsh plugin` runs the bundled pnpm invocation, which owns the one policy
 * argument. Remove an eagerly forwarded copy before that boundary.
 */
export function withoutForwardedDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv[0] !== 'plugin') return [...argv]
  return argv.filter((argument, index) => index === 0 || argument !== PNPM_IGNORE_MINIMUM_RELEASE_AGE)
}
