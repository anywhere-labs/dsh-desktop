/** Desktop-wide pnpm policy applied to every package-manager operation. */

/**
 * DSH Desktop accepts explicitly requested package versions immediately.
 * Keep this process-local: never rewrite a user's pnpm configuration file.
 */
export const PNPM_IGNORE_MINIMUM_RELEASE_AGE = '--config.minimumReleaseAge=0'

/**
 * DSH Desktop supplies the verified, bundled pnpm executable in Node mode.
 * Prevent automatic version switching on projects declaring `packageManager`,
 * which attempts to provision alternate versions into an unbootstrapped or
 * incompatible store state.
 */
export const PNPM_IGNORE_PM_ON_FAIL = '--pm-on-fail=ignore'

export const DESKTOP_PNPM_POLICY_ARGS = [
  PNPM_IGNORE_PM_ON_FAIL,
  PNPM_IGNORE_MINIMUM_RELEASE_AGE,
] as const

/**
 * Scoped environment variables applied to Desktop pnpm child trees to prevent
 * pnpm from attempting to download and switch to a different package manager
 * version declared in a project's `packageManager` field.
 */
export const DESKTOP_PNPM_ENV_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  pnpm_config_pm_on_fail: 'ignore',
  pnpm_config_manage_package_manager_versions: 'false',
})

/** Prefix a direct pnpm argv without adding the same Desktop policy twice. */
export function withDesktopPnpmPolicy(argv: readonly string[]): string[] {
  const missing = DESKTOP_PNPM_POLICY_ARGS.filter(arg => !argv.includes(arg))
  if (missing.length === 0) return [...argv]
  return [...missing, ...argv]
}

/**
 * `dsh plugin` ultimately resolves the Desktop pnpm shim, which owns the one
 * policy argument. Remove an eagerly forwarded copy before that boundary.
 */
export function withoutForwardedDesktopPnpmPolicy(argv: readonly string[]): string[] {
  if (argv[0] !== 'plugin') return [...argv]
  const policySet = new Set<string>(DESKTOP_PNPM_POLICY_ARGS)
  return argv.filter((argument, index) => index === 0 || !policySet.has(argument))
}
