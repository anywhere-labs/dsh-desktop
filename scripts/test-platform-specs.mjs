/**
 * Run the Beta specs whose cases execute only on this platform.
 *
 * The unit suites run on Linux, so a case gated with `runIf` to Windows or macOS never runs there. The
 * packaging jobs already install Beta on those platforms and run the specs listed here. Next mirrors
 * Beta's specs. `platformGatedSpecs` finds such gates, and its test fails when a spec gains one without
 * appearing in the list, so a platform-only case cannot silently stop running anywhere.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vitestEntry } from './vitest-entry.mjs'

export const betaRoot = resolve(import.meta.dirname, '..', 'dsh-plugin-desktop-beta')

/** Beta specs, relative to the package, that hold cases only Windows or only macOS runs. */
export const PLATFORM_SPECS = {
  win32: ['tests/windows-elevation.spec.ts', 'tests/workspace-file-drive-path.spec.ts'],
  darwin: ['tests/office-packages.spec.ts'],
}

const PLATFORMS = ['win32', 'darwin']
const ALIAS = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*process\.platform\s*===\s*'(win32|darwin)'/gu
const DIRECT_GATE = /\.runIf\(\s*process\.platform\s*===\s*'(win32|darwin)'\s*\)|\.skipIf\(\s*process\.platform\s*!==\s*'(win32|darwin)'\s*\)/gu

/**
 * Find the specs that gate cases to Windows or macOS with `runIf`, directly or through a
 * `const name = process.platform === '…'` alias, or with `skipIf(process.platform !== '…')`.
 * @param {ReadonlyMap<string, string>} sources - Spec source by package-relative POSIX path.
 * @returns {Record<'win32' | 'darwin', string[]>} Sorted spec paths per platform.
 */
export function platformGatedSpecs(sources) {
  const result = Object.fromEntries(PLATFORMS.map(platform => [platform, new Set()]))
  for (const [path, text] of sources) {
    for (const match of text.matchAll(DIRECT_GATE)) result[match[1] ?? match[2]].add(path)
    for (const [, name, platform] of text.matchAll(ALIAS)) {
      if (new RegExp(`\\.runIf\\(\\s*${name.replace(/\$/gu, '\\$')}\\s*\\)`, 'u').test(text)) result[platform].add(path)
    }
  }
  return Object.fromEntries(PLATFORMS.map(platform => [platform, [...result[platform]].sort()]))
}

/**
 * Read every Beta spec.
 * @returns {Map<string, string>} Spec source by package-relative POSIX path.
 */
export function betaSpecSources() {
  const sources = new Map()
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.spec\.tsx?$/u.test(entry.name)) sources.set(relative(betaRoot, path).split(sep).join('/'), readFileSync(path, 'utf8'))
    }
  }
  walk(join(betaRoot, 'tests'))
  return sources
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const specs = PLATFORM_SPECS[process.platform] ?? []
  if (specs.length === 0) {
    process.stdout.write(`test-platform-specs: no Beta spec runs only on ${process.platform}\n`)
  } else {
    process.stdout.write(`test-platform-specs: running the ${String(specs.length)} Beta specs that hold ${process.platform}-only cases\n`)
    const result = spawnSync(process.execPath, [vitestEntry(betaRoot), 'run', ...process.argv.slice(2), ...specs], { cwd: betaRoot, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
}
