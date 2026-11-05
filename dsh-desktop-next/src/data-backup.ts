/** Copy a stopped Next data directory into a new folder that can later be selected as a data directory. */
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readlink, rename, rm, stat, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Chromium keeps live, machine-bound state there and rebuilds it; a former choice file would redirect the copy. */
const SKIPPED = new Set(['electron-user-data', 'desktop-next-location.json'])
/** Clone where the file system can (APFS, ReFS, btrfs); never replace an existing file. */
const COPY_MODE = constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export function backupDirectoryName(home: string, now = new Date()): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `${basename(home).replace(/^\.+/u, '') || 'dsh'}-backup-${stamp}`
}

export function assertBackupLocation(home: string, destination: string): void {
  if (contains(resolve(home), resolve(destination))) throw new Error('Choose a backup location outside the current data directory')
}

/**
 * Copy files, directories and links without following links. Links into the data directory are
 * retargeted into the copy, so the backup never depends on the original; on Windows, directory
 * links become junctions, which need no privilege. The copy is written beside the destination
 * under a `.partial` name and renamed only when complete, so an interrupted backup is never
 * mistaken for a whole one; a failed copy removes it.
 */
export async function copyDataDirectory(source: string, destination: string): Promise<void> {
  const from = resolve(source), to = resolve(destination)
  assertBackupLocation(from, to)
  if (await lstat(to).then(() => true, () => false)) throw new Error(`Backup destination already exists: ${to}`)
  const partial = `${to}.partial`
  await mkdir(partial, { mode: 0o700 })
  try {
    await copyEntries(from, partial, to, from, to)
    await rename(partial, to)
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    throw error
  }
}

/** `written` is where an entry is copied now; `final` is where it lives after the rename. */
async function copyEntries(directory: string, written: string, final: string, from: string, to: string): Promise<void> {
  for (const name of await readdir(directory)) {
    if (directory === from && SKIPPED.has(name)) continue
    const path = join(directory, name), copy = join(written, name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) await copyLink(path, copy, join(final, name), from, to)
    else if (info.isDirectory()) {
      await mkdir(copy, { mode: (info.mode & 0o777) | 0o700 })
      await copyEntries(path, copy, join(final, name), from, to)
    } else if (info.isFile()) await copyFile(path, copy, COPY_MODE)
    // Sockets, pipes and devices belong to running processes, not to the data.
  }
}

async function copyLink(path: string, copy: string, final: string, from: string, to: string): Promise<void> {
  const link = await readlink(path)
  const resolved = resolve(dirname(path), link)
  const target = !contains(from, resolved) ? resolved : isAbsolute(link) ? join(to, relative(from, resolved)) : link
  if (process.platform !== 'win32') { await symlink(target, copy); return }
  const directory = await stat(path).then(info => info.isDirectory(), () => undefined)
  if (directory === true) { await symlink(resolve(dirname(final), target), copy, 'junction'); return }
  try { await symlink(target, copy, 'file') } catch {
    // File links need Developer Mode on Windows, so keep the content; a dangling link has none.
    if (directory === false) await copyFile(path, copy, COPY_MODE)
  }
}
