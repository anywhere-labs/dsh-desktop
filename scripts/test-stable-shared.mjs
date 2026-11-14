/**
 * Run the Stable specs that test only modules Next and Beta ship.
 *
 * Stable is frozen and CI no longer runs its suite, yet Next and Beta production code still imports
 * many Stable modules. A Stable spec whose own imports of Stable code all lie in that closure tests
 * shipped code only, so the root check runs it. Specs that also exercise Stable-only modules stay out
 * with the rest of the frozen suite.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vitestEntry } from './vitest-entry.mjs'

const root = resolve(import.meta.dirname, '..')
const STABLE = 'dsh-plugin-desktop'
const VARIANTS = ['dsh-desktop-next', 'dsh-plugin-desktop-beta']
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/gu
const MODULE = /\.(?:[cm]?[jt]sx?)$/u
const SPEC = /\.spec\.tsx?$/u
const RESOLVED_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts']
// Builds its archive fixtures from Stable's own build output, which CI never produces. Next and Beta reach
// the module under test only through an import of verify-electron-fuses.ts, whose spec runs, and verify
// their packaged archive with their own scripts.
const NEEDS_STABLE_BUILD = new Set(['tests/verify-packaged-runtime.spec.ts'])

function resolveImport(from, specifier, files) {
  if (!specifier.startsWith('.')) return undefined
  const base = posix.normalize(posix.join(posix.dirname(from), specifier))
  return RESOLVED_SUFFIXES.map(suffix => `${base}${suffix}`).find(candidate => files.has(candidate))
}

/**
 * Select the Stable specs whose imports of Stable code all lie in the closure Next and Beta reach.
 * @param {ReadonlyMap<string, string>} sources - Source text by repository-relative POSIX path.
 * @returns {string[]} Sorted spec paths relative to the Stable package.
 */
export function stableSharedSpecs(sources) {
  const files = new Set(sources.keys())
  const importsOf = path => [...(sources.get(path) ?? '').matchAll(IMPORT_SPECIFIER)]
    .map(match => resolveImport(path, match[1], files)).filter(Boolean)
  const isStableCode = path => path.startsWith(`${STABLE}/`) && !path.startsWith(`${STABLE}/tests/`)
  const shared = new Set()
  const pending = [...files]
    .filter(path => VARIANTS.some(variant => path.startsWith(`${variant}/src/`) || path.startsWith(`${variant}/scripts/`)))
    .flatMap(path => importsOf(path).filter(isStableCode))
  while (pending.length > 0) {
    const path = pending.pop()
    if (shared.has(path)) continue
    shared.add(path)
    pending.push(...importsOf(path).filter(isStableCode))
  }
  return [...files]
    .filter(path => path.startsWith(`${STABLE}/tests/`) && SPEC.test(path))
    .filter(spec => {
      const stableImports = importsOf(spec).filter(isStableCode)
      return stableImports.length > 0 && stableImports.every(path => shared.has(path))
    })
    .map(spec => spec.slice(STABLE.length + 1))
    .sort()
}

/**
 * Read every tracked module of Stable, Next and Beta.
 * @returns {Map<string, string>} Source text by repository-relative POSIX path.
 */
export function trackedDesktopSources() {
  const paths = execFileSync('git', ['ls-files', '-z', '--', STABLE, ...VARIANTS], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => MODULE.test(path))
  return new Map(paths.map(path => [path, readFileSync(join(root, path), 'utf8')]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const specs = stableSharedSpecs(trackedDesktopSources()).filter(spec => !NEEDS_STABLE_BUILD.has(spec))
  // Next and Beta import dozens of Stable modules, so an empty selection means the analysis broke.
  if (specs.length === 0) throw new Error('test-stable-shared: found no Stable spec of a module Next or Beta ships')
  process.stdout.write(`test-stable-shared: running ${String(specs.length)} Stable specs that import only modules Next and Beta ship\n`)
  const stableRoot = join(root, STABLE)
  const result = spawnSync(process.execPath, [vitestEntry(stableRoot), 'run', ...process.argv.slice(2), ...specs], { cwd: stableRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
