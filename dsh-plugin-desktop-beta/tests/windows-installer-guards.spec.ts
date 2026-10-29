/** The Windows installer script Next and Beta share must stop, not hide, install-directory write failures. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const script = readFileSync(new URL('../../dsh-plugin-desktop/build/installer.nsh', import.meta.url), 'utf8')
const macro = (name: string): string => {
  const body = script.split(`!macro ${name}`)[1]?.split('!macroend')[0]
  expect(body, name).toBeDefined()
  return body!
}
const between = (text: string, start: string, end: string): string => {
  const tail = text.split(start)[1]
  expect(tail, start).toBeDefined()
  return tail!.split(end)[0]!
}

it('recreates the install directory and probes it the way the File command writes', () => {
  const loop = between(macro('dshEnsureInstallDirWritable'), 'dsh_install_dir_probe:', 'dsh_install_dir_retry:')
  expect(loop.indexOf("shell32::SHCreateDirectoryExW(p 0, w \"$INSTDIR\", p 0)")).toBeLessThan(
    loop.indexOf('kernel32::CreateFileW(w "$INSTDIR\\${DSH_INSTALL_PROBE}", i 0x40000000, i 1'))
  expect(loop).toMatch(/MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$dshMessage" \/SD IDCANCEL IDRETRY dsh_install_dir_retry[\s\S]*SetErrorLevel 2\s+Quit/u)
})

it('waits 30 seconds only for a folder this run just removed, and asks at once otherwise', () => {
  const probe = macro('dshEnsureInstallDirWritable')
  expect(script).toContain('!define DSH_INSTALL_DIR_WAIT_MS 30000')
  expect(probe).toContain('StrCpy $dshWaitBudget 0')
  // A folder pending deletion reports access denied; nothing else waits.
  const transient = between(probe, '${if} $installationDir == $INSTDIR', '${if} $dshWaitBudget > 0')
  expect(transient).toMatch(/\$\{if\} \$dshProbeError = 5\s+\$\{orIf\} \$dshProbeError = 32\s+StrCpy \$dshWaitBudget \$\{DSH_INSTALL_DIR_WAIT_MS\}/u)
  expect(probe.match(/StrCpy \$dshWaitBudget \$\{DSH_INSTALL_DIR_WAIT_MS\}/gu)).toHaveLength(1)
  expect(probe).toMatch(/\$\{if\} \$dshWaited < \$dshWaitBudget\s+Sleep 500\s+Goto dsh_install_dir_probe/u)
  // Retry restarts the same wait instead of failing on the next attempt.
  expect(between(probe, 'dsh_install_dir_retry:', 'dsh_install_dir_ready:')).toMatch(/Pop \$dshWaitStart\s+Goto dsh_install_dir_probe/u)
})

it('stops before registration, shortcuts and launch when an application file is missing', () => {
  const verify = macro('dshVerifyInstalledFiles')
  for (const file of ['${APP_EXECUTABLE_FILENAME}', 'resources\\app.asar', '${UNINSTALL_FILENAME}']) {
    expect(verify).toContain(`!insertmacro dshRequireInstalledFile "${file}"`)
  }
  expect(verify).toMatch(/MessageBox MB_OK\|MB_ICONSTOP "\$dshMessage" \/SD IDOK\s+SetErrorLevel 2\s+Quit/u)
  expect(verify).not.toMatch(/WriteReg|CreateShortCut|ExecShell/u)
  // A directory named like a required file is not that file.
  expect(macro('dshRequireInstalledFile')).toContain('${orIf} ${FileExists} "$INSTDIR\\${RELATIVE}\\*.*"')
})

it('explains each failure in both languages with the installer, the download page and the safety of user data', () => {
  expect(script).toContain('!define DSH_DOWNLOAD_URL "https://dshdesktop.cn"')
  const probe = macro('dshEnsureInstallDirWritable')
  const waited = between(probe, '${if} $dshWaitBudget > 0\n      StrCpy $dshMessage', '${else}')
  const immediate = between(probe, 'StrCpy $dshMessage "$dshMessage当前账户', '${endIf}')
  for (const [text, holder] of [[waited, ['资源管理器窗口', '编辑器']], [immediate, ['写入权限', '有写入权限的位置']]] as const) {
    for (const words of holder) expect(text).toContain(words)
  }
  expect(probe).toContain('A File Explorer window, an editor')
  expect(probe).toContain('Your account may not be allowed to write to this folder')
  expect(probe).toContain('系统错误 $dshProbeError：$dshErrorText')
  expect(probe).toContain('System error $dshProbeError: $dshErrorText')
  for (const name of ['dshEnsureInstallDirWritable', 'dshVerifyInstalledFiles']) {
    const body = macro(name)
    for (const text of ['用户数据不在安装目录中，不受影响', 'Your user data is stored outside the installation folder and is not affected',
      '$EXEPATH', '${DSH_DOWNLOAD_URL}', '$dshInstallLog']) {
      expect(body, `${name}: ${text}`).toContain(text)
    }
  }
})

it('appends the Setup log beside the per-user installer copy, outside the install directory', () => {
  expect(script).toContain('!searchreplace DSH_INSTALL_LOG_DIR "${APP_INSTALLER_STORE_FILE}" "\\installer.exe" ""')
  expect(macro('dshEnsureInstallDirWritable')).toContain('StrCpy $dshInstallLog "$LOCALAPPDATA\\${DSH_INSTALL_LOG_DIR}\\install.log"')
  // ${GetTime} calls a plugin, which resolves only after the builder adds its plugin directories.
  const header = macro('customHeader')
  expect(header).toContain('Function dshWriteInstallLog')
  expect(header).toMatch(/FileOpen \$R1 \$dshInstallLog a[\s\S]*FileSeek \$R1 0 END[\s\S]*FileWriteUTF16LE \/BOM \$R1/u)
})
