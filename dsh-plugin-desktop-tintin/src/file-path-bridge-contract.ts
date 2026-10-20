/** Main-world key for the upstream Desktop host-path bridge. */
export const DESKTOP_HOST_PATHS_BRIDGE = '__DSH_HOST_PATHS__'

/** Capability exposed by the context-isolated preload to the official composer. */
export interface DesktopHostPathBridge {
  /** Absolute harness-host path of one picked file, or empty when the shell has none for it. */
  pathFor(file: File): string
}

/** Window shape consumed by the official conversation composer. */
export interface DesktopHostPathBridgeWindow {
  __DSH_HOST_PATHS__?: DesktopHostPathBridge
}
