/** Reuse the signed DMG verifier with Next's application identity, once for every package a release or smoke builds. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { verifyMacRelease } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { macDmgArch, macPackageCpus, macReleaseArchs, nextMacNativeEntries, type MacPackageArch } from './mac-runtime.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyNextMacRuntime } from './verify-mac-runtime.ts'

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

export function verifyNextMac(signed: boolean): void {
  const desktopRoot = resolve(import.meta.dirname, '..')
  const distDir = resolve(process.argv[2] ?? `dist/${signed ? 'mac-release' : 'mac-smoke'}`)
  const dmgs = readdirSync(distDir).filter(name => name.endsWith('.dmg')).map(name => join(distDir, name)).filter(path => statSync(path).isFile())
  for (const [arch, dmg] of expectedMacDmgs(dmgs, signed ? macReleaseArchs(process.env) : [macSmokeArchitecture(process.env)])) {
    const cpus = macPackageCpus(arch)
    const slices: string[] = cpus.map(cpu => cpu === 'x64' ? 'x86_64' : 'arm64')
    verifyMacRelease({ distDir, productName: 'DSH NEXT', nativeEntries: nextMacNativeEntries(desktopRoot, cpus),
      // Next archives its application; native files live beside the archive.
      unpackedRoot: appPath => join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'),
      listDmgs: () => [dmg],
      makeMountPoint: () => mkdtempSync(join(tmpdir(), 'dsh-next-release-')), removeMountPoint: path => rmdirSync(path),
      // The package's own CPUs and nothing else: executable slices, archived payload, interpreter payloads; the host's CPU
      // executed; release signatures checked.
      verifyRuntime: appPath => verifyNextMacRuntime(appPath, signed, cpus),
      run: (command, args) => {
        if (!signed && ['codesign', 'spctl', 'xcrun'].includes(command)) return
        // The shared verifier asks for both slices of the main executable; verifyRuntime requires the package's exact set.
        if (command === 'lipo' && args[1] === '-verify_arch' && args[0]?.includes('/Contents/MacOS/') && !slices.includes(args[2]!)) return
        const result = spawnSync(command, args, { stdio: 'inherit' })
        if (result.error || result.status !== 0) throw result.error ?? new Error(`Artifact verification failed: ${command}`)
        if (signed && command === 'codesign' && args.includes('--verify')) verifyNextMacEntitlements(args.at(-1)!)
      } })
    console.log(`Verified the ${arch} macOS ${signed ? 'release' : 'smoke'} ${basename(dmg)}`)
  }
}
if (process.argv[1]?.endsWith('/verify-mac-release.ts')) verifyNextMac(true)
