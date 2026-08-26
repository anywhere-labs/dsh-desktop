/** One-process launch marker used to enter recovery before Profile Host boot. */
export const DESKTOP_RECOVERY_MODE_ARGUMENT = '--dsh-desktop-recovery'

/** Rebuild the current Electron command line without retaining recovery mode. */
export function desktopDefaultRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return argv.slice(1).filter(argument => argument !== DESKTOP_RECOVERY_MODE_ARGUMENT)
}

/** Build a one-shot recovery-mode command line. */
export function desktopRecoveryRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return [...desktopDefaultRelaunchArguments(argv), DESKTOP_RECOVERY_MODE_ARGUMENT]
}

/** Detect an explicit recovery-mode launch without accepting prefix variants. */
export function desktopRecoveryModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.slice(1).includes(DESKTOP_RECOVERY_MODE_ARGUMENT)
}
