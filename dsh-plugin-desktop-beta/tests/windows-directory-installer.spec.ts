/** The pinned builder templates keep their registration flow around staged directory replacement. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { directoryInstallerExits, directoryInstallSection, directoryUninstaller, installWindowsDirectoryInstaller } from '../scripts/windows-directory-installer.ts'

const require = createRequire(import.meta.url)
const templates = join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis')
const template = (path: string): string => readFileSync(join(templates, path), 'utf8')
const section = template('installSection.nsh')
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('removes the application below long paths and keeps app-data removal and registration cleanup', () => {
  const source = template('uninstaller.nsh')
  const adapted = directoryUninstaller(source)
  expect(adapted).toContain('RMDir /r "\\\\?\\$INSTDIR"')
  expect(adapted).not.toMatch(/RMDir \/r \$INSTDIR$/mu)
  // Desktop has no native data helper, so the template still removes app data on request.
  expect(adapted).toContain('RMDir /r "$APPDATA\\${APP_FILENAME}"')
  expect(adapted).toContain('!insertmacro customUnInstall')
  expect(adapted).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"')
  expect(directoryUninstaller(source.replaceAll('\n', '\r\n'))).toBe(adapted)
  expect(() => directoryUninstaller(source.replace('RMDir /r $INSTDIR', ''))).toThrow('Desktop NSIS template changed')
})

it.each(['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh'])('cleans staged files before %s exits', (helper) => {
  const source = template(`include/${helper}`)
  const exits = source.match(/^\s*Quit\s*$/gm) ?? []
  expect(exits.length).toBeGreaterThan(0)
  const adapted = directoryInstallerExits(source)
  expect(adapted.match(/Call dshCleanupDirectories/g)).toHaveLength(exits.length)
  expect(adapted).toContain('!ifndef BUILD_UNINSTALLER')
})

it('stages before stopping the application and promotes before registering the installation', () => {
  const result = directoryInstallSection(section)
  expect(result.indexOf('!insertmacro dshStageApplication')).toBeLessThan(result.indexOf('!insertmacro CHECK_APP_RUNNING'))
  expect(result.indexOf('Call dshPromoteDirectories')).toBeLessThan(result.indexOf('!insertmacro registryAddInstallInfo'))
  expect(result).toContain('!insertmacro addStartMenuLink $keepShortcuts')
  expect(result).toContain('!insertmacro addDesktopLink $keepShortcuts')
  expect(result).toContain('!insertmacro handleUninstallResult HKEY_CURRENT_USER')
  expect(result).not.toContain('!insertmacro installApplicationFiles')
  expect(result).not.toContain('File /oname=uninstallerIcon.ico')
})

it.each([
  '!include installer.nsh',
  '!insertmacro setLinkVars',
  '!insertmacro installApplicationFiles',
  '!ifdef UNINSTALLER_ICON\n  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"\n!endif\n',
])('rejects a missing or duplicate upstream insertion point: %s', (point) => {
  expect(() => directoryInstallSection(section.replace(point, ''))).toThrow('Desktop NSIS template changed')
  expect(() => directoryInstallSection(`${section}\n${point}`)).toThrow('Desktop NSIS template changed')
})

it('builds the installer from adapted templates and a copied, signed Windows 7-Zip console', async () => {
  // The package entry initializes the platform classes before their mutually dependent leaves.
  require('app-builder-lib')
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js') as {
    NsisTarget: { prototype: { computeFinalScript: (this: unknown, source: string) => Promise<string> } }
  }
  const prototype = NsisTarget.prototype
  const original = prototype.computeFinalScript
  const directory = mkdtempSync(join(tmpdir(), 'next-nsis-directory-installer-'))
  directories.push(directory)
  const toolset = join(directory, 'toolset')
  mkdirSync(join(toolset, 'bin'), { recursive: true })
  let tool = join(toolset, 'bin', '7za')
  writeFileSync(tool, '#!/bin/sh\n')
  // The builder's own method needs a complete packager; the adapter only wraps it.
  prototype.computeFinalScript = async (source: string) => source
  try {
    installWindowsDirectoryInstaller({ sevenZip: async () => tool })
    installWindowsDirectoryInstaller()
    const signIf = vi.fn(async () => undefined)
    const context = { outDir: join(directory, 'dist'), packager: { appInfo: { updaterCacheDirName: 'dsh-plugin-desktop-beta-updater' }, signIf } }
    await expect(prototype.computeFinalScript.call(context, template('installer.nsi'))).rejects.toThrow('needs a Windows 7-Zip console')
    const executable = Buffer.alloc(68)
    executable.write('MZ', 0, 'latin1')
    executable.writeUInt32LE(64, 0x3c)
    executable.write('PE\0\0', 64, 'latin1')
    tool = join(toolset, 'bin', '7za.exe')
    writeFileSync(tool, executable)
    const result = await prototype.computeFinalScript.call(context, template('installer.nsi'))
    const adapted = join(directory, 'dist', '.nsis-directory-installer')
    expect(result.split('\n').slice(0, 3)).toEqual([
      '!define DSH_UPDATER_CACHE_NAME "dsh-plugin-desktop-beta-updater"',
      `!define DSH_SEVENZIP_PATH "${join(adapted, '7za.exe')}"`,
      `!define DSH_SEVENZIP_LICENSE_DIR "${toolset}"`,
    ])
    expect(readFileSync(join(adapted, '7za.exe'))).toEqual(executable)
    expect(signIf).toHaveBeenCalledWith(join(adapted, '7za.exe'))
    for (const file of ['installSection.nsh', 'allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh', 'uninstaller.nsh']) {
      expect(result).toContain(`!include "${join(adapted, file)}"`)
      expect(result).not.toContain(`!include "${file}"`)
    }
    expect(readFileSync(join(adapted, 'installSection.nsh'), 'utf8')).toBe(directoryInstallSection(section))
  } finally {
    prototype.computeFinalScript = original
    Reflect.deleteProperty(prototype, Symbol.for('@deepseek-ai/dsh-desktop/directory-installer'))
  }
})

it('vendors the upstream directory transaction and only inserts the Desktop hooks', () => {
  const vendored = readFileSync(new URL('../../dsh-plugin-desktop/build/installer-directories.nsh', import.meta.url), 'utf8')
  const upstream = readFileSync(new URL('../../deepseek-harness/apps/desktop/scripts/installer-directories.nsh', import.meta.url), 'utf8')
  const inserted = vendored.match(/^ *; dsh-desktop:start\n[\s\S]*?^ *; dsh-desktop:end\n/gmu) ?? []
  expect(inserted.map(block => /!insertmacro (\w+)/u.exec(block)?.[1])).toEqual(['customInstallerStageFailed', 'customInstallerStaged'])
  const header = /^(?:;.*\n){2}/u
  expect(inserted.reduce((text, block) => text.replace(block, ''), vendored.replace(header, ''))).toBe(upstream)
})
