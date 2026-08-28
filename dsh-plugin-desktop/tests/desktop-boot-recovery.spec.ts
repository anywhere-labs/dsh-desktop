import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BOOT_RECOVERY_SCRIPT,
  DESKTOP_BOOT_RECOVERY_STYLE,
  DESKTOP_BOOT_TERMINAL_STYLE,
  DESKTOP_BOOT_TERMINAL_SCRIPT,
  DESKTOP_RECOVERY_RESTART_REQUEST,
  DESKTOP_TERMINAL_OPEN_REQUEST,
  desktopBootRecoveryInjections,
} from '../src/desktop-boot-recovery.ts'
import { DESKTOP_RECOVERY_RESTART_PATH } from '../src/desktop-settings-contract.ts'

describe('Desktop early-boot recovery injection', () => {
  it('replaces the plugin-failure card with one accessible Recovery Mode action', () => {
    expect(desktopBootRecoveryInjections()).toEqual([
      { kind: 'style', text: DESKTOP_BOOT_RECOVERY_STYLE },
      { kind: 'script', placement: 'body', text: DESKTOP_BOOT_RECOVERY_SCRIPT },
    ])
    expect(DESKTOP_BOOT_TERMINAL_STYLE).toBe(DESKTOP_BOOT_RECOVERY_STYLE)
    expect(DESKTOP_BOOT_TERMINAL_SCRIPT).toBe(DESKTOP_BOOT_RECOVERY_SCRIPT)
    expect(DESKTOP_TERMINAL_OPEN_REQUEST).toBe(DESKTOP_RECOVERY_RESTART_REQUEST)
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('Failed to load plugins')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain(DESKTOP_RECOVERY_RESTART_PATH)
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain(JSON.stringify(DESKTOP_RECOVERY_RESTART_REQUEST))
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('打开恢复模式 / Open Recovery Mode')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain("'aria-label': label")
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('container.replaceChildren(panel)')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('const response = await fetch(endpoint, request)')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('button.disabled = false')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT.match(/element\('button'/gu)).toHaveLength(1)
    expect(() => Function(DESKTOP_BOOT_RECOVERY_SCRIPT)).not.toThrow()
  })

  it('contains no retired diagnostic, terminal, Profile, confirmation, retry, or refresh UI', () => {
    for (const retired of [
      '/api/desktop/terminal/open',
      '/api/desktop/diagnostics/export',
      '/api/desktop/settings',
      '/api/desktop/profiles/create-window',
      '/api/desktop/profiles/select',
      '打开 DSH 终端 / Open DSH Terminal',
      '导出诊断 / Export Diagnostics',
      '切换 Profile / Switch Profile',
      'Restart in Recovery Mode',
      'Retry',
      'Refresh',
      'role: \'status\'',
    ]) expect(DESKTOP_BOOT_RECOVERY_SCRIPT).not.toContain(retired)
    expect(DESKTOP_BOOT_RECOVERY_STYLE).not.toContain('select')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).not.toContain('data-dsh-recovery-status')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).not.toContain('data-dsh-recovery-confirm')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).toContain('[data-dsh-desktop-recovery]')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).toContain('--dsw-alias-button-primary-fill')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).toContain(':focus-visible')
    expect(DESKTOP_BOOT_RECOVERY_STYLE).toContain('prefers-color-scheme: dark')
  })
})
