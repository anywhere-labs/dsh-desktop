/** Reuse the signed DMG verifier with Next's application identity, once for every package a release or smoke builds. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { verifyMacRelease, type MacReleaseVerificationOptions } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { macDmgArch, macPackageCpus, macReleaseArchs, nextMacNativeEntries, type MacPackageArch } from './mac-runtime.ts'
import { macApplicationDirectory, macSmokeTarget } from './package-targets.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyNextMacRuntime } from './verify-mac-runtime.ts'

function execute(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Artifact verification failed: ${command}`)
}

/**
 * Pair the DMGs of a distribution directory with the packages their names declare.
 * @param dmgs - DMG paths found in the directory.
 * @param expected - Packages the build was asked for.
 * @returns One package and DMG per expected package.
 * @throws When a DMG names no package, or the DMGs are not exactly the expected packages.
 */
export function expectedMacDmgs(dmgs: readonly string[], expected: readonly MacPackageArch[]): [MacPackageArch, string][] {
  const found = dmgs.map(dmg => [macDmgArch(dmg), dmg] as const)
  const unnamed = found.filter(([arch]) => arch === undefined).map(([, dmg]) => basename(dmg))
  if (unnamed.length > 0) throw new Error(`macOS DMGs must end in -arm64, -x64 or -universal: ${unnamed.join(', ')}`)
  const archs = found.map(([arch]) => arch!).sort()
  if (archs.join(',') !== [...expected].sort().join(',')) {
    throw new Error(`Expected one macOS DMG each for ${expected.join(', ')}; found ${archs.join(', ') || 'none'}`)
  }
  return found as [MacPackageArch, string][]
}

/**
 * Checks of one of Next's packaged macOS applications, for the package's own CPUs and nothing else. A smoke that
 * packaged only the application directory has no image to mount: the directory electron-builder wrote stands in for
 * the mount point, and the same application checks run in place.
 * @param signed - Whether a signed release is verified; smokes skip the signature and notarization checks.
 * @param distDir - Output directory of the build.
 * @param env - Environment selecting the smoke architecture and target; `DSH_MAC_SKIP_NOTARIZATION=1` marks a drill
 * build signed without notarization, whose Gatekeeper and stapler checks are left out.
 * @param run - Executes one verification command.
 * @param dmg - The package and DMG to check; without one, the `DSH_MAC_SMOKE_ARCH` package and every DMG in the directory.
 * @returns Options for the shared release verifier.
 */
export function nextMacVerification(signed: boolean, distDir: string, env: NodeJS.ProcessEnv = process.env,
  run: (command: string, args: readonly string[]) => void = execute, dmg?: { arch: MacPackageArch; path: string }): MacReleaseVerificationOptions {
  const arch = dmg?.arch ?? macSmokeArchitecture(env)
  const cpus = macPackageCpus(arch)
  const slices: string[] = cpus.map(cpu => cpu === 'x64' ? 'x86_64' : 'arm64')
  const inPlace = !signed && dmg === undefined && macSmokeTarget(env) === 'dir' ? join(distDir, macApplicationDirectory(arch)) : undefined
  const notarized = signed && env.DSH_MAC_SKIP_NOTARIZATION !== '1'
  return { distDir, productName: 'DSH NEXT', nativeEntries: nextMacNativeEntries(cpus),
    // Next archives its application; native files live beside the archive.
    unpackedRoot: appPath => join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'),
    listDmgs: inPlace !== undefined ? () => [inPlace]
      : dmg !== undefined ? () => [dmg.path]
      : path => readdirSync(path).filter(name => name.endsWith('.dmg')).map(name => join(path, name)).filter(path => statSync(path).isFile()),
    makeMountPoint: inPlace !== undefined ? () => inPlace : () => mkdtempSync(join(tmpdir(), 'dsh-next-release-')),
    removeMountPoint: inPlace !== undefined ? () => undefined : path => rmdirSync(path),
    // The package's own CPUs and nothing else: executable slices, archived payload, interpreter payloads; the host's CPU
    // executed; release signatures checked.
    verifyRuntime: appPath => verifyNextMacRuntime(appPath, signed, cpus),
    run: (command, args) => {
      if (inPlace !== undefined && command === 'hdiutil') return
      if (!signed && ['codesign', 'spctl', 'xcrun'].includes(command)) return
      // A drill build signed without notarization carries no ticket for Gatekeeper or the stapler to accept.
      if (signed && !notarized && ['spctl', 'xcrun'].includes(command)) return
      // The shared verifier asks for both slices of the main executable; verifyRuntime requires the package's exact set.
      if (command === 'lipo' && args[1] === '-verify_arch' && args[0]?.includes('/Contents/MacOS/') && !slices.includes(args[2]!)) return
      run(command, args)
      if (signed && command === 'codesign' && args.includes('--verify')) verifyNextMacEntitlements(args.at(-1)!, undefined, slices)
    } }
}

export function verifyNextMac(signed: boolean): void {
  const distDir = resolve(process.argv[2] ?? `dist/${signed ? 'mac-release' : 'mac-smoke'}`)
  // A smoke that packaged only the application directory has no DMG to pair with its package.
  if (!signed && macSmokeTarget(process.env) === 'dir') {
    verifyMacRelease(nextMacVerification(signed, distDir))
    return
  }
  const dmgs = readdirSync(distDir).filter(name => name.endsWith('.dmg')).map(name => join(distDir, name)).filter(path => statSync(path).isFile())
  for (const [arch, path] of expectedMacDmgs(dmgs, signed ? macReleaseArchs(process.env) : [macSmokeArchitecture(process.env)])) {
    verifyMacRelease(nextMacVerification(signed, distDir, process.env, execute, { arch, path }))
    console.log(`Verified the ${arch} macOS ${signed ? 'release' : 'smoke'} ${basename(path)}`)
  }
}
if (process.argv[1]?.endsWith('/verify-mac-release.ts')) verifyNextMac(true)
