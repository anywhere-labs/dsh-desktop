/** What the installed package shows outside the running app: Windows shortcuts and the Linux desktop entry. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_ENTRY_MARKER, syncLinuxDesktopEntry, syncWindowsShortcuts, windowsShortcutDirectories, type WindowsShortcutShell } from '../src/installed-app-icon.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'next-installed-icon-'))
  directories.push(directory)
  return directory
}
function file(path: string, content = ''): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

type Link = ReturnType<WindowsShortcutShell['readShortcutLink']>

it('points this installation\'s shortcuts at the chosen icon and leaves every other shortcut alone', () => {
  const root = temporary()
  const program = join(root, 'Programs', 'DSH Desktop Beta', 'DSH Desktop Beta.exe')
  const unpacked = join(root, 'Programs', 'DSH Desktop Beta', 'resources', 'app.asar.unpacked', 'build')
  const dark = file(join(unpacked, 'app-icon-dark.ico'), 'dark')
  const classic = file(join(unpacked, 'classic', 'app-icon.ico'), 'classic')
  const desktop = join(root, 'Desktop'), menu = join(root, 'Start Menu'), pins = join(root, 'TaskBar')
  const installer = join(desktop, 'DSH Desktop Beta.lnk')
  const startMenu = join(menu, 'DSH Desktop Beta.lnk')
  const pinned = join(pins, 'DSH Desktop Beta.lnk')
  const userMade = join(desktop, 'DSH Desktop Beta.exe - 快捷方式.lnk')
  const picked = join(desktop, 'DSH Desktop Beta (mine).lnk')
  const elsewhere = join(desktop, 'DSH Desktop Beta old.lnk')
  const unrelated = join(desktop, 'Notes.lnk')
  const links = new Map<string, Link>([
    // The installer sets the program as the icon; Windows copies its shortcut for a pin.
    [installer, { target: program, icon: program, iconIndex: 0 }],
    // Paths compare without case, and a shortcut without an icon location shows its target's.
    [startMenu, { target: program.toUpperCase(), icon: '' }],
    [pinned, { target: program, icon: program, iconIndex: 0 }],
    [userMade, { target: program }],
    // The user picked this icon, and this shortcut starts another installation.
    [picked, { target: program, icon: join(root, 'Icons', 'mine.ico'), iconIndex: 0 }],
    [elsewhere, { target: join(root, 'Old', 'DSH Desktop Beta.exe'), icon: join(root, 'Old', 'DSH Desktop Beta.exe'), iconIndex: 0 }],
    [unrelated, { target: program, icon: program, iconIndex: 0 }],
  ])
  for (const path of links.keys()) file(path)
  file(join(desktop, 'DSH Desktop Beta.txt'))
  file(join(desktop, 'DSH Desktop Beta broken.lnk'))
  const read = vi.fn((path: string): Link => {
    const link = links.get(path)
    if (link === undefined) throw new Error('Failed to read shortcut link')
    return { ...link }
  })
  const write = vi.fn((path: string, _operation: 'update', options: { target: string; icon: string; iconIndex: number }): boolean => {
    links.set(path, { ...links.get(path)!, icon: options.icon, iconIndex: options.iconIndex })
    return true
  })
  const shell: WindowsShortcutShell = { readShortcutLink: read, writeShortcutLink: write }
  const sync = (icon: string) => syncWindowsShortcuts({ icon, ours: [dark, classic], execPath: program, name: 'DSH Desktop Beta',
    directories: [desktop, menu, pins, desktop, join(root, 'Missing')], shell })
  const ours = [installer, startMenu, pinned, userMade].sort()

  // The default in a light theme is what the installer made.
  expect(sync(program)).toEqual({ changed: [], failed: [] })
  // Only shortcuts named after the app are resolved, each folder once.
  expect(read.mock.calls.map(([path]) => path).sort()).toEqual([...ours, picked, elsewhere, join(desktop, 'DSH Desktop Beta broken.lnk')].sort())
  expect(write).not.toHaveBeenCalled()

  expect([...sync(classic).changed].sort()).toEqual(ours)
  expect(write).toHaveBeenCalledWith(installer, 'update', { target: program, icon: classic, iconIndex: 0 })
  for (const path of ours) expect(links.get(path)).toMatchObject({ icon: classic, iconIndex: 0 })
  expect(links.get(picked)!.icon).toBe(join(root, 'Icons', 'mine.ico'))
  expect(links.get(elsewhere)!.icon).toBe(join(root, 'Old', 'DSH Desktop Beta.exe'))
  expect(links.get(unrelated)!.icon).toBe(program)
  // The next launch finds nothing left to do.
  write.mockClear()
  expect(sync(classic)).toEqual({ changed: [], failed: [] })
  expect(write).not.toHaveBeenCalled()

  // A dark theme moves them from one of the app's icons to another, and a light one back to the program.
  expect([...sync(dark).changed].sort()).toEqual(ours)
  expect([...sync(program).changed].sort()).toEqual(ours)
  for (const path of ours) expect(links.get(path)).toMatchObject({ icon: program, iconIndex: 0 })

  // Windows refuses shortcuts for all users without administrator rights.
  write.mockReturnValueOnce(false)
  const refused = sync(classic)
  expect(refused.failed).toHaveLength(1)
  expect(refused.changed).toHaveLength(3)
  // An icon missing from the installation is never set.
  rmSync(dark)
  write.mockClear()
  expect(sync(dark)).toEqual({ changed: [], failed: [dark] })
  expect(write).not.toHaveBeenCalled()
})

it('looks on both desktops and Start menus and among the taskbar, Start and jump list pins', () => {
  const appData = temporary()
  const pinned = join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned')
  mkdirSync(join(pinned, 'ImplicitAppShortcuts', '69639df789022856'), { recursive: true })
  file(join(pinned, 'ImplicitAppShortcuts', 'stray.lnk'))
  expect(windowsShortcutDirectories({ desktop: join(appData, 'Desktop'), appData }, { PUBLIC: join(appData, 'Public'), ProgramData: join(appData, 'ProgramData') })).toEqual([
    join(appData, 'Desktop'), join(appData, 'Public', 'Desktop'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), join(appData, 'ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(pinned, 'TaskBar'), join(pinned, 'StartMenu'), join(pinned, 'ImplicitAppShortcuts', '69639df789022856'),
  ])
  expect(windowsShortcutDirectories({ desktop: 'Desktop', appData: temporary() }, {})).toHaveLength(4)
})

const PACKAGED = `[Desktop Entry]
Name=DSH Desktop Beta
Exec="/opt/DSH Desktop Beta/dsh-plugin-desktop-beta" %U
Terminal=false
Type=Application
Icon=dsh-plugin-desktop-beta
Icon[zh_CN]=dsh-plugin-desktop-beta
StartupWMClass=dsh-plugin-desktop-beta
Comment=Agentic coding desktop for the DeepSeek Harness (Next)
Categories=Development;

[Desktop Action new-window]
Name=New Window
Icon=dsh-plugin-desktop-beta
`

it('shows another icon through a marked per-user copy of the package\'s desktop entry, and removes it for the package\'s own', () => {
  const root = temporary()
  const system = join(root, 'usr', 'share')
  file(join(system, 'applications', 'dsh-plugin-desktop-beta.desktop'), PACKAGED)
  const unpacked = join(root, 'opt', 'DSH Desktop Beta', 'resources', 'app.asar.unpacked', 'build')
  const classic = file(join(unpacked, 'classic', 'app-icon.png'), 'classic')
  const dark = file(join(unpacked, 'app-icon-dark.png'), 'dark')
  const home = join(root, 'home')
  const env = { XDG_DATA_DIRS: `${join(root, 'usr', 'local', 'share')}:${system}` }
  const program = '/opt/DSH Desktop Beta/dsh-plugin-desktop-beta'
  const sync = (image: string | undefined, label = 'classic', overrides: Partial<Parameters<typeof syncLinuxDesktopEntry>[0]> = {}) =>
    syncLinuxDesktopEntry({ image, label, execPath: program, desktopId: 'dsh-plugin-desktop-beta.desktop', home, env, ...overrides })
  const copy = join(home, '.local', 'share', 'applications', 'dsh-plugin-desktop-beta.desktop')

  expect(sync(undefined)).toEqual({ changed: [], failed: [] })
  expect(existsSync(copy)).toBe(false)
  expect(sync(classic)).toEqual({ changed: [copy], failed: [] })
  // Only the [Desktop Entry] group changes, localized icons included; TryExec hides the copy once the package is gone.
  expect(readFileSync(copy, 'utf8')).toBe(`[Desktop Entry]
Name=DSH Desktop Beta
Exec="/opt/DSH Desktop Beta/dsh-plugin-desktop-beta" %U
Terminal=false
Type=Application
StartupWMClass=dsh-plugin-desktop-beta
Comment=Agentic coding desktop for the DeepSeek Harness (Next)
Categories=Development;
Icon=${classic}
TryExec=/opt/DSH Desktop Beta/dsh-plugin-desktop-beta
${DESKTOP_ENTRY_MARKER}=classic

[Desktop Action new-window]
Name=New Window
Icon=dsh-plugin-desktop-beta
`)
  expect(sync(classic)).toEqual({ changed: [], failed: [] })
  // A dark theme rewrites the copy with the whale tail's Dark rendition, and a light one removes it.
  expect(sync(dark, 'dark')).toEqual({ changed: [copy], failed: [] })
  expect(readFileSync(copy, 'utf8')).toContain(`Icon=${dark}\n`)
  expect(readFileSync(copy, 'utf8')).toContain(`${DESKTOP_ENTRY_MARKER}=dark\n`)
  expect(sync(undefined)).toEqual({ changed: [copy], failed: [] })
  expect(existsSync(copy)).toBe(false)

  // XDG_DATA_HOME, when absolute, holds the copy instead.
  const dataHome = join(root, 'data')
  expect(sync(classic, 'classic', { env: { ...env, XDG_DATA_HOME: dataHome } }).changed).toEqual([join(dataHome, 'applications', 'dsh-plugin-desktop-beta.desktop')])
  expect(sync(undefined, 'default', { env: { ...env, XDG_DATA_HOME: dataHome } }).changed).toEqual([join(dataHome, 'applications', 'dsh-plugin-desktop-beta.desktop')])

  // An AppImage, or an entry that starts another installation, is left alone.
  expect(sync(classic, 'classic', { execPath: '/tmp/.mount_DSH123/dsh-plugin-desktop-beta' })).toEqual({ changed: [], failed: [] })
  expect(sync(classic, 'classic', { desktopId: 'dsh-desktop-beta.desktop' })).toEqual({ changed: [], failed: [] })
  expect(existsSync(copy)).toBe(false)

  // A copy the user keeps, such as a menu editor's, is theirs.
  file(copy, PACKAGED.replace('Name=DSH Desktop Beta', 'Name=My DSH'))
  expect(sync(classic)).toEqual({ changed: [], failed: [] })
  expect(sync(undefined)).toEqual({ changed: [], failed: [] })
  expect(readFileSync(copy, 'utf8')).toContain('Name=My DSH')
  rmSync(copy)

  // A missing image is never named.
  rmSync(classic)
  expect(sync(classic)).toEqual({ changed: [], failed: [classic] })
  expect(existsSync(copy)).toBe(false)
})

it('follows a package entry that changed and reads an unquoted program', () => {
  const root = temporary()
  const system = join(root, 'share')
  const entry = file(join(system, 'applications', 'dsh-plugin-desktop-beta.desktop'), PACKAGED.replace('"/opt/DSH Desktop Beta/dsh-plugin-desktop-beta" %U', '/opt/dsh/dsh-plugin-desktop-beta %U'))
  const image = file(join(root, 'classic.png'), 'classic')
  const home = join(root, 'home')
  const sync = () => syncLinuxDesktopEntry({ image, label: 'classic', execPath: '/opt/dsh/dsh-plugin-desktop-beta', desktopId: 'dsh-plugin-desktop-beta.desktop',
    home, env: { XDG_DATA_DIRS: system } })
  const copy = join(home, '.local', 'share', 'applications', 'dsh-plugin-desktop-beta.desktop')
  expect(sync().changed).toEqual([copy])
  // A package update's new entry reaches the copy on the next launch.
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('Categories=Development;', 'Categories=Development;IDE;'))
  expect(sync().changed).toEqual([copy])
  expect(readFileSync(copy, 'utf8')).toContain('Categories=Development;IDE;\n')
})
