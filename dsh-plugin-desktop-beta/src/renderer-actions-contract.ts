/** Contract for the Electron-owned Desktop actions the renderer may invoke. */

/** Main-world key of the context-isolated Desktop actions bridge. */
export const DESKTOP_RENDERER_ACTIONS_BRIDGE = 'dshDesktopActions'

/** Single IPC channel carrying one fixed, argument-free Desktop action. */
export const DESKTOP_RENDERER_ACTION_CHANNEL = 'dsh-desktop:renderer-action'

/**
 * Native operations owned by the Electron main process.
 *
 * Each action is deliberately argument-free, matching the exact empty request
 * bodies accepted by the equivalent loopback settings routes.
 */
export type DesktopRendererAction =
  | 'terminal'
  | 'restart'
  | 'restart-recovery'
  | 'reload'
  | 'developer'
  | 'diagnostics'
  | 'check-for-updates'

/** Capability exposed by the context-isolated preload to the Desktop page. */
export interface DesktopRendererActionsBridge {
  /** Invoke one Desktop action without depending on the Host process. */
  invoke(action: DesktopRendererAction): Promise<void>
}
