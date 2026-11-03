/** Reuse the signed universal DMG verifier with Next's application identity. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { macSmokeArchitecture, macSmokeExecutableSlices, type MacUniversalArch } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { verifyMacRelease, type MacReleaseVerificationOptions } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { NEXT_MAC_NATIVE_ENTRIES } from './mac-runtime.ts'
import { macApplicationDirectory, macSmokeTarget } from './package-targets.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyNextMacRuntime } from './verify-mac-runtime.ts'

function execute(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Artifact verification failed: ${command}`)
}

/**
 * Checks of Next's packaged macOS application. A smoke that packaged only the application directory has
 * no image to mount: the directory electron-builder wrote stands in for the mount point, and the same
 * application checks run in place.
 * @param signed - Whether a signed release is verified; smokes skip the signature and notarization checks.
 * @param distDir - Output directory of the build.
 * @param env - Environment selecting the smoke architecture and target.
 * @param run - Executes one verification command.
 * @returns Options for the shared release verifier.
 */
export function nextMacVerification(signed: boolean, distDir: string, env: NodeJS.ProcessEnv = process.env,
  run: (command: string, args: readonly string[]) => void = execute): MacReleaseVerificationOptions {
  const architecture = signed ? undefined : macSmokeArchitecture(env)
  const smokeSlices = architecture === undefined ? undefined : macSmokeExecutableSlices(architecture)
  const inPlace = architecture !== undefined && macSmokeTarget(env) === 'dir' ? join(distDir, macApplicationDirectory(architecture)) : undefined
  return { distDir, productName: 'DSH NEXT', nativeEntries: NEXT_MAC_NATIVE_ENTRIES,
    // Next archives its application; native files live beside the archive.
    unpackedRoot: appPath => join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'),
    listDmgs: inPlace !== undefined ? () => [inPlace] : path => readdirSync(path).filter(name => name.endsWith('.dmg')).map(name => join(path, name)).filter(path => statSync(path).isFile()),
    makeMountPoint: inPlace !== undefined ? () => inPlace : () => mkdtempSync(join(tmpdir(), 'dsh-next-release-')),
    removeMountPoint: inPlace !== undefined ? () => undefined : path => rmdirSync(path),
    // The interpreter payloads beside the archive: both CPUs present, the host's CPU executed, release signatures checked.
    verifyRuntime: appPath => verifyNextMacRuntime(appPath, signed),
    run: (command, args) => {
      if (inPlace !== undefined && command === 'hdiutil') return
      if (!signed && ['codesign', 'spctl', 'xcrun'].includes(command)) return
      if (smokeSlices !== undefined && command === 'lipo' && args[1] === '-verify_arch' && args[0]?.includes('/Contents/MacOS/') && !smokeSlices.includes(args[2] as MacUniversalArch)) return
      run(command, args)
      if (signed && command === 'codesign' && args.includes('--verify')) verifyNextMacEntitlements(args.at(-1)!)
    } }
}

export function verifyNextMac(signed: boolean): void {
  verifyMacRelease(nextMacVerification(signed, resolve(process.argv[2] ?? `dist/${signed ? 'mac-release' : 'mac-smoke'}`)))
}
if (process.argv[1]?.endsWith('/verify-mac-release.ts')) verifyNextMac(true)
