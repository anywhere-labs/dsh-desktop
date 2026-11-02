/** Cross-check the assembled `app.asar` payload against the prepared tree before signing, without a GUI. */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { archivedPayload, auditNextPayload, PAYLOAD_DIR, preparedPackagingTarget, verifyArchiveAgainstPrepared, verifyNextPayload, verifyUpdaterManifestShim } from './packaged-payload.ts'
import { expectedNextVersion, verifyPackagedNextRuntime } from './prepare-runtime.ts'
import { DESKTOP_RUNTIME_FILE } from '../src/runtime-tree.ts'
import { packagingStepSync } from './packaging-step.ts'
import { verifyWindowsCodeUnpacked } from './windows-asar-unpack.ts'

/** Resources directories already cross-checked by afterPack in the current packaging process. */
export const verifiedPackagedResources = new Set<string>()

interface PackContext {
  appOutDir: string
  /** electron-builder's `Arch`. */
  arch: number
  electronPlatformName: string
  packager: { projectDir: string; appInfo: { version: string } }
}

/** Names of electron-builder's `Arch` values that macOS packages use. */
const BUILDER_ARCHS: Readonly<Record<number, string>> = { 1: 'x64', 3: 'arm64', 4: 'universal' }

/**
 * Electron Builder's afterPack hook. The archive and its unpacked files are one copy of the
 * installation; the prepared tree with its sealed descriptor is another. The archive must be
 * complete and resolvable, carry nothing the Desktop file policy omits, keep native and
 * shell-executed files unpacked, embed the prepared descriptor byte for byte, and match its
 * inventory exactly; the interpreter payloads copied as extra resources must be those of the
 * payload's CPUs and no other, declaring this platform, their CPU and the product version; a
 * payload prepared for one macOS CPU must be packaged as the application for that CPU; macOS must
 * carry the manifest copy that the updaters of earlier releases read beside the archive, and
 * nothing else there. Universal macOS builds run this once per CPU and once more on the merged
 * application; all three archives come from the same prepared tree, and the merge may only have
 * re-serialized nested `Info.plist` files.
 * @param context - Electron Builder's afterPack context.
 */
export default async function afterPack(context: PackContext): Promise<void> {
  const resources = context.electronPlatformName === 'darwin' ? join(context.appOutDir, 'DSH Desktop Beta.app/Contents/Resources') : join(context.appOutDir, 'resources')
  if (!existsSync(join(resources, 'app.asar'))) throw new Error('Next must package its application into app.asar like upstream Desktop')
  if (context.electronPlatformName === 'darwin' && /-(?:x64|arm64)-temp$/u.test(context.appOutDir)) {
    // electron-builder's universal packager immediately merges the two temporary per-CPU bundles
    // into mac-universal, deletes both staging directories, and invokes afterPack on the merged app.
    return
  }
  const platform = context.electronPlatformName as NodeJS.Platform
  const target = preparedPackagingTarget(context.packager.projectDir)
  if (target.platform !== platform) throw new Error(`Next payload was prepared for ${target.platform}, not for the ${platform} package being built`)
  // A directory build packages the universal payload into an application for the build host's CPU.
  if (platform === 'darwin' && target.archs.length === 1 && BUILDER_ARCHS[context.arch] !== target.archs[0]) {
    throw new Error(`Next payload was prepared for ${target.archs[0]!}, but electron-builder packaged ${BUILDER_ARCHS[context.arch] ?? `architecture ${String(context.arch)}`}`)
  }
  const source = packagingStepSync('archive:open', () => archivedPayload(resources))
  try {
    packagingStepSync('archive:verify-updater-shim', () => verifyUpdaterManifestShim(resources, source, platform, context.packager.appInfo.version))
    packagingStepSync('archive:verify-dependencies', () => verifyNextPayload(source))
    const problems = packagingStepSync('archive:audit', () => auditNextPayload(source, target))
    if (problems.length > 0) throw new Error(`Next payload audit failed:\n${problems.join('\n')}`)
    const prepared = join(context.packager.projectDir, ...PAYLOAD_DIR.split('/'), DESKTOP_RUNTIME_FILE)
    const { descriptor, rewrittenPlists } = packagingStepSync('archive:verify-bytes', () => verifyArchiveAgainstPrepared(source, prepared, context.packager.appInfo.version, target))
    if (platform === 'win32') packagingStepSync('archive:verify-pe-unpack', () => verifyWindowsCodeUnpacked(source, join(context.packager.projectDir, ...PAYLOAD_DIR.split('/'))))
    const unpacked = source.list().filter(entry => entry.unpacked).length
    const { release } = descriptor
    console.log(`Verified the archive against the prepared Next payload: ${String(descriptor.files.length)} files (${String(unpacked)} unpacked) for ${descriptor.platform} ${descriptor.archs.join('/')}; `
      + `DSH Desktop Beta ${release.version}, dsh ${release.dshVersion}, Electron ${release.electronVersion}, pnpm ${release.pnpmVersion}`
      + (rewrittenPlists.length === 0 ? '' : `; the universal merge rewrote ${rewrittenPlists.join(', ')}`))
  } finally { source.close() }
  const runtimes = packagingStepSync('runtime:verify-packaged', () => verifyPackagedNextRuntime(join(resources, 'runtime'), platform, expectedNextVersion(context.packager.projectDir), target.archs))
  for (const runtime of runtimes) console.log(`Verified the ${runtime.arch} primary runtime: Python ${runtime.manifest.python}, Node ${runtime.manifest.node}, pnpm ${runtime.manifest.pnpm}`)
  verifiedPackagedResources.add(resolve(resources))
  await Promise.resolve()
}
