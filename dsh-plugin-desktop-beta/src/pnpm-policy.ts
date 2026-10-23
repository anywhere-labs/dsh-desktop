/** Desktop-wide pnpm policy applied to every package-manager operation. */

/**
 * DSH Desktop accepts explicitly requested package versions immediately.
 * Keep this process-local: never rewrite a user's pnpm configuration file.
 */
export const PNPM_IGNORE_MINIMUM_RELEASE_AGE = '--config.minimumReleaseAge=0'

/**
 * Keep the same policy in the app environment so package-manager calls made by
 * the Host, plugins, terminal and their descendants do not depend on which
 * wrapper launched them. The explicit pnpm argument above remains in place for
 * commands started without this Electron parent process.
 */
export function applyDesktopPackageAgePolicy(environment: NodeJS.ProcessEnv): void {
  environment.pnpm_config_minimum_release_age = '0'
  environment.YARN_NPM_MINIMAL_AGE_GATE = '0'
}

/** Prefix a direct pnpm argv without adding the same Desktop policy twice. */
export function withDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv.includes(PNPM_IGNORE_MINIMUM_RELEASE_AGE)) return [...argv]
  return [PNPM_IGNORE_MINIMUM_RELEASE_AGE, ...argv]
}

/**
 * `dsh plugin` ultimately resolves the Desktop pnpm shim, which owns the one
 * policy argument. Remove an eagerly forwarded copy before that boundary.
 */
export function withoutForwardedDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv[0] !== 'plugin') return [...argv]
  return argv.filter((argument, index) => index === 0 || argument !== PNPM_IGNORE_MINIMUM_RELEASE_AGE)
}
