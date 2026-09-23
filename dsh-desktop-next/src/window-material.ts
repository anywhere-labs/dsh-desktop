/** Match the existing Desktop's supported native backdrops. Acrylic remains disabled. */
import { release } from 'node:os'
import type { DesktopPreferences } from './desktop-contract.ts'
export function supportsMica(osRelease = release()): boolean {
  const build = /^(?:\d+\.){2}(\d+)(?:\.|$)/u.exec(osRelease)?.[1]
  return build !== undefined && Number(build) >= 22621
}
export function windowMaterial(preferences: DesktopPreferences, platform = process.platform): 'off' | 'transparent' | 'mica' {
  if (platform === 'darwin') return preferences.macosMaterial
  if (platform === 'win32' && preferences.windowsMaterial === 'mica' && supportsMica()) return 'mica'
  return 'off'
}
