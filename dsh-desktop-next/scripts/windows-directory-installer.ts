/**
 * Port of deepseek-harness apps/desktop/scripts/windows-directory-installer.mjs: the pinned NSIS template
 * extracts the new application beside the installation, skips the old uninstaller for same-path updates,
 * and replaces the installation by renaming complete directories on one volume. The transaction itself
 * lives in ../../dsh-plugin-desktop/build/installer-directories.nsh.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const templates = join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis')
const patched: unique symbol = Symbol.for('@deepseek-ai/dsh-desktop/directory-installer')

interface NsisTargetPrototype {
  [patched]?: true
  computeFinalScript(this: NsisTargetContext, source: string, ...args: unknown[]): Promise<string>
}

interface NsisTargetContext {
  readonly outDir: string
  readonly packager: { readonly appInfo: { readonly updaterCacheDirName: string }; signIf(file: string): Promise<unknown> }
}

/** Build inputs the installer embeds. */
export interface WindowsDirectoryInstallerOptions {
  /** Windows 7-Zip console extracting the payload; defaults to electron-builder's toolset, which follows the build host. */
  readonly sevenZip?: () => Promise<string>
}

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Desktop NSIS template changed: ${before}`)
  return source.replace(before, () => after)
}

/**
 * Preserve upstream registration and uninstall UI while replacing payload installation.
 * @param source - Pinned electron-builder installSection.nsh contents.
 * @returns Section with staging before shutdown and directory promotion before registration.
 */
export function directoryInstallSection(source: string): string {
  let result = source.replaceAll('\r\n', '\n')
  result = replaceOnce(result, '!include installer.nsh', `!include installer.nsh
!macroundef extractUsing7za
!macro extractUsing7za FILE
  !insertmacro dshExtractPayload "\${FILE}"
!macroend
!macroundef uninstallOldVersion
!macro uninstallOldVersion ROOT_KEY
  !insertmacro readReg $R4 "\${ROOT_KEY}" "\${INSTALL_REGISTRY_KEY}" InstallLocation
  \${If} $R4 == $INSTDIR
    StrCpy $R0 0
    ClearErrors
  \${Else}
    Push "\${ROOT_KEY}"
    Call uninstallOldVersion
  \${EndIf}
!macroend`)
  result = replaceOnce(result, '!insertmacro setLinkVars', `!insertmacro setLinkVars
!insertmacro dshStageApplication`)
  result = replaceOnce(result, '!insertmacro installApplicationFiles', 'Call dshPromoteDirectories\nIfErrors 0 +3\n  SetErrorLevel 2\n  Quit')
  result = replaceOnce(result, '!ifdef UNINSTALLER_ICON\n  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"\n!endif\n', '')
  // The staging macro uses the upstream installer macro, including its uninstaller.
  return result
}

/**
 * Clean staged directories on upstream Quit paths, including silent installers.
 * @param source - Pinned NSIS helper source.
 * @returns Helper with cleanup before installer exits.
 */
export function directoryInstallerExits(source: string): string {
  return source.replaceAll(/^(\s*)Quit\s*$/gm, '$1!ifndef BUILD_UNINSTALLER\n$1Call dshCleanupDirectories\n$1!endif\n$1Quit')
}

/**
 * Remove the installed application through an extended-length path, which deep dependency trees need.
 * Upstream also moves app-data removal into its native helper; Desktop has none and keeps the template's removal.
 * @param source - Pinned upstream uninstaller source.
 * @returns Uninstaller with long-path application removal.
 */
export function directoryUninstaller(source: string): string {
  return replaceOnce(source.replaceAll('\r\n', '\n'), 'RMDir /r $INSTDIR', 'RMDir /r "\\\\?\\$INSTDIR"')
}

/**
 * The installer runs this 7-Zip on the user's machine, so a cross-platform build host's own console must fail the build.
 * @param path - 7-Zip console to embed.
 */
async function assertWindowsExecutable(path: string): Promise<void> {
  const bytes = await readFile(path)
  const header = bytes.length >= 64 && bytes.readUInt16LE(0) === 0x5a4d ? bytes.readUInt32LE(0x3c) : -1
  if (header < 64 || header + 4 > bytes.length || bytes.readUInt32LE(header) !== 0x4550) {
    throw new Error(`The Windows installer needs a Windows 7-Zip console: ${path}`)
  }
}

/**
 * Install the build-only NSIS adapter without replacing electron-builder's bootstrap path. Installing it again in
 * the same process keeps the first options.
 * @param options - Build inputs the installer embeds.
 */
export function installWindowsDirectoryInstaller(options: WindowsDirectoryInstallerOptions = {}): void {
  // The package entry initializes the platform classes before their mutually dependent leaves.
  require('app-builder-lib')
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js') as { NsisTarget: { prototype: NsisTargetPrototype } }
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js') as { getPath7za: () => Promise<string> }
  const prototype = NsisTarget.prototype
  if (prototype[patched]) return
  prototype[patched] = true
  const compute = prototype.computeFinalScript
  prototype.computeFinalScript = async function (source, ...args) {
    const directory = join(this.outDir, '.nsis-directory-installer')
    await mkdir(directory, { recursive: true })
    const section = join(directory, 'installSection.nsh')
    await writeFile(section, directoryInstallSection(await readFile(join(templates, 'installSection.nsh'), 'utf8')))
    const sourceTool = await (options.sevenZip ?? getPath7za)()
    await assertWindowsExecutable(sourceTool)
    const tool = join(directory, '7za.exe')
    await copyFile(sourceTool, tool)
    await this.packager.signIf(tool)
    let adapted = replaceOnce(source, '!include "installSection.nsh"', `!include "${section}"`)
    for (const helper of ['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh']) {
      const path = join(directory, helper)
      await writeFile(path, directoryInstallerExits(await readFile(join(templates, 'include', helper), 'utf8')))
      adapted = replaceOnce(adapted, `!include "${helper}"`, `!include "${path}"`)
    }
    const uninstaller = join(directory, 'uninstaller.nsh')
    await writeFile(uninstaller, directoryUninstaller(await readFile(join(templates, 'uninstaller.nsh'), 'utf8')))
    adapted = replaceOnce(adapted, '!include "uninstaller.nsh"', `!include "${uninstaller}"`)
    return `!define DSH_UPDATER_CACHE_NAME "${this.packager.appInfo.updaterCacheDirName}"\n!define DSH_SEVENZIP_PATH "${tool}"\n!define DSH_SEVENZIP_LICENSE_DIR "${dirname(dirname(sourceTool))}"\n${await compute.call(this, adapted, ...args)}`
  }
}
