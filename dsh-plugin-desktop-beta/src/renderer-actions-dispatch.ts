/** Main-process dispatch for the Desktop actions invoked from the renderer. */

/**
 * Native operations kept on the Electron lifetime.
 *
 * Every implementation lives in the main process, so a Host generation that
 * exited, hung, or never booted cannot take these operations down with it.
 */
export interface DesktopRendererActionHandlers {
  /** Open the already-configured DSH Desktop terminal for the active profile. */
  openTerminal(): void
  /** Request one confirmed, orderly Electron relaunch. */
  restart(): Promise<void>
  /** Request one confirmed relaunch into the pre-Host recovery assistant. */
  restartToRecovery(): Promise<void>
  /** Reload the mounted renderer document. */
  reload(): void
  /** Toggle Developer Tools for the mounted renderer. */
  developerTools(): void
  /** Run the interactive update check contributed to the native menus. */
  checkForUpdates(): Promise<void>
  /** Export diagnostics through the native confirmation and reveal flow. */
  exportDiagnostics(): Promise<void>
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Dispatch one validated Desktop action for the renderer bridge.
 *
 * Actions that replace or end the current renderer are acknowledged before
 * they run, mirroring the deferred `afterResponse` of the loopback settings
 * routes: the renderer must never wait on a document it is about to lose.
 * @param actions - main-process operations behind the bridge.
 * @param logError - sink for failures reported after acknowledgement.
 * @returns a dispatcher rejecting every unsupported action.
 */
export function createDesktopRendererActionDispatcher(
  actions: DesktopRendererActionHandlers,
  logError: (message: string) => void,
): (action: unknown) => Promise<void> {
  const acknowledge = (operation: string, run: () => void | Promise<void>): void => {
    setImmediate(() => {
      void Promise.resolve().then(run).catch((cause: unknown) => {
        logError(`dsh-plugin-desktop: failed to ${operation}: ${describe(cause)}`)
      })
    })
  }
  return async (action: unknown): Promise<void> => {
    switch (action) {
      case 'terminal': actions.openTerminal(); return
      case 'developer': actions.developerTools(); return
      case 'diagnostics': await actions.exportDiagnostics(); return
      case 'check-for-updates': await actions.checkForUpdates(); return
      case 'restart': acknowledge('restart Desktop', () => actions.restart()); return
      case 'restart-recovery':
        acknowledge('restart Desktop in recovery mode', () => actions.restartToRecovery())
        return
      case 'reload': acknowledge('reload the renderer', () => { actions.reload() }); return
      default: throw new Error('dsh-plugin-desktop: unsupported Desktop renderer action')
    }
  }
}
