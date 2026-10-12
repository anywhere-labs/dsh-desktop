import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_INSTALLER_QUIT_FLAG } from '../src/desktop-installer-quit.ts'

describe('Windows NSIS running-app handoff', () => {
  it('checks for the exact app before requesting orderly shutdown', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')
    const firstDetection = script.indexOf('!insertmacro FIND_PROCESS')
    const request = script.indexOf(DESKTOP_INSTALLER_QUIT_FLAG)
    const wait = script.indexOf('dsh_installer_wait_for_exit:')
    const fallback = script.indexOf('dsh_installer_scoped_fallback:')

    expect(script).toContain('!macro customCheckAppRunning')
    expect(script).toContain('Var pid')
    expect(script).toContain('ExecWait')
    expect(script).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}')
    expect(script).toContain('!insertmacro IS_POWERSHELL_AVAILABLE')
    expect(firstDetection).toBeGreaterThanOrEqual(0)
    expect(request).toBeGreaterThan(firstDetection)
    expect(wait).toBeGreaterThan(request)
    expect(fallback).toBeGreaterThan(wait)
  })

  it('waits for graceful disposal before using the scoped builder fallback', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')

    expect(script).toContain('$R1 < 60')
    expect(script).toContain('Sleep 500')
    expect(script).toContain('!insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0')
    expect(script).toContain('!insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1')
    expect(script).not.toContain('taskkill')
    expect(script).not.toContain('nsProcess::KillProcess')
    expect(script).not.toContain('getProcessInfo.nsh')
  })

  it('offers an opt-in uninstall section that removes TinTin user data homes (2026-10-12 用户裁决：默认不勾选)', () => {
    const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')

    // 组件页由模板在 customUnInstallSection 宏存在时自动启用（/o=默认不勾选）；
    // 段名必须字面量（LangString 缺语言表项触发 6040 警告，而 makensis 警告即错误）
    expect(script).toContain('!macro customUnInstallSection')
    expect(script).toContain('Section /o "同时删除用户数据（服务器配置/会话/素材库引用）" un.sec.DeleteUserData')
    expect(script).not.toContain('LangString unDeleteUserDataName')
    // 三处本产品自有用户数据 + DSH_HOME 重定向兜底
    expect(script).toContain('RMDir /r "$PROFILE\\.dsh-tintin"')
    expect(script).toContain('RMDir /r "$PROFILE\\.dsh"')
    expect(script).toContain('RMDir /r "$APPDATA\\tintin"')
    expect(script).toContain('ReadEnvStr $R0 "DSH_HOME"')
    // 迁移源不碰：旧客户端遗留数据不得出现在任何删除指令里
    const deletions = script.match(/RMDir \/r "[^"]+"/g) ?? []
    expect(deletions.every((line) => !line.includes('tintin-client-electron'))).toBe(true)
  })
})
