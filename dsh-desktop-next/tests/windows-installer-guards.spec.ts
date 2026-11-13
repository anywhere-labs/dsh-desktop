/** The Windows installer script Next and Beta share must stop, not hide, failures of the staged directory installation. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const script = readFileSync(new URL('../../dsh-plugin-desktop/build/installer.nsh', import.meta.url), 'utf8')
const macro = (name: string): string => {
  const body = new RegExp(`^!macro ${name}(?: .*)?\\n([\\s\\S]*?)^!macroend`, 'mu').exec(script)?.[1]
  expect(body, name).toBeDefined()
  return body!
}

it('asks at once when the folder beside the installation cannot take the staged version', () => {
  const stage = macro('customInstallerStageFailed')
  expect(stage).toContain('shell32::SHCreateDirectoryExW(p 0, w "$dshNewDirectory", p 0)')
  expect(stage).toMatch(/\$\{if\} \$dshStageError = 0\s+\$\{orIf\} \$dshStageError = 183\s+ClearErrors\s+Goto dsh_installer_stage_ready/u)
  // A folder this account may not write to never becomes writable by waiting.
  expect(stage).not.toContain('Sleep')
  expect(stage).toMatch(/MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$dshMessage" \/SD IDCANCEL IDRETRY dsh_installer_stage_retry\s[\s\S]*SetErrorLevel 2\s+!insertmacro dshQuit/u)
})

it('checks the staged application before anything replaces the installation', () => {
  const staged = macro('customInstallerStaged')
  for (const file of ['${APP_EXECUTABLE_FILENAME}', 'resources\\app.asar', '${UNINSTALL_FILENAME}']) {
    expect(staged).toContain(`!insertmacro dshRequireStagedFile "${file}"`)
  }
  expect(staged).toMatch(/Call dshRollbackDirectories[\s\S]*MessageBox MB_OK\|MB_ICONSTOP "\$dshMessage" \/SD IDOK\s+SetErrorLevel 2\s+!insertmacro dshQuit/u)
  // A directory named like a required file is not that file.
  expect(macro('dshRequireStagedFile')).toContain('${orIf} ${FileExists} "$dshNewDirectory\\${RELATIVE}\\*.*"')
})

it('removes the transaction directories on every exit the script adds', () => {
  expect(script.match(/^\s*Quit\s*$/gmu)).toHaveLength(1)
  expect(macro('dshQuit')).toMatch(/!ifndef BUILD_UNINSTALLER\s+!ifdef DSH_SEVENZIP_PATH\s+Call dshCleanupDirectories\s+!endif\s+!endif\s+Quit/u)
})

it('removes the replaced version before relaunching an in-app update', () => {
  const install = macro('customInstall')
  const finish = install.indexOf('!insertmacro dshFinishDirectories')
  expect(install).toContain('!ifmacrodef dshFinishDirectories')
  expect(install.indexOf('!insertmacro InstallerPublishStage 4')).toBeLessThan(finish)
  expect(finish).toBeLessThan(install.indexOf('${StdUtils.ExecShellAsUser}'))
})

it('explains each failure in both languages with the installer, the download page and the safety of user data', () => {
  expect(script).toContain('!define DSH_DOWNLOAD_URL "https://dshdesktop.cn"')
  for (const name of ['customInstallerStageFailed', 'customInstallerStaged', 'customInstallerExtractFailed', 'customInstallerDirectoryFailed']) {
    const body = macro(name)
    for (const text of ['MessageBox', '用户数据不在安装目录中，不受影响', 'Your user data is stored outside the installation folder and is not affected',
      '$EXEPATH', '${DSH_DOWNLOAD_URL}', '$dshInstallLog']) {
      expect(body, `${name}: ${text}`).toContain(text)
    }
  }
  const stage = macro('customInstallerStageFailed')
  expect(stage).toContain('当前账户可能没有这个位置的写入权限')
  expect(stage).toContain('Your account may not be allowed to write there')
  expect(stage).toContain('系统错误 $dshStageError：$dshErrorText')
  expect(stage).toContain('System error $dshStageError: $dshErrorText')
  const directory = macro('customInstallerDirectoryFailed')
  expect(directory).toContain('资源管理器窗口')
  expect(directory).toContain('a File Explorer window')
  // A failed restoration names the complete backup, which exit cleanup leaves in place.
  expect(directory).toMatch(/\$\{else\}\s+StrCpy \$dshMessage "\$dshMessage旧版本未能移回原位置[^"]*\$dshOldDirectory/u)
  expect(directory).toContain('Do not delete this folder')
})

it('keeps the Setup log and the directory attempts beside the updater cache, outside the installation', () => {
  const begin = macro('dshBeginInstallLog')
  // Per-machine installers still write below the account's own local application data.
  expect(begin).toMatch(/SetShellVarContext current[\s\S]*StrCpy \$dshInstallLogDir "\$LOCALAPPDATA\\\$\{DSH_UPDATER_CACHE_NAME\}"[\s\S]*SetShellVarContext all/u)
  expect(begin).toContain('StrCpy $dshInstallLog "$dshInstallLogDir\\install.log"')
  expect(script).toContain('!define DSH_INSTALLER_LOG_DIR "$dshInstallLogDir"')
  expect(macro('customInstallerDirectoryFailed')).toContain(
    'kernel32::CopyFileW(w "$PLUGINSDIR\\directory-operations.log", w "$dshDirectoryLogDirectory\\directory-operations.log", i 0)')
  // ${GetTime} calls a plugin, which resolves only after the builder adds its plugin directories.
  expect(macro('customHeader')).toMatch(/Function dshWriteInstallLog[\s\S]*FileOpen \$R1 \$dshInstallLog a[\s\S]*FileSeek \$R1 0 END[\s\S]*FileWriteUTF16LE \/BOM \$R1/u)
})

it('loads the transaction only into installers that embed 7-Zip', () => {
  const header = macro('customHeader')
  expect(header).toMatch(/!ifndef BUILD_UNINSTALLER\s+!ifdef DSH_SEVENZIP_PATH[\s\S]*!include "\$\{DSH_INSTALLER_SCRIPTS_DIR\}\\installer-directories.nsh"/u)
  // The transaction's functions expand the failure macros, whose variables must exist first.
  expect(header.indexOf('Var dshMessage')).toBeLessThan(header.indexOf('!include'))
  expect(macro('customInit')).toMatch(/!ifdef DSH_SEVENZIP_PATH\s+!insertmacro dshBeginInstallLog/u)
})
