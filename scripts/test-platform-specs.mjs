/**
 * Run the Beta specs whose cases execute only on this platform.
 *
 * The unit suites run on Linux, so a case gated to Windows or macOS never runs there. The packaging
 * jobs already install Beta on those platforms and run the specs listed here. Next mirrors Beta's
 * specs. `platformGatedSpecs` finds such gates, and its test fails when a spec gains one without
 * appearing in the list, so a platform-only case cannot silently stop running anywhere.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vitestEntry } from './vitest-entry.mjs'

export const betaRoot = resolve(import.meta.dirname, '..', 'dsh-plugin-desktop-beta')

/** Beta specs, relative to the package, that the Windows and macOS packaging jobs run. */
export const PLATFORM_SPECS = {
  win32: ['tests/windows-elevation.spec.ts', 'tests/workspace-file-drive-path.spec.ts'],
  darwin: ['tests/office-packages.spec.ts', 'tests/shell-environment.spec.ts', 'tests/shell-locale.spec.ts'],
}

/**
 * Listed specs whose cases depend on an installed program rather than on the platform. The real
 * login-shell cases run with every shell the machine has: the Linux check installs zsh and fish,
 * and macOS adds its own zsh and bash.
 */
export const PROGRAM_GATED_SPECS = {
  win32: [],
  darwin: ['tests/shell-environment.spec.ts'],
}

const PLATFORMS = ['win32', 'darwin']
const ALIAS = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*process\.platform\s*===\s*'(win32|darwin)'/gu
const DIRECT_GATE = /(?:\.runIf\(\s*process\.platform\s*===|(?:\.skipIf\(|\bskip:)\s*process\.platform\s*!==)\s*'(win32|darwin)'\s*[),}]/gu

/**
 * Find the specs that gate cases to Windows or macOS: `runIf` on the platform, or `skipIf` or the
 * `{ skip }` test option on any other, written directly or through a `const name = process.platform === '…'`
 * alias.
 * @param {ReadonlyMap<string, string>} sources - Spec source by package-relative POSIX path.
 * @returns {Record<'win32' | 'darwin', string[]>} Sorted spec paths per platform.
 */
export function platformGatedSpecs(sources) {
  const result = Object.fromEntries(PLATFORMS.map(platform => [platform, new Set()]))
  for (const [path, text] of sources) {
    for (const match of text.matchAll(DIRECT_GATE)) result[match[1]].add(path)
    for (const [, name, platform] of text.matchAll(ALIAS)) {
      const alias = name.replace(/\$/gu, '\\$')
      const gate = new RegExp(`(?:\\.runIf\\(\\s*${alias}|(?:\\.skipIf\\(|\\bskip:)\\s*!\\s*${alias})\\s*[),}]`, 'u')
      if (gate.test(text)) result[platform].add(path)
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
    process.stdout.write(`test-platform-specs: running the ${String(specs.length)} Beta specs listed for ${process.platform}\n`)
    const result = spawnSync(process.execPath, [vitestEntry(betaRoot), 'run', ...process.argv.slice(2), ...specs], { cwd: betaRoot, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
}
