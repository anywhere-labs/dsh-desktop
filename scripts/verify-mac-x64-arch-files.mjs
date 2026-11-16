/**
 * Check a single-CPU macOS smoke application against the universal merge's x64ArchFiles rule.
 *
 * A universal build packages the same payload into an x64 and an arm64 application, then merges them.
 * @electron/universal joins Mach-O files that differ between the two with lipo, and rejects a thin Mach-O
 * file that is identical in both unless `build.mac.x64ArchFiles` matches it. Everything below
 * Contents/Resources comes from that shared payload, so every thin Mach-O file there must match the rule.
 * Pull requests package one CPU and never run the merge; this check finds the same omissions in seconds.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIN_MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe])
const FAT_MACH_O = new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca])

function machOKind(path) {
  if (statSync(path).size < 4) return undefined
  const descriptor = openSync(path, 'r')
  try {
    const head = Buffer.alloc(4)
    readSync(descriptor, head, 0, 4, 0)
    const magic = head.readUInt32BE(0)
    if (THIN_MACH_O.has(magic)) return 'thin'
    if (FAT_MACH_O.has(magic)) return 'fat'
    return undefined
  } finally {
    closeSync(descriptor)
  }
}

/**
 * List the thin Mach-O files below an application's Contents/Resources that the rule does not match.
 * The archive itself is skipped: the merge compares app.asar as a whole, never the files inside it.
 * @param {string} appPath - The packaged `.app` directory.
 * @param {string} rule - The `build.mac.x64ArchFiles` minimatch pattern.
 * @param {(path: string, pattern: string, options: object) => boolean} minimatch - The matcher the merge uses.
 * @returns {{ thin: number, uncovered: string[] }} Thin Mach-O count and the uncovered app-relative paths.
 */
export function uncoveredThinMachO(appPath, rule, minimatch) {
  const uncovered = []
  let thin = 0
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.isFile() && entry.name !== 'app.asar' && machOKind(path) === 'thin') {
        thin += 1
        const relativePath = relative(appPath, path).split(sep).join('/')
        // @electron/universal matches with these options against the app-relative path.
        if (!minimatch(relativePath, rule, { matchBase: true })) uncovered.push(relativePath)
      }
    }
  }
  walk(join(appPath, 'Contents', 'Resources'))
  return { thin, uncovered: uncovered.sort() }
}

/**
 * Resolve the rule and the matcher the package's universal merge would use.
 * @param {string} packageRoot - Desktop package whose electron-builder configuration applies.
 * @returns {{ rule: string, minimatch: Function }} The rule and @electron/universal's own minimatch.
 */
export function universalMergeRule(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const rule = manifest.build?.mac?.x64ArchFiles
  if (typeof rule !== 'string' || rule === '') throw new Error(`${packageRoot}/package.json declares no build.mac.x64ArchFiles`)
  const universal = createRequire(join(packageRoot, 'package.json')).resolve('@electron/universal/package.json')
  const { minimatch } = createRequire(universal)('minimatch')
  return { rule, minimatch }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [packageArg, appArg] = process.argv.slice(2)
  if (packageArg === undefined || appArg === undefined) throw new Error('usage: verify-mac-x64-arch-files.mjs <package dir> <app path>')
  const { rule, minimatch } = universalMergeRule(resolve(packageArg))
  const { thin, uncovered } = uncoveredThinMachO(resolve(appArg), rule, minimatch)
  if (thin === 0) throw new Error(`verify-mac-x64-arch-files: found no thin Mach-O file below ${appArg}/Contents/Resources`)
  if (uncovered.length > 0) {
    throw new Error(`verify-mac-x64-arch-files: ${String(uncovered.length)} thin Mach-O file(s) would fail the universal merge. `
      + 'Add patterns for them to build.mac.x64ArchFiles in the Next and Beta package.json:\n'
      + uncovered.map(path => `- ${path}`).join('\n'))
  }
  process.stdout.write(`verify-mac-x64-arch-files: x64ArchFiles covers all ${String(thin)} thin Mach-O files the universal merge would compare\n`)
}
