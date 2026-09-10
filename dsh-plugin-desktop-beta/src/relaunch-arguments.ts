/** One-process launch marker used to enter recovery before Profile Host boot. */
export const DESKTOP_RECOVERY_MODE_ARGUMENT = '--dsh-desktop-recovery'
/** Process marker selecting the disposable Safe Mode DSH environment. */
export const DESKTOP_SAFE_MODE_ARGUMENT = '--dsh-desktop-safe-mode'

/** Rebuild the current Electron command line without retaining one-shot modes. */
export function desktopDefaultRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return argv.slice(1).filter(argument => argument !== DESKTOP_RECOVERY_MODE_ARGUMENT
    && argument !== DESKTOP_SAFE_MODE_ARGUMENT)
}

/** Build a one-shot recovery-mode command line. */
export function desktopRecoveryRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return [...desktopDefaultRelaunchArguments(argv), DESKTOP_RECOVERY_MODE_ARGUMENT]
}

/** Detect an explicit recovery-mode launch without accepting prefix variants. */
export function desktopRecoveryModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.slice(1).includes(DESKTOP_RECOVERY_MODE_ARGUMENT)
}

/** Build a one-shot command line that boots against the isolated Safe Mode home. */
export function desktopSafeModeRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return [...desktopDefaultRelaunchArguments(argv), DESKTOP_SAFE_MODE_ARGUMENT]
}

/** Detect only the exact Safe Mode argument, never a prefix variant. */
export function desktopSafeModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.slice(1).includes(DESKTOP_SAFE_MODE_ARGUMENT)
}
