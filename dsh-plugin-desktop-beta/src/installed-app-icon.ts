/**
 * The app icon outside the running app on Windows and Linux, where no signature covers the files that show it: the
 * shortcuts the installer and the user made on Windows, and the desktop entry the Linux package installs. macOS
 * keeps the signed bundle's icon. Changes stay within files that start this installation and still show one of its
 * own icons, and every launch applies the saved choice and theme again, since installers recreate their shortcuts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'

/** The files a sync changed, and those it found but could not change. */
export interface InstalledAppIconResult {
  readonly changed: readonly string[]
  readonly failed: readonly string[]
}

/** Electron's `shell` shortcut operations, which exist on Windows only. */
export interface WindowsShortcutShell {
  readShortcutLink(path: string): { target: string; icon?: string; iconIndex?: number }
  writeShortcutLink(path: string, operation: 'update', options: { target: string; icon: string; iconIndex: number }): boolean
}

type Environment = Readonly<Record<string, string | undefined>>

const UNCHANGED: InstalledAppIconResult = Object.freeze({ changed: [], failed: [] })

/** Windows paths compare without case; `normalize` also turns `/` into `\` there. */
function sameWindowsPath(left: string, right: string): boolean {
  return left !== '' && right !== '' && normalize(left).toLowerCase() === normalize(right).toLowerCase()
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}

/**
 * Where Windows keeps the shortcuts that start an installed app for this user: both desktops and Start menus, the
 * taskbar and Start pins, and the per-app folders Windows keeps for the jump lists of pinned apps.
 * @param paths - Electron's `desktop` and `appData` paths.
 * @param env - The process environment, for `PUBLIC` and `ProgramData`.
 * @returns The folders, existing or not.
 */
export function windowsShortcutDirectories(paths: { readonly desktop: string; readonly appData: string }, env: Environment): string[] {
  const pinned = join(paths.appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned')
  const implicit = join(pinned, 'ImplicitAppShortcuts')
  let jumpLists: string[] = []
  try {
    jumpLists = readdirSync(implicit, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(implicit, entry.name))
  } catch { /* No pinned app has a jump list folder yet. */ }
  return [
    paths.desktop,
    ...env.PUBLIC ? [join(env.PUBLIC, 'Desktop')] : [],
    join(paths.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ...env.ProgramData ? [join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')] : [],
    join(pinned, 'TaskBar'),
    join(pinned, 'StartMenu'),
    ...jumpLists,
  ]
}

/**
 * Point this installation's shortcuts at an icon: the program itself for the default whale tail in a light theme,
 * as the installer made them, or one of the ICOs unpacked beside the archive. Resolving a shortcut is synchronous COM
 * work, so only `.lnk` files whose names start with the app's are read: the installer's, Windows' copies of them for
 * pins, and "<name>.exe - Shortcut". A shortcut that starts another program, or whose icon the user picked
 * elsewhere, keeps what it has. Shortcuts for all users need administrator rights, which the app does not have; they
 * end up in `failed`.
 * @param input.icon - The icon location the shortcuts should show.
 * @param input.ours - Every ICO the app may have set before; the program itself counts too.
 * @param input.execPath - This installation's program.
 * @param input.name - The shortcut name the installer uses.
 * @param input.directories - Where to look, see {@link windowsShortcutDirectories}.
 * @param input.shell - Electron's `shell`.
 */
export function syncWindowsShortcuts(input: {
  readonly icon: string; readonly ours: readonly string[]; readonly execPath: string; readonly name: string
  readonly directories: readonly string[]; readonly shell: WindowsShortcutShell
}): InstalledAppIconResult {
  const wanted = input.icon
  if (!sameWindowsPath(wanted, input.execPath) && !existsSync(wanted)) return { changed: [], failed: [wanted] }
  const ours = [input.execPath, ...input.ours]
  const prefix = input.name.toLowerCase()
  const changed: string[] = []
  const failed: string[] = []
  for (const directory of new Set(input.directories)) {
    let names: string[]
    try { names = readdirSync(directory) } catch { continue }
    for (const name of names) {
      const lower = name.toLowerCase()
      if (!lower.startsWith(prefix) || !lower.endsWith('.lnk')) continue
      const path = join(directory, name)
      let link: ReturnType<WindowsShortcutShell['readShortcutLink']>
      try { link = input.shell.readShortcutLink(path) } catch { continue }
      if (!sameWindowsPath(link.target, input.execPath)) continue
      // A shortcut without an icon location shows its target's icon.
      const icon = link.icon || input.execPath
      if (!ours.some(own => sameWindowsPath(icon, own))) continue
      if (sameWindowsPath(icon, wanted) && (link.iconIndex ?? 0) === 0) continue
      let written = false
      try { written = input.shell.writeShortcutLink(path, 'update', { target: link.target, icon: wanted, iconIndex: 0 }) } catch { /* Reported below. */ }
      ;(written ? changed : failed).push(path)
    }
  }
  return { changed, failed }
}

const DESKTOP_ENTRY_GROUP = '[Desktop Entry]'
/** Marks the copy of a desktop entry the app wrote; a copy without it is the user's, such as a menu editor's. */
export const DESKTOP_ENTRY_MARKER = 'X-DSH-Desktop-App-Icon'

/** The key of a desktop entry line, localized keys such as `Icon[zh_CN]` included under their base key. */
function desktopEntryKey(line: string): string | undefined {
  return /^([A-Za-z0-9-]+)(?:\[[^\]]*\])?\s*=/u.exec(line.trim())?.[1]
}

/** An unlocalized value of the `[Desktop Entry]` group, as written. */
function desktopEntryValue(entry: string, key: string): string | undefined {
  let group = false
  for (const line of entry.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) { group = trimmed === DESKTOP_ENTRY_GROUP; continue }
    const match = group ? /^([A-Za-z0-9-]+)\s*=\s*(.*)$/u.exec(trimmed) : null
    if (match?.[1] === key) return match[2]
  }
  return undefined
}

/** The program an entry's `Exec` line starts: its first argument, unquoted. */
function desktopEntryProgram(entry: string): string | undefined {
  const exec = desktopEntryValue(entry, 'Exec')?.trimStart()
  if (exec === undefined || exec === '') return undefined
  if (!exec.startsWith('"')) return exec.split(/\s+/u)[0]
  let program = ''
  for (let index = 1; index < exec.length; index++) {
    const character = exec[index]!
    if (character === '"') return program
    // Inside quotes a backslash escapes the next character.
    program += character === '\\' && index + 1 < exec.length ? exec[++index] : character
  }
  return undefined
}

/** A desktop entry string value: the specification's escapes for a backslash and the control characters. */
function desktopEntryString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\n/gu, '\\n').replace(/\t/gu, '\\t').replace(/\r/gu, '\\r')
}

/**
 * The package's entry with another icon. Only the `[Desktop Entry]` group changes: its icons, localized ones
 * included, give way to the image, `TryExec` names this program unless the entry has its own, and the marker says the
 * app wrote the copy, and which icon it shows.
 */
function iconDesktopEntry(packaged: string, icon: string, label: string, program: string): string {
  const lines = packaged.replace(/\r\n?/gu, '\n').split('\n')
  const start = lines.findIndex(line => line.trim() === DESKTOP_ENTRY_GROUP)
  const next = lines.findIndex((line, index) => index > start && line.trim().startsWith('['))
  const end = next < 0 ? lines.length : next
  const group = lines.slice(start + 1, end).filter(line => desktopEntryKey(line) !== 'Icon')
  while (group.length > 0 && group.at(-1)!.trim() === '') group.pop()
  group.push(`Icon=${desktopEntryString(icon)}`)
  if (!group.some(line => desktopEntryKey(line) === 'TryExec')) group.push(`TryExec=${desktopEntryString(program)}`)
  group.push(`${DESKTOP_ENTRY_MARKER}=${desktopEntryString(label)}`)
  const rest = lines.slice(end)
  return `${[...lines.slice(0, start + 1), ...group, ...rest.length > 0 ? ['', ...rest] : []].join('\n').replace(/\n+$/u, '')}\n`
}

/**
 * Show an icon in Linux menus, docks and window switchers. The package installs `<desktopId>` in a system data
 * directory with the default whale tail; for any other image the app writes a copy into the user's own, which
 * desktop environments prefer, with the image as `Icon` and this program as `TryExec`, so menus skip the copy once
 * the package is gone. The package's own icon removes the copy again. Nothing changes when no system entry starts
 * this program, as for an AppImage, or when the user already keeps a copy of their own.
 * @param input.image - The image to show, unpacked beside the archive, or undefined for the package's own icon.
 * @param input.label - What the copy's marker records about the image, such as `classic`.
 * @param input.execPath - This installation's program.
 * @param input.desktopId - The package's desktop file name, `desktopName` in its manifest.
 * @param input.home - The user's home directory.
 * @param input.env - The process environment, for `XDG_DATA_HOME` and `XDG_DATA_DIRS`.
 */
export function syncLinuxDesktopEntry(input: {
  readonly image: string | undefined; readonly label: string; readonly execPath: string; readonly desktopId: string
  readonly home: string; readonly env: Environment
}): InstalledAppIconResult {
  const configured = input.env.XDG_DATA_HOME
  const dataHome = configured && isAbsolute(configured) ? configured : join(input.home, '.local', 'share')
  const copy = join(dataHome, 'applications', input.desktopId)
  const existing = readText(copy)
  const ours = existing !== undefined && desktopEntryValue(existing, DESKTOP_ENTRY_MARKER) !== undefined
  if (input.image === undefined) {
    if (!ours) return UNCHANGED
    try { rmSync(copy, { force: true }); return { changed: [copy], failed: [] } } catch { return { changed: [], failed: [copy] } }
  }
  if (existing !== undefined && !ours) return UNCHANGED
  const packaged = (input.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')
    .filter(directory => isAbsolute(directory) && normalize(directory) !== normalize(dataHome))
    .map(directory => readText(join(directory, 'applications', input.desktopId)))
    .find(entry => entry !== undefined)
  const program = packaged === undefined ? undefined : desktopEntryProgram(packaged)
  if (packaged === undefined || program === undefined || normalize(program) !== normalize(input.execPath)) return UNCHANGED
  if (!existsSync(input.image)) return { changed: [], failed: [input.image] }
  const entry = iconDesktopEntry(packaged, input.image, input.label, input.execPath)
  if (entry === existing) return UNCHANGED
  const temporary = `${copy}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(copy), { recursive: true })
    writeFileSync(temporary, entry, { mode: 0o644 })
    renameSync(temporary, copy)
    return { changed: [copy], failed: [] }
  } catch {
    try { rmSync(temporary, { force: true }) } catch { /* The failure below is what matters. */ }
    return { changed: [], failed: [copy] }
  }
}
