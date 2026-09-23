/** Explicit launch modes survive a native relaunch without leaking into later restarts. */
export const RECOVERY_ARGUMENT = '--next-recovery'
export const SAFE_ARGUMENT = '--next-safe-mode'
export const ONBOARDING_ARGUMENT = '--next-onboarding'

export function relaunchArguments(argv: readonly string[], recovery: boolean, safe: boolean, onboarding = false): string[] {
  return [...argv.filter(value => value !== RECOVERY_ARGUMENT && value !== SAFE_ARGUMENT && value !== ONBOARDING_ARGUMENT),
    ...recovery ? [RECOVERY_ARGUMENT] : safe ? [SAFE_ARGUMENT] : onboarding ? [ONBOARDING_ARGUMENT] : []]
}
