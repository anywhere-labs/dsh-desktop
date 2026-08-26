/** Shared recovery copy used by the native page and its main-process actions. */

import type { DesktopLocale } from './runtime.ts'
import type { DesktopStartupRecoveryOperationStage } from './startup-recovery-controller.ts'

export type DesktopRecoveryTab = 'plugins' | 'rollback' | 'profiles' | 'diagnostics'

export type DesktopStartupFailureStage =
  | 'electron-ready'
  | 'shell-environment'
  | 'runtime-bootstrap'
  | 'profile-selection'
  | 'profile-composition'
  | 'host-boot'
  | 'renderer-startup'
  | 'health-commit'

export interface DesktopRecoveryCopy {
  readonly title: string
  readonly fallbackBody: string
  readonly reason: string
  readonly requestedMode: string
  readonly requestedBody: string
  readonly currentProfile: string
  readonly failureStage: string
  readonly stageLabels: Readonly<Record<DesktopStartupFailureStage, string>>
  readonly tabs: Readonly<Record<DesktopRecoveryTab, string>>
  readonly checkpoints: string
  readonly checkpointsUnavailable: string
  readonly rollbackBody: string
  readonly plugins: string
  readonly pluginsBody: string
  readonly pluginsUnavailable: string
  readonly pluginsEmpty: string
  readonly core: string
  readonly profileDependency: string
  readonly external: string
  readonly disabled: string
  readonly uninstall: string
  readonly diagnostics: string
  readonly savingDiagnostics: string
  readonly diagnosticsSaved: string
  readonly diagnosticsFailed: string
  readonly saveDiagnostics: string
  readonly showDiagnostics: string
  readonly privacy: string
  readonly configurationFiles: string
  readonly configurationFilesBody: string
  readonly openSettingsDocument: string
  readonly openProfilePatch: string
  readonly openProfileManifest: string
  readonly openProfileDirectory: string
  readonly profiles: string
  readonly profilesBody: string
  readonly profilesUnavailable: string
  readonly profilesEmpty: string
  readonly switchProfile: string
  readonly addProfile: string
  readonly openTerminal: string
  readonly emptySlot: string
  readonly availableSlot: string
  readonly noHealthyStartup: string
  readonly openCheckpoint: string
  readonly rollbackCheckpoint: string
  readonly desktopVersion: string
  readonly pluginCount: string
  readonly configurationFileCount: string
  readonly checkpointSize: string
  readonly unknown: string
  readonly restart: string
  readonly quit: string
  readonly working: string
  readonly cancel: string
  readonly confirmUninstall: string
  readonly confirmUninstallBody: string
  readonly confirmRollback: string
  readonly confirmRollbackBody: (capturedAt: string) => string
  readonly confirmRollbackAction: string
  readonly uninstalledSuccess: string
  readonly rollbackSuccess: (slotId: string) => string
  readonly profileSelectedSuccess: string
  readonly actionFailed: string
  readonly rollbackFailedTitle: string
  readonly rollbackFailedMessage: string
  readonly uninstallFailedTitle: string
  readonly uninstallFailedMessage: string
  readonly operationStage: string
  readonly operationStageLabels: Readonly<Record<DesktopStartupRecoveryOperationStage, string>>
  readonly errorCode: string
  readonly technicalDetails: string
  readonly close: string
}

const COPY: Record<DesktopLocale, DesktopRecoveryCopy> = {
  en: {
    title: 'DSH Desktop Recovery Assistant',
    fallbackBody: 'The recovery information could not be read. Quit and start DSH Desktop again.',
    reason: 'Why Recovery Mode opened',
    requestedMode: 'Opened from the restart menu',
    requestedBody: 'Normal startup is paused before the current Profile and plugin Host load.',
    currentProfile: 'Current Profile',
    failureStage: 'Failure stage',
    stageLabels: {
      'electron-ready': 'Electron initialization',
      'shell-environment': 'Shell environment preparation',
      'runtime-bootstrap': 'Desktop runtime preparation',
      'profile-selection': 'Profile selection',
      'profile-composition': 'Plugin configuration composition',
      'host-boot': 'Plugin Host startup',
      'renderer-startup': 'Desktop interface startup',
      'health-commit': 'Startup health confirmation',
    },
    tabs: { plugins: 'Plugin management', rollback: 'Rollback', profiles: 'Switch Profile', diagnostics: 'Diagnostics' },
    checkpoints: 'Healthy-start checkpoints',
    checkpointsUnavailable: 'Checkpoint information is unavailable for this startup stage.',
    rollbackBody: 'Choose one of the three healthy-start slots to restore the current Profile together with shared settings.yaml and the Harness-home patch.',
    plugins: 'Plugin management',
    pluginsBody: 'Remove a direct plugin dependency from the current Profile with the official DSH plugin command.',
    pluginsUnavailable: 'Plugin information is unavailable for this startup stage.',
    pluginsEmpty: 'No plugins were found in the current Profile.',
    core: 'Built in',
    profileDependency: 'Direct Profile dependency',
    external: 'Not directly removable',
    disabled: 'Disabled',
    uninstall: 'Uninstall',
    diagnostics: 'Diagnostic archive',
    savingDiagnostics: 'Saving a local diagnostic archive…',
    diagnosticsSaved: 'The diagnostic archive was saved locally and is never uploaded automatically.',
    diagnosticsFailed: 'The diagnostic archive could not be saved. You can try exporting it again.',
    saveDiagnostics: 'Export diagnostics',
    showDiagnostics: 'Show in folder',
    privacy: 'The archive may contain local paths, logs, system information, and crash-memory fragments. Review it before sharing.',
    configurationFiles: 'Configuration files',
    configurationFilesBody: 'View or edit the current Profile and shared Harness-home configuration. Restart DSH Desktop after making changes.',
    openSettingsDocument: 'Open settings.yaml',
    openProfilePatch: 'Edit Profile patch',
    openProfileManifest: 'Edit plugin manifest',
    openProfileDirectory: 'Open Profile folder',
    profiles: 'Available Profiles',
    profilesBody: 'Select another Desktop-compatible Profile or create a new one before the plugin Host starts.',
    profilesUnavailable: 'Profile switching is unavailable for this startup stage.',
    profilesEmpty: 'No other Desktop-compatible Profiles are available.',
    switchProfile: 'Switch',
    addProfile: 'New Profile',
    openTerminal: 'Open DSH Terminal',
    emptySlot: 'Empty',
    availableSlot: 'Available',
    noHealthyStartup: 'No healthy startup has been recorded in this slot.',
    openCheckpoint: 'Browse files',
    rollbackCheckpoint: 'Roll back to this slot',
    desktopVersion: 'DSH Desktop version',
    pluginCount: 'Plugins',
    configurationFileCount: 'Configuration files',
    checkpointSize: 'Checkpoint size',
    unknown: 'Unknown',
    restart: 'Restart DSH Desktop',
    quit: 'Quit',
    working: 'Applying the recovery action…',
    cancel: 'Cancel',
    confirmUninstall: 'Uninstall this plugin?',
    confirmUninstallBody: 'DSH will remove this dependency from the current Profile and reconcile its plugin layers. This does not depend on which market installed it.',
    confirmRollback: 'Roll back this configuration?',
    confirmRollbackBody: capturedAt => `This immediately restores the current Profile plus the checkpointed settings.yaml and Harness-home patch captured at ${capturedAt}. After restarting, DSH Desktop will use the rolled-back configuration.`,
    confirmRollbackAction: 'Roll Back',
    uninstalledSuccess: 'The plugin was removed from the current Profile. Restart DSH Desktop to use the updated plugin configuration.',
    rollbackSuccess: slotId => `Rolled back to ${slotId}. Restart DSH Desktop to use this configuration; the first healthy start after rollback will preserve all three existing slots.`,
    profileSelectedSuccess: 'This Profile is now selected. Restart DSH Desktop to use it.',
    actionFailed: 'The recovery action could not be completed. Review the diagnostic archive and try again.',
    rollbackFailedTitle: 'Rollback failed',
    rollbackFailedMessage: 'The rollback did not finish. The Recovery Assistant remains open so you can review the details and try again.',
    uninstallFailedTitle: 'Plugin uninstall failed',
    uninstallFailedMessage: 'The plugin was not removed. The Recovery Assistant remains open so you can review the details and try again.',
    operationStage: 'Operation stage',
    operationStageLabels: {
      'checkpoint-restore': 'Checkpoint file restore',
      'dependency-materialization': 'Profile dependency rebuild',
      'plugin-change': 'DSH plugin uninstall',
    },
    errorCode: 'Error code',
    technicalDetails: 'Technical details',
    close: 'Close',
  },
  zh: {
    title: 'DSH Desktop 恢复助手',
    fallbackBody: '无法读取恢复信息。请退出并重新启动 DSH Desktop。',
    reason: '进入恢复模式的原因',
    requestedMode: '从重启菜单主动进入',
    requestedBody: '普通启动已暂停，当前 Profile 和插件 Host 尚未加载。',
    currentProfile: '当前 Profile',
    failureStage: '失败阶段',
    stageLabels: {
      'electron-ready': 'Electron 初始化',
      'shell-environment': 'Shell 环境准备',
      'runtime-bootstrap': '桌面运行时准备',
      'profile-selection': 'Profile 选择',
      'profile-composition': '插件配置组合',
      'host-boot': '插件 Host 启动',
      'renderer-startup': '桌面界面启动',
      'health-commit': '启动健康状态确认',
    },
    tabs: { plugins: '插件管理', rollback: '回滚', profiles: '切换 Profile', diagnostics: '诊断' },
    checkpoints: '健康启动 Checkpoint',
    checkpointsUnavailable: '当前启动阶段无法读取 Checkpoint 信息。',
    rollbackBody: '从三个健康启动槽位中选择一个，同时恢复当前 Profile、共享 settings.yaml 和 DSH home 补丁。',
    plugins: '插件管理',
    pluginsBody: '使用官方 DSH 插件命令，从当前 Profile 中卸载直接依赖的插件。',
    pluginsUnavailable: '当前启动阶段无法读取插件信息。',
    pluginsEmpty: '当前 Profile 中没有插件。',
    core: '内置组件',
    profileDependency: 'Profile 直接依赖',
    external: '不可直接卸载',
    disabled: '已禁用',
    uninstall: '卸载',
    diagnostics: '诊断包',
    savingDiagnostics: '正在保存本地诊断包…',
    diagnosticsSaved: '诊断包已保存在本地，不会自动上传。',
    diagnosticsFailed: '无法保存诊断包，可以重新尝试导出。',
    saveDiagnostics: '导出诊断',
    showDiagnostics: '在文件夹中显示',
    privacy: '诊断包可能包含本地路径、日志、系统信息和崩溃内存片段，分享前请先检查。',
    configurationFiles: '配置文件',
    configurationFilesBody: '查看或编辑当前 Profile 与 DSH home 的共享配置。修改后需要重新启动 DSH Desktop。',
    openSettingsDocument: '打开 settings.yaml',
    openProfilePatch: '编辑 Profile 补丁',
    openProfileManifest: '编辑插件清单',
    openProfileDirectory: '打开 Profile 目录',
    profiles: '可用 Profile',
    profilesBody: '在插件 Host 启动前切换到其他支持桌面端的 Profile，或新建一个 Profile。',
    profilesUnavailable: '当前启动阶段无法切换 Profile。',
    profilesEmpty: '没有其他支持桌面端的 Profile。',
    switchProfile: '切换',
    addProfile: '新建 Profile',
    openTerminal: '打开 DSH 终端',
    emptySlot: '空槽位',
    availableSlot: '可回滚',
    noHealthyStartup: '此槽位尚未记录健康启动。',
    openCheckpoint: '浏览文件',
    rollbackCheckpoint: '回滚到此槽位',
    desktopVersion: 'DSH Desktop 版本',
    pluginCount: '插件',
    configurationFileCount: '配置文件',
    checkpointSize: 'Checkpoint 大小',
    unknown: '未知',
    restart: '重启 DSH Desktop',
    quit: '退出',
    working: '正在执行恢复操作…',
    cancel: '取消',
    confirmUninstall: '卸载这个插件？',
    confirmUninstallBody: 'DSH 将从当前 Profile 中移除此依赖，并重新整理插件层。无论插件由哪个市场安装，都会使用相同的卸载流程。',
    confirmRollback: '回滚这套配置？',
    confirmRollbackBody: capturedAt => `将立即恢复 ${capturedAt} 创建的 Checkpoint 中的当前 Profile、settings.yaml 与 DSH home 补丁；重启后，DSH Desktop 将使用回滚后的配置。`,
    confirmRollbackAction: '回滚',
    uninstalledSuccess: '插件已从当前 Profile 中卸载。请重启 DSH Desktop 以使用更新后的插件配置。',
    rollbackSuccess: slotId => `已回滚到${slotId}。请重启 DSH Desktop 以使用该配置；回滚后的第一次健康启动会保留现有三个槽位。`,
    profileSelectedSuccess: '已设为当前 Profile。请重启 DSH Desktop 以使用该 Profile。',
    actionFailed: '无法完成恢复操作。请检查诊断包后重试。',
    rollbackFailedTitle: '回滚失败',
    rollbackFailedMessage: '回滚未能完成。恢复助手会保持打开，你可以查看详细错误后重试。',
    uninstallFailedTitle: '插件卸载失败',
    uninstallFailedMessage: '插件未能卸载。恢复助手会保持打开，你可以查看详细错误后重试。',
    operationStage: '操作阶段',
    operationStageLabels: {
      'checkpoint-restore': 'Checkpoint 文件恢复',
      'dependency-materialization': 'Profile 依赖重建',
      'plugin-change': 'DSH 插件卸载',
    },
    errorCode: '错误代码',
    technicalDetails: '技术详情',
    close: '关闭',
  },
}

export function desktopRecoveryCopy(locale: DesktopLocale): DesktopRecoveryCopy {
  return COPY[locale]
}
