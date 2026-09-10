/** Cross-platform window-material preferences and Windows capability gates. */

import { release as osRelease } from 'node:os'
import type { DesktopPlatform, DesktopShellMode } from './runtime.ts'

export type MacosWindowMaterial = 'off' | 'transparent'
export type WindowsWindowMaterial = 'off' | 'mica'
/** Persisted compatibility value accepted only so pre-removal settings still boot. */
export type PersistedWindowsWindowMaterial = WindowsWindowMaterial | 'acrylic'
export type DesktopWindowMaterial = MacosWindowMaterial | WindowsWindowMaterial

export const DEFAULT_MACOS_WINDOW_MATERIAL: MacosWindowMaterial = 'transparent'
export const DEFAULT_WINDOWS_WINDOW_MATERIAL: WindowsWindowMaterial = 'off'
export const WINDOWS_MICA_MIN_BUILD = 22_621

/** Extract the NT build number from a Windows `os.release()` value. */
export function windowsBuildNumber(value: string = osRelease()): number | undefined {
  const match = /^(?:\d+\.){2}(\d+)(?:\.|$)/.exec(value)
  if (match === null) return undefined
  const build = Number(match[1])
  return Number.isSafeInteger(build) ? build : undefined
}

export function windowsSupportsSystemBackdrop(build: number | undefined): boolean {
  return build !== undefined && build >= WINDOWS_MICA_MIN_BUILD
}

export function windowsSupportsMica(build: number | undefined): boolean {
  return windowsSupportsSystemBackdrop(build)
}

export function parseMacosWindowMaterial(value: unknown): MacosWindowMaterial {
  if (value === undefined) return DEFAULT_MACOS_WINDOW_MATERIAL
  if (value === 'off' || value === 'transparent') return value
  throw new Error('dsh-desktop.macosMaterial must be "off" or "transparent"')
}

export function parseWindowsWindowMaterial(value: unknown): WindowsWindowMaterial {
  if (value === undefined) return DEFAULT_WINDOWS_WINDOW_MATERIAL
  if (value === 'off' || value === 'mica') return value
  // Acrylic was removed because both Windows implementations can break native
  // window behavior. Keep the legacy value readable and fail closed to an
  // ordinary opaque window until the durable settings migration can run.
  if (value === 'acrylic') return 'off'
  throw new Error('dsh-desktop.windowsMaterial must be "off" or "mica"')
}

/** Resolve the actual generation material without making settings non-portable. */
export function effectiveDesktopWindowMaterial(
  mode: DesktopShellMode,
  platform: DesktopPlatform,
  macosMaterial: MacosWindowMaterial,
  windowsMaterial: PersistedWindowsWindowMaterial,
  windowsBuild: number | undefined,
): DesktopWindowMaterial {
  // Material now applies to every non-Linux presentation. Keep mode in the
  // resolver signature so callers cannot accidentally bypass shell context.
  void mode
  if (platform === 'linux') return 'off'
  if (platform === 'darwin') return macosMaterial
  if (windowsMaterial === 'acrylic') return 'off'
  if (windowsMaterial === 'mica' && !windowsSupportsSystemBackdrop(windowsBuild)) return 'off'
  return windowsMaterial
}
