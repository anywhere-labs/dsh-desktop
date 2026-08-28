import { describe, expect, it } from 'vitest'
import { desktopNativeCopy } from '../src/native-dialog-copy.ts'
import { desktopProfileCreateCopy } from '../src/profile-create-copy.ts'
import { desktopRecoveryCopy } from '../src/recovery-copy.ts'
import { desktopTrayLabel } from '../src/tray-locale.ts'

describe('Desktop product copy', () => {
  it('uses Profile consistently for product-level configuration sets', () => {
    expect(desktopProfileCreateCopy('zh')).toMatchObject({
      title: '新建 Profile',
      label: 'Profile 名称',
      submit: '创建 Profile',
    })
    expect(desktopTrayLabel('zh', 'profile', 'work')).toBe('Profile：work')
    expect(desktopTrayLabel('zh', 'addProfile')).toBe('新建 Profile…')
  })

  it('separates Recovery Mode from checkpoint rollback', () => {
    const copy = desktopRecoveryCopy('zh')
    expect(copy.tabs.rollback).toBe('回滚')
    expect(copy.rollbackCheckpoint).toBe('回滚到此槽位')
    expect(copy.confirmRollbackBody('2026/8/25 10:00:00')).toContain('当前 Profile')
    expect(copy.confirmRollbackBody('2026/8/25 10:00:00')).toContain('settings.yaml')
    expect(copy.confirmRollbackBody('2026/8/25 10:00:00')).toContain('DSH home 补丁')
  })

  it('ships localized native update and failure dialogs', () => {
    const copy = desktopNativeCopy('zh')
    expect(copy.updateCheckFailedTitle).toBe('无法检查更新')
    expect(copy.terminalErrorTitle).toBe('无法打开 DSH 终端')
    expect(copy.diagnosticsErrorTitle).toBe('无法导出诊断信息')
    expect(copy.updateAvailableMessage('2.1.0')).toBe('DSH Desktop 2.1.0 已可用。')
  })
})
