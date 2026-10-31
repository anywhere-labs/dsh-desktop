/**
 * Resolve the Next data directory: a directory chosen in the app wins, `DSH_DESKTOP_NEXT_HOME`
 * applies only without one, and `~/.dsh` is the default. The choice and the record of the last
 * launch live in one fixed directory, outside every data directory and independent of the
 * environment, so neither moves when the variable is added, changed or lost.
 */
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { atomicJson, privateDirectory, readPrivateFile } from './private-files.ts'

export const DATA_DIRECTORY_VARIABLE = 'DSH_DESKTOP_NEXT_HOME'
const LOCATION_FILE = 'desktop-next-location.json'
const LAST_HOME_FILE = 'desktop-next-last-home.json'

export type DataDirectorySource = 'desktop' | 'environment' | 'default'

export interface DataDirectoryLocation {
  home: string
  source: DataDirectorySource
  /** The directory used without an in-app choice: the variable when set, otherwise the default. */
  fallback: string
  error?: string
}

export function defaultDataDirectory(userHome = homedir()): string { return join(userHome, '.dsh') }

export function dataDirectoryLocationRoot(packaged: boolean, appData: () => string, packageRoot: string): string {
  return packaged ? join(appData(), 'DSH NEXT', 'home') : join(packageRoot, '.desktop-next', 'home')
}

export function dataDirectoryLocationFile(locationRoot: string): string { return join(locationRoot, LOCATION_FILE) }

function readHome(path: string): string | undefined {
  const value = JSON.parse(readPrivateFile(path) ?? 'null') as unknown
  if (value === null) return undefined
  if (typeof value !== 'object' || !('home' in value) || typeof value.home !== 'string' || !isAbsolute(value.home)) throw new Error('Invalid Next data directory')
  return resolve(value.home)
}

function fallbackDirectory(environmentHome: string | undefined, userHome?: string): string {
  return environmentHome ? resolve(environmentHome) : defaultDataDirectory(userHome)
}

export function readDataDirectory(locationRoot: string, environmentHome?: string, userHome?: string): DataDirectoryLocation {
  const fallback = fallbackDirectory(environmentHome, userHome)
  const source = environmentHome ? 'environment' : 'default'
  try {
    const home = readHome(dataDirectoryLocationFile(locationRoot))
    if (home === undefined) return { home: fallback, source, fallback }
    privateDirectory(home)
    return { home, source: 'desktop', fallback }
  } catch (error) { return { home: fallback, source, fallback, error: String(error) } }
}

/**
 * The data directory of the last launch. Until one is recorded, the former rule answers: the
 * variable used to move the choice into its own directory, so an upgrade cannot switch silently.
 */
function previousDataDirectory(locationRoot: string, environmentHome?: string, userHome?: string): { home: string; recorded: boolean } {
  try {
    const recorded = readHome(join(locationRoot, LAST_HOME_FILE))
    if (recorded !== undefined) return { home: recorded, recorded: true }
  } catch { /* An unreadable record falls back to the former rule. */ }
  const fallback = fallbackDirectory(environmentHome, userHome)
  let home = fallback
  try { home = readHome(dataDirectoryLocationFile(environmentHome ? fallback : locationRoot)) ?? fallback } catch { /* The fallback stands. */ }
  return { home, recorded: false }
}

/**
 * The last launch's directory when this launch would leave it for another one: it still holds
 * Next data, or it was recorded and cannot be reached now, such as on a disconnected drive.
 */
export function dataDirectoryChange(locationRoot: string, home: string, environmentHome?: string, userHome?: string): { previous: string; reachable: boolean } | undefined {
  const previous = previousDataDirectory(locationRoot, environmentHome, userHome)
  if (sameDirectory(previous.home, home)) return undefined
  let reachable = false
  try { reachable = lstatSync(previous.home, { throwIfNoEntry: false })?.isDirectory() === true } catch { /* Unreachable. */ }
  if (reachable ? !holdsNextData(previous.home) : !previous.recorded) return undefined
  return { previous: previous.home, reachable }
}

export function rememberDataDirectory(locationRoot: string, home: string): void {
  const path = join(locationRoot, LAST_HOME_FILE)
  try { if (readHome(path) === resolve(home)) return } catch { /* Replace an unreadable record. */ }
  atomicJson(path, { home: resolve(home) })
}

/** Compare as the file system resolves both paths, ignoring case on Windows. */
export function sameDirectory(left: string, right: string): boolean {
  const canonical = (path: string): string => { try { return realpathSync.native(path) } catch { return resolve(path) } }
  const [a, b] = [canonical(left), canonical(right)]
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** A directory that a Next launch has already set up. */
function holdsNextData(home: string): boolean {
  const isFile = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isFile() === true
  try { return isFile(join(home, 'desktop-next.json')) || isFile(join(home, 'profiles', 'desktop', 'package.json')) } catch { return false }
}

/** The fallback directory may already hold data shared with Stable or the CLI. */
export function validateDataDirectory(target: string, current: string, fallback: string): string {
  if (!isAbsolute(target) || target.includes('\0')) throw new Error('Data directory must be an absolute path')
  const destination = resolve(target)
  const nested = relative(current, destination)
  if (nested && !nested.startsWith('..') && !isAbsolute(nested)) throw new Error('Choose a directory outside the current data directory')
  privateDirectory(destination)
  const entries = readdirSync(destination)
  if (destination !== fallback && destination !== current && entries.length > 0 && !holdsNextData(destination)) {
    throw new Error('Choose an empty directory or an existing Next data directory')
  }
  return destination
}
