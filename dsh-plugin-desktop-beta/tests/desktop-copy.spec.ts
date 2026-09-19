import { describe, expect, it } from 'vitest'
import { desktopNativeCopy } from '../src/native-dialog-copy.ts'
import { desktopProfileCreateCopy } from '../src/profile-create-copy.ts'
import { desktopRecoveryCopy } from '../src/recovery-copy.ts'
import { desktopRestartConfirmationCopy, desktopTrayLabel } from '../src/tray-locale.ts'

describe('Desktop product copy', () => {
  it.each(['en', 'zh'] as const)('reuses the Safe Mode confirmation in %s native menus', locale => {
    const copy = desktopRecoveryCopy(locale)
    expect(desktopTrayLabel(locale, 'enterSafeMode')).toBe(locale === 'zh' ? '进入安全模式…' : 'Enter Safe Mode…')
    expect(desktopRestartConfirmationCopy(locale, 'safe-mode')).toEqual({
      title: copy.confirmSafeMode,
      message: copy.confirmSafeModeMessage,
      detail: copy.confirmSafeModeBody,
      confirm: copy.confirmSafeModeAction,
      cancel: copy.cancel,
    })
  })

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
    expect(copy.tabs.quick).toBe('快速恢复')
    expect(copy.tabs.data).toBe('重置与数据管理')
    expect(copy.tabs.diagnostics).toBe('诊断')
    expect(copy.tabs.rollback).toBe('回滚')
    expect(copy.rollbackCheckpoint).toBe('恢复此检查点')
    expect(copy.back).toBe('返回')
    const confirmation = copy.confirmRollbackBody('2026/8/25 10:00:00')
    for (const scope of ['2026/8/25 10:00:00', 'Profile', 'settings.yaml', 'DSH 数据目录补丁']) expect(confirmation).toContain(scope)
    expect(copy.safeModeBody).toContain('原有数据会保留')
    expect(copy.safeModeBody).toContain('下次正常启动时会自动清理临时环境')
    expect(copy.safeModeActiveBody).toContain('配置操作仅针对临时环境')
    expect(copy.safeModeNotificationBody).toContain('恢复使用原有数据')
    expect(copy.quickRecoveryBody).toContain('安全模式')
    expect(copy.pluginGuideBody).toContain('第三方插件')
    expect(copy.profileSwitchGuideBody).toContain('当前 Profile 会保留')
    expect(copy.dataGuideBody).toContain('移除当前目录中的数据')
    expect(copy.dataManagementBody).toContain('更改目录不会删除原目录中的数据')
    expect(copy.confirmDataDirectoryChangeBody).toContain('原数据目录会保留')
    expect(copy.factoryResetAction).toBe('重置数据并重启')
    expect(copy.restoreDefaultDataDirectory).toBe('恢复默认')
    expect(copy.confirmRestoreDefaultDirectoryBody).toContain('当前数据目录不会被删除')
    expect(copy.confirmCreateDefaultDirectoryMessage).toBe('默认数据目录不存在，是否新建？')
    expect(copy.confirmCreateDefaultDirectoryBody).toContain('全新的环境')
    expect(copy.confirmCreateDefaultDirectoryBody).toContain('当前数据目录不会被删除')
    expect(JSON.stringify(copy)).not.toContain('~/.dsh')
    expect(copy.confirmFactoryResetBody('/Users/example/.dsh')).toContain('/Users/example/.dsh')
    expect(copy.confirmFactoryResetBody('/Users/example/.dsh')).toContain('不会删除此目录以外的项目文件')
  })

  it('ships localized native update and failure dialogs', () => {
    const copy = desktopNativeCopy('zh')
    expect(copy.updateCheckFailedTitle).toBe('无法检查更新')
    expect(copy.terminalErrorTitle).toBe('无法打开 DSH 终端')
    expect(copy.diagnosticsErrorTitle).toBe('无法导出诊断信息')
    expect(copy.updateAvailableMessage('2.1.0')).toBe('DSH Desktop 2.1.0 已可用。')
  })

  it('explains cross-channel Profile risk and routes users to Profile selection', () => {
    const copy = desktopNativeCopy('zh')
    expect(copy.profileCompatibilityMessage('work', 'DSH Desktop'))
      .toBe('当前 Profile“work”最后一次使用的桌面版本与当前版本不同：')
    expect(copy.profileCompatibilityDetail('2.0.4', '0.1.1-rc.2', 'DSH Desktop Beta', '2.0.5-beta.2', '0.1.2-alpha.5'))
      .toBe('最后一次的桌面版/DSH 版本：2.0.4/0.1.1-rc.2\n当前的桌面版/DSH 版本：2.0.5-beta.2/0.1.2-alpha.5')
    expect(copy.profileCompatibilityUnknownDetail('DSH Desktop Beta', '2.0.5-beta.2', '0.1.2-alpha.5'))
      .toBe('最后一次的桌面版/DSH 版本：未知/未知\n当前的桌面版/DSH 版本：2.0.5-beta.2/0.1.2-alpha.5')
    expect(copy.profileCompatibilityWarning).toBe('DSH 版本差异可能会导致：\n1. 历史会话信息加载出错；\n2. 当前 Profile 下的部分插件不兼容，甚至引发报错或崩溃。\n建议您切换到兼容的 Profile，或创建新的 Profile。')
    expect(copy.switchProfile).toBe('切换 Profile')
  })
})
