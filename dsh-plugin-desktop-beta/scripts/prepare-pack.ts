/** Electron Builder's beforePack hook: the Office package closure joins the archive unpack patterns. */
import { join } from 'node:path'
import { nextPackagingTarget, PAYLOAD_DIR } from './packaged-payload.ts'
import { officeUnpackPatterns } from './office-packages.ts'
import { applyWindowsUnpack } from './windows-asar-unpack.ts'
import { packagingStepSync } from './packaging-step.ts'

interface PackContext {
  electronPlatformName: string
  packager: { projectDir: string; info: { appDir: string }; config: { asarUnpack?: unknown } }
}

/**
 * Unpack the Office package closure of every CPU the package carries. The bundled standalone Node
 * runs the LibreOffice Kit CLI and its JavaScript dependencies from physical files, so the closure
 * resolved from the prepared payload joins `asarUnpack`; each pattern is added once. The patterns
 * start with `**`, so they match below the prepared directory electron-builder archives.
 * @param config - electron-builder configuration being packed.
 * @param payloadRoot - Prepared payload directory.
 * @param platform - Electron platform being packaged.
 * @returns The patterns this call added.
 */
export function applyOfficeUnpack(config: { asarUnpack?: unknown }, payloadRoot: string, platform: NodeJS.Platform): string[] {
  const existing = config.asarUnpack
  const patterns = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string') : []
  const added = officeUnpackPatterns(payloadRoot, platform, nextPackagingTarget(platform).archs).filter(pattern => !patterns.includes(pattern))
  config.asarUnpack = [...patterns, ...added]
  return added
}

export default async function beforePack(context: PackContext): Promise<void> {
  const platform = context.electronPlatformName as NodeJS.Platform
  const office = applyOfficeUnpack(context.packager.config, join(context.packager.projectDir, ...PAYLOAD_DIR.split('/')), platform)
  if (office.length > 0) console.log(`Next ${context.electronPlatformName} payload unpacks the Office closure: ${String(office.length)} packages`)
  if (platform === 'win32') {
    const files = packagingStepSync('builder:prepare-pe-unpack', () => applyWindowsUnpack(context.packager.config,
      context.packager.info.appDir, join(context.packager.projectDir, ...PAYLOAD_DIR.split('/'))))
    console.log(`Next Windows payload unpacks ${String(files.length)} discovered PE files`)
  }
  await Promise.resolve()
}
