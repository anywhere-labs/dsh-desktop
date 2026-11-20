/**
 * Overlap Windows first-open scans after an install rewrote packages. Each newly written file blocks its first
 * open while it is scanned (about 12 ms measured), and the Host opens about 4,000 files one after another, so the
 * first development launch after a dependency change waited 47-58 s for a Host that otherwise starts in about 6 s.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, type Dirent } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Files a Host start can open: modules, manifests, native addons and WebAssembly. */
const WARMED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node', '.wasm'])

/** Concurrent first opens. The scans overlap: 32 openers warmed cold files about 12 times faster than one. */
export const WARMUP_CONCURRENCY = 32

/**
 * Without a record, only packages written this long before Yarn saved its state count as the last install's.
 * Older files are as warm as earlier launches left them, and opening every file of a tree once cost about 30 s.
 */
export const FIRST_WARMUP_WINDOW_MS = 15 * 60_000

/** One installed package and the latest change of its manifest. */
export interface InstalledPackage {
  readonly dir: string
  readonly changed: number
}

/**
 * Yarn's install state for the project that contains a package: the nearest `node_modules/.yarn-state.yml`.
 * @param packageRoot - Desktop package directory.
 * @returns The state file, or undefined outside a Yarn node-modules project.
 */
export function yarnInstallState(packageRoot: string): string | undefined {
  for (let current = resolve(packageRoot); ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', '.yarn-state.yml')
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
    if (dirname(current) === current) return undefined
  }
}

/**
 * Where a package records the install state its last warm-up covered.
 * @param packageRoot - Desktop package directory.
 * @returns The record under the build-owned directory.
 */
export function warmupRecordPath(packageRoot: string): string {
  return join(packageRoot, '.desktop-build', 'dev-warmup.json')
}

function recordedInstallState(packageRoot: string): number | undefined {
  try {
    const value = (JSON.parse(readFileSync(warmupRecordPath(packageRoot), 'utf8')) as { installState?: unknown }).installState
    return typeof value === 'number' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a launch should warm packages: on Windows, after Yarn's install state changed since the last warm-up.
 * Costs two stats and one small read when nothing was installed.
 * @param packageRoot - Desktop package directory.
 * @param platform - Platform of the launch.
 * @returns Whether rewritten packages may still be cold.
 */
export function warmupNeeded(packageRoot: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false
  const state = yarnInstallState(packageRoot)
  return state !== undefined && statSync(state).mtimeMs !== recordedInstallState(packageRoot)
}

/**
 * Installed packages of a node_modules tree, scoped and nested. Links are not followed: a linked workspace is
 * not an installed copy.
 * @param modules - node_modules directory.
 * @returns Each package with the later of its manifest's modification and change times.
 */
export function installedPackages(modules: string): InstalledPackage[] {
  const packages: InstalledPackage[] = []
  const visit = (directory: string): void => {
    let entries: Dirent[]
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(directory, entry.name)
      if (entry.name.startsWith('@')) { visit(dir); continue }
      const manifest = statSync(join(dir, 'package.json'), { throwIfNoEntry: false })
      if (manifest === undefined) continue
      packages.push({ dir, changed: Math.max(manifest.mtimeMs, manifest.ctimeMs) })
      visit(join(dir, 'node_modules'))
    }
  }
  visit(modules)
  return packages
}

/**
 * Files of one package a Host start can open. Its nested node_modules hold packages of their own.
 * @param dir - Package directory.
 * @returns Absolute file paths.
 */
export function packageFiles(dir: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    let entries: Dirent[]
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(path)
      } else if (entry.isFile() && WARMED_EXTENSIONS.has(extname(entry.name))) files.push(path)
    }
  }
  visit(dir)
  return files
}

/**
 * Open and close files with bounded concurrency. Opening is what waits for the scan; the contents are not read.
 * @param files - Files to open.
 * @param concurrency - Opens in flight; the libuv pool must allow as many.
 * @returns How many files opened. A file the install removed or locked only stays cold.
 */
export async function openConcurrently(files: readonly string[], concurrency: number = WARMUP_CONCURRENCY): Promise<number> {
  let next = 0
  let opened = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++]!
      try {
        await (await open(file, 'r')).close()
        opened++
      } catch { /* Stays cold. */ }
    }
  }))
  return opened
}

/**
 * Warm the packages written since the last warm-up, then record the install state it covered. Without a record,
 * the packages of the install that saved the current state count as written.
 * @param packageRoot - Desktop package directory.
 * @param log - Progress output.
 * @returns How many files were opened.
 */
export async function warmChangedPackages(packageRoot: string, log: (message: string) => void = console.log): Promise<number> {
  const state = yarnInstallState(packageRoot)
  if (state === undefined) return 0
  const installState = statSync(state).mtimeMs
  const since = recordedInstallState(packageRoot) ?? installState - FIRST_WARMUP_WINDOW_MS
  const packages = installedPackages(join(packageRoot, 'node_modules')).filter(item => item.changed > since)
  const files = packages.flatMap(item => packageFiles(item.dir))
  let opened = 0
  if (files.length > 0) {
    const started = performance.now()
    log(`Opening ${files.length} file${files.length === 1 ? '' : 's'} from ${packages.length} package${packages.length === 1 ? '' : 's'} the last install wrote, so the Host does not wait on their first-open scans`)
    opened = await openConcurrently(files)
    log(`Warmed installed packages in ${((performance.now() - started) / 1000).toFixed(1)} s`)
  }
  mkdirSync(dirname(warmupRecordPath(packageRoot)), { recursive: true })
  writeFileSync(warmupRecordPath(packageRoot), `${JSON.stringify({ installState })}\n`)
  return opened
}

/**
 * Launcher step. After an install, warm in a child: this process already started its libuv pool with the
 * default four threads, which would cap the concurrent opens. A failed warm-up only leaves files cold.
 * @param packageRoot - Desktop package directory.
 * @param platform - Platform of the launch.
 */
export function warmBeforeLaunch(packageRoot: string, platform: NodeJS.Platform = process.platform): void {
  try {
    if (!warmupNeeded(packageRoot, platform)) return
  } catch {
    return
  }
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), packageRoot], {
    stdio: 'inherit', env: { ...process.env, UV_THREADPOOL_SIZE: String(WARMUP_CONCURRENCY) },
  })
  if (result.error !== undefined || result.status !== 0) console.warn('Skipped warming installed packages; this launch may wait on first-open scans')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const packageRoot = process.argv[2]
  if (packageRoot === undefined) throw new Error('Usage: node scripts/dev-warmup.ts <package-root>')
  await warmChangedPackages(resolve(packageRoot))
}
