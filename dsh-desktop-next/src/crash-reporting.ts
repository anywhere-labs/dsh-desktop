/** Local-only Crashpad collection for the Electron processes and the Node-mode Host. */
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** The part of Electron's `crashReporter` the Desktop starts before the app is ready. */
export interface DesktopCrashReporter {
  start(options: { productName: string; uploadToServer: false; globalExtra: Record<string, string> }): void
}

/**
 * Start Crashpad without uploads. Called before any child process exists, so renderers, the GPU
 * process and the Node-mode Host all inherit its handler; without it a native Host crash leaves no
 * minidump anywhere, because libuv also disables Windows Error Reporting in that child (#1511).
 * @param reporter - Electron's `crashReporter`.
 * @param metadata - Product name and versions annotated on every report.
 */
export function startCrashReporting(reporter: DesktopCrashReporter, metadata: { productName: string; version: string; dsh?: string | undefined }): void {
  reporter.start({ productName: metadata.productName, uploadToServer: false,
    globalExtra: { appVersion: metadata.version, ...(metadata.dsh === undefined ? {} : { dshVersion: metadata.dsh }) } })
}

/** Minidump metadata for a diagnostic export; dump contents never leave the Crashpad directory. */
export interface CrashDumpInventory {
  readonly count: number
  readonly files: readonly { readonly name: string; readonly bytes: number; readonly modified: string }[]
}

/**
 * List local minidumps, newest first. Crashpad keeps them in `pending`, `completed` or `reports`
 * depending on the platform; linked entries are never followed.
 * @param directory - Electron's `crashDumps` directory.
 * @param limit - Most files to describe.
 * @returns The number of dumps and the newest ones, named relative to `directory`.
 */
export function crashDumpInventory(directory: string, limit = 20): CrashDumpInventory {
  const files: { name: string; bytes: number; modified: number }[] = []
  const walk = (relative: string, depth: number): void => {
    let entries: string[]
    try { entries = readdirSync(join(directory, relative)) } catch { return }
    for (const entry of entries) {
      const name = relative === '' ? entry : `${relative}/${entry}`
      let stat: ReturnType<typeof lstatSync>
      try { stat = lstatSync(join(directory, name)) } catch { continue }
      if (stat.isDirectory() && depth < 2) walk(name, depth + 1)
      else if (stat.isFile() && entry.endsWith('.dmp')) files.push({ name, bytes: stat.size, modified: stat.mtimeMs })
    }
  }
  walk('', 0)
  files.sort((a, b) => b.modified - a.modified)
  return { count: files.length, files: files.slice(0, limit).map(file => ({ name: file.name, bytes: file.bytes, modified: new Date(file.modified).toISOString() })) }
}
