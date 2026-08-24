/** Application-level quit sources that must remain active before any window mounts. */

/** Maximum grace allowed for the Cordis tree to dispose before native exit. */
export const DESKTOP_SHUTDOWN_TIMEOUT_MS = 5_000

/** Bounded, escalating shutdown controller for the Electron application. */
export interface DesktopShutdown {
  /** Start graceful disposal, or force exit when a shutdown already owns it. */
  request(code: number): Promise<void>
}

/** Native operations performed after the Host tree has disposed. */
export interface DesktopNativeExit {
  /** Mark the window close path as a final process exit. */
  prepareToQuit(): void
  /** Schedule a fresh Electron process using the current command line. */
  relaunch(): void
  /** End the current Electron process without another quit event. */
  exit(code: number): void
}

/** Final-exit state shared by ordinary quits and mode-change relaunches. */
export interface DesktopExitCoordinator {
  /** Mark the next successful exit as a relaunch. */
  requestRelaunch(): void
  /** Run one native handoff after Host disposal and before a successful exit. */
  requestBeforeExit(action: () => void | Promise<void>): void
  /** Complete one native exit after Cordis teardown. */
  finish(code: number): void | Promise<void>
}

/**
 * Coordinate the final Electron action without relaunching failed generations.
 * @param native - native application and runtime exit operations.
 * @param beforeExit - listener cleanup that must precede app.exit.
 * @returns a final-exit controller consumed by the shutdown path.
 */
export function createDesktopExitCoordinator(
  native: DesktopNativeExit,
  beforeExit: () => void,
): DesktopExitCoordinator {
  let relaunchRequested = false
  let beforeExitAction: (() => void | Promise<void>) | undefined
  return {
    requestRelaunch() {
      if (beforeExitAction !== undefined) {
        throw new Error('dsh-plugin-desktop: a native exit handoff is already pending')
      }
      relaunchRequested = true
    },
    requestBeforeExit(action) {
      if (relaunchRequested || beforeExitAction !== undefined) {
        throw new Error('dsh-plugin-desktop: a native exit action is already pending')
      }
      beforeExitAction = action
    },
    finish(code) {
      beforeExit()
      native.prepareToQuit()
      if (code === 0 && beforeExitAction !== undefined) {
        return Promise.resolve().then(beforeExitAction).then(
          () => { native.exit(0) },
          () => { native.exit(1) },
        )
      }
      if (code === 0 && relaunchRequested) native.relaunch()
      native.exit(code)
    },
  }
}

/**
 * Create one bounded shutdown around the Host Cordis disposer.
 * @param dispose - whole Host tree teardown.
 * @param exit - final native process exit.
 * @param timeoutMs - grace before forced exit.
 * @returns a controller whose second request escalates immediately.
 */
export function createDesktopShutdown(
  dispose: () => Promise<void>,
  exit: (code: number) => void | Promise<void>,
  timeoutMs = DESKTOP_SHUTDOWN_TIMEOUT_MS,
): DesktopShutdown {
  let pending: Promise<void> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let exitOperation: Promise<void> | undefined

  const exitOnce = (code: number): Promise<void> => {
    if (exitOperation !== undefined) return exitOperation
    if (timeout !== undefined) clearTimeout(timeout)
    try {
      exitOperation = Promise.resolve(exit(code))
    } catch (cause) {
      exitOperation = Promise.reject(cause)
    }
    return exitOperation
  }

  return {
    request(code) {
      if (pending !== undefined) {
        // Electron emits another before-quit when disposal closes the final
        // window. Keep that normal quit idempotent so post-disposal actions
        // such as relaunch and uninstall handoff are not skipped.
        if (code !== 0) void exitOnce(code)
        return pending
      }
      const failureCode = code === 0 ? 1 : code
      timeout = setTimeout(() => { void exitOnce(failureCode) }, timeoutMs)
      pending = Promise.resolve().then(dispose).then(
        async () => { await exitOnce(code) },
        async () => { await exitOnce(failureCode) },
      )
      return pending
    },
  }
}

/** Minimal native quit event consumed by the launcher. */
export interface DesktopQuitEvent {
  /** Cancel Electron's immediate default exit. */
  preventDefault(): void
}

/** Process signal surface used by the shutdown coordinator. */
export interface DesktopSignalSource {
  /** Register one shutdown signal listener. */
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  /** Remove one shutdown signal listener. */
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

/** Electron application surface used by the shutdown coordinator. */
export interface DesktopQuitSource {
  /** Register the native quit guard. */
  on(event: 'before-quit', listener: (event: DesktopQuitEvent) => void): unknown
  /** Remove the native quit guard. */
  off(event: 'before-quit', listener: (event: DesktopQuitEvent) => void): unknown
}

/**
 * Route every application-level quit source through Cordis teardown.
 * @param signals - process signal owner.
 * @param nativeApp - Electron application event owner.
 * @param requestQuit - idempotent launcher shutdown request.
 * @returns a disposer removing every listener.
 */
export function installShutdownRequests(
  signals: DesktopSignalSource,
  nativeApp: DesktopQuitSource,
  requestQuit: (code: number) => void,
): () => void {
  const interrupt = (): void => { requestQuit(130) }
  const terminate = (): void => { requestQuit(0) }
  const beforeQuit = (event: DesktopQuitEvent): void => {
    event.preventDefault()
    requestQuit(0)
  }
  signals.on('SIGINT', interrupt)
  signals.on('SIGTERM', terminate)
  nativeApp.on('before-quit', beforeQuit)
  return () => {
    signals.off('SIGINT', interrupt)
    signals.off('SIGTERM', terminate)
    nativeApp.off('before-quit', beforeQuit)
  }
}
