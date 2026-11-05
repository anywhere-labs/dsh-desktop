import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BOOT_RECOVERY_SCRIPT,
  DESKTOP_BOOT_RECOVERY_STYLE,
  DESKTOP_BOOT_TERMINAL_SCRIPT,
  DESKTOP_BOOT_TERMINAL_STYLE,
  DESKTOP_RECOVERY_RESTART_REQUEST,
  DESKTOP_TERMINAL_OPEN_REQUEST,
  desktopBootRecoveryInjections,
} from '../src/desktop-boot-recovery.ts'
import { DESKTOP_RECOVERY_RESTART_PATH } from '../src/desktop-settings-contract.ts'
import {
  recoverOversizedSessionProjectionCache,
  SESSION_PROJCACHE_RELATIVE_PATH,
} from '../src/session-projcache-recovery.ts'
import { routeDesktopStartupFailure } from '../src/startup-failure-routing.ts'
import type { DesktopStartupFailureStage } from '../src/startup-recovery-window.ts'

describe('Desktop early-boot recovery injection', () => {
  it('preserves the plugin-failure report and appends accessible Recovery Mode guidance', () => {
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
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('部分插件加载失败，可能与当前 DSH 版本不兼容')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('Some plugins failed to load and may be incompatible with this DSH version')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain("'aria-label': label")
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).toContain('report.append(panel)')
    expect(DESKTOP_BOOT_RECOVERY_SCRIPT).not.toContain('replaceChildren')
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

describe('Desktop startup failure routing', () => {
  const READY_STAGES: readonly DesktopStartupFailureStage[] = [
    'electron-ready',
    'shell-environment',
    'runtime-bootstrap',
    'profile-selection',
    'profile-composition',
    'host-boot',
    'renderer-startup',
    'health-commit',
  ]

  it('uses stderr before Electron is ready', () => {
    expect(routeDesktopStartupFailure({ appReady: false, stage: 'electron-ready' })).toBe('stderr-only')
  })

  it('opens unified Recovery for every app-ready startup stage', () => {
    for (const stage of READY_STAGES) {
      expect(routeDesktopStartupFailure({ appReady: true, stage })).toBe('startup-recovery')
    }
  })
})

describe('session projection cache recovery', () => {
  function fixtureHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-projcache-'))
    mkdirSync(join(home, SESSION_PROJCACHE_RELATIVE_PATH[0]))
    return home
  }

  it('quarantines an oversized cache before the runtime could parse it', () => {
    const home = fixtureHome()
    const cachePath = join(home, ...SESSION_PROJCACHE_RELATIVE_PATH)
    const oversized = 'x'.repeat(33)
    writeFileSync(cachePath, oversized)

    const recovered = recoverOversizedSessionProjectionCache(home, {
      maxBytes: 32,
      now: () => new Date('2026-08-24T08:15:16.123Z'),
    })

    expect(recovered).toMatchObject({
      status: 'quarantined',
      cachePath,
      sizeBytes: Buffer.byteLength(oversized),
    })
    expect(existsSync(cachePath)).toBe(false)
    expect(recovered.status === 'quarantined' && recovered.backupPath).toContain(
      'session_projcache.oversized-20260824T081516123Z.json',
    )
    expect(recovered.status === 'quarantined' && readFileSync(recovered.backupPath, 'utf8')).toBe(oversized)
  })

  it('leaves a bounded cache untouched', () => {
    const home = fixtureHome()
    const cachePath = join(home, ...SESSION_PROJCACHE_RELATIVE_PATH)
    writeFileSync(cachePath, 'small-cache')

    expect(recoverOversizedSessionProjectionCache(home, { maxBytes: 32 })).toEqual({
      status: 'within-limit',
      cachePath,
    })
    expect(readFileSync(cachePath, 'utf8')).toBe('small-cache')
  })
})
