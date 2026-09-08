/** Shared recovery copy used by the native page and its main-process actions. */

import type { DesktopLocale } from './runtime.ts'
import type { DesktopStartupRecoveryOperationStage } from './startup-recovery-controller.ts'

export type DesktopRecoveryTab = 'quick' | 'plugins' | 'rollback' | 'profiles' | 'data' | 'diagnostics'

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
  readonly currentProfileDirectory: string
  readonly failureStage: string
  readonly stageLabels: Readonly<Record<DesktopStartupFailureStage, string>>
  readonly tabs: Readonly<Record<DesktopRecoveryTab, string>>
  readonly quickRecovery: string
  readonly quickRecoveryBody: string
  readonly pluginGuideBody: string
  readonly rollbackGuideBody: string
  readonly profileSwitchGuideBody: string
  readonly dataGuideBody: string
  readonly diagnosticsGuideBody: string
  readonly safeMode: string
  readonly safeModeBody: string
  readonly safeModeActiveBody: string
  readonly safeModeUnavailable: string
  readonly enterSafeMode: string
  readonly confirmSafeMode: string
  readonly confirmSafeModeMessage: string
  readonly confirmSafeModeBody: string
  readonly confirmSafeModeAction: string
  readonly safeModeNotificationTitle: string
  readonly safeModeNotificationBody: string
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
  readonly resetAndDataManagement: string
  readonly dataManagement: string
  readonly dataManagementBody: string
  readonly currentDataDirectory: string
  readonly changeDataDirectory: string
  readonly restoreDefaultDataDirectory: string
  readonly dataDirectoryUnavailable: string
  readonly dataDirectoryPath: string
  readonly dataDirectoryPlaceholder: string
  readonly selectDataDirectory: string
  readonly browse: string
  readonly applyDataDirectory: string
  readonly cancelDataDirectoryChange: string
  readonly factoryReset: string
  readonly factoryResetBody: string
  readonly factoryResetAction: string
  readonly confirmDataDirectoryChange: string
  readonly confirmDataDirectoryChangeMessage: string
  readonly confirmDataDirectoryChangeBody: string
  readonly continueDataDirectoryChange: string
  readonly confirmRestoreDefaultDirectory: string
  readonly confirmRestoreDefaultDirectoryMessage: string
  readonly confirmRestoreDefaultDirectoryBody: string
  readonly confirmRestoreDefaultDirectoryAction: string
  readonly confirmCreateDefaultDirectory: string
  readonly confirmCreateDefaultDirectoryMessage: string
  readonly confirmCreateDefaultDirectoryBody: string
  readonly confirmCreateDefaultDirectoryAction: string
  readonly confirmFactoryReset: string
  readonly confirmFactoryResetMessage: string
  readonly confirmFactoryResetBody: (currentDirectory: string) => string
  readonly confirmFactoryResetAction: string
  readonly dataOperationFailedTitle: string
  readonly dataOperationFailedMessage: string
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
  readonly back: string
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
    currentProfileDirectory: 'Profile folder',
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
    tabs: { quick: 'Quick recovery', plugins: 'Plugin management', rollback: 'Rollback', profiles: 'Switch Profile', data: 'Reset & data', diagnostics: 'Diagnostics' },
    quickRecovery: 'Quick recovery',
    quickRecoveryBody: 'Start with Safe Mode, then use the recovery tabs from left to right. Each option below explains when to move to the next step. Restart after making a change.',
    pluginGuideBody: 'If the problem disappears in Safe Mode, open Plugin management and try uninstalling the plugin most likely to be causing the problem from the current Profile.',
    rollbackGuideBody: 'If removing one plugin is not enough, restore a healthy-start checkpoint from before the failure.',
    profileSwitchGuideBody: 'Switch to another Profile or create a new one to restore normal Desktop use while keeping the current Profile for later investigation.',
    dataGuideBody: 'Change the folder used to load data. Use factory reset only when all earlier recovery options have failed.',
    diagnosticsGuideBody: 'Export a local diagnostic archive or open the current configuration files when you need to investigate or ask for help.',
    safeMode: 'Safe Mode',
    safeModeBody: 'Safe Mode creates a disposable DSH home under Desktop private data. It does not read your normal DSH data directory, so its plugins, settings, sessions, and workspaces start clean. The environment is deleted on the next normal launch after you quit or restart Safe Mode.',
    safeModeActiveBody: 'This recovery session already belongs to Safe Mode. You can roll it back or switch its temporary Profile, then restart to leave Safe Mode.',
    safeModeUnavailable: 'Safe Mode cannot be prepared at this startup stage. Diagnostics remain available.',
    enterSafeMode: 'Enter Safe Mode',
    confirmSafeMode: 'Enter Safe Mode?',
    confirmSafeModeMessage: 'Restart with a clean, temporary DSH environment?',
    confirmSafeModeBody: 'DSH Desktop will create an isolated DSH home without reading your normal DSH data directory. Your normal Profiles and data are not changed. The temporary environment is deleted on the next normal launch after you leave Safe Mode.',
    confirmSafeModeAction: 'Restart in Safe Mode',
    safeModeNotificationTitle: 'Safe Mode is active',
    safeModeNotificationBody: 'This session uses a temporary DSH home instead of your normal DSH data directory. Restart or quit, then launch normally to delete it and return to your usual environment.',
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
    resetAndDataManagement: 'Reset & data management',
    dataManagement: 'Data management',
    dataManagementBody: 'This shows the DSH data directory currently used by the Desktop app. Profiles, plugins, settings, sessions, and other data are loaded from and saved to this directory. Changing directories does not delete data in the original directory.',
    currentDataDirectory: 'Current data directory',
    changeDataDirectory: 'Change data directory',
    restoreDefaultDataDirectory: 'Restore default',
    dataDirectoryUnavailable: 'Data management is unavailable before the active DSH Home is resolved or while Safe Mode is active.',
    dataDirectoryPath: 'New data directory',
    dataDirectoryPlaceholder: 'Enter the full path',
    selectDataDirectory: 'Select a DSH data directory',
    browse: 'Browse…',
    applyDataDirectory: 'Change directory and restart',
    cancelDataDirectoryChange: 'Cancel change',
    factoryReset: 'Factory reset',
    factoryResetBody: 'Move the current DSH data directory to the operating-system Trash or Recycle Bin, then restart and rebuild a clean default Profile. Project files outside that directory are not deleted.',
    factoryResetAction: 'Reset and reinstall',
    confirmDataDirectoryChange: 'Change the data directory?',
    confirmDataDirectoryChangeMessage: 'Continue to choose a new DSH data directory?',
    confirmDataDirectoryChangeBody: 'We recommend using a path without Chinese characters.\n\nIf the target folder is empty, DSH Desktop will create a new environment. The old data directory will not be deleted.',
    continueDataDirectoryChange: 'Continue',
    confirmRestoreDefaultDirectory: 'Restore the default data directory?',
    confirmRestoreDefaultDirectoryMessage: 'Switch to the default data directory and restart?',
    confirmRestoreDefaultDirectoryBody: 'DSH Desktop will use the default data directory for this system after restart. The current data directory will not be deleted.',
    confirmRestoreDefaultDirectoryAction: 'Restore and restart',
    confirmCreateDefaultDirectory: 'Create the default data directory?',
    confirmCreateDefaultDirectoryMessage: 'The default data directory does not exist. Create it?',
    confirmCreateDefaultDirectoryBody: 'DSH Desktop will create a new environment at the default path and use it after restart. The current data directory will not be deleted.',
    confirmCreateDefaultDirectoryAction: 'Create and restart',
    confirmFactoryReset: 'Factory reset DSH Desktop?',
    confirmFactoryResetMessage: 'Remove all data in the current DSH data directory and reinstall?',
    confirmFactoryResetBody: currentDirectory => `The following directory will be moved to the operating-system Trash or Recycle Bin:\n\n${currentDirectory}\n\nProfiles, plugins, settings, credentials, sessions, attachments, and workspace records stored there will be removed from DSH Desktop. Project files outside this directory are not deleted. DSH Desktop will restart and create a clean default Profile.`,
    confirmFactoryResetAction: 'Reset and reinstall',
    dataOperationFailedTitle: 'Data operation failed',
    dataOperationFailedMessage: 'The data directory was not changed. Choose an empty folder or an existing valid DSH data directory, then try again.',
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
    back: 'Back',
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
    currentProfileDirectory: 'Profile 目录',
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
    tabs: { quick: '快速恢复', plugins: '插件管理', rollback: '回滚', profiles: '切换 Profile', data: '重置与数据管理', diagnostics: '诊断' },
    quickRecovery: '快速恢复',
    quickRecoveryBody: '建议先进入安全模式，再按照上方导航从左到右逐步处理。下面会说明每一步适合解决的问题；完成修改后需要重启才能生效。',
    pluginGuideBody: '如果问题在安全模式中消失，可以进入“插件管理”，从当前 Profile 尝试卸载最可能引发异常的插件。',
    rollbackGuideBody: '如果仅卸载插件仍无法恢复，请选择故障发生前的健康启动 Checkpoint 进行回滚。',
    profileSwitchGuideBody: '切换到其他或新建 Profile，可以先恢复桌面端的正常使用，同时保留当前 Profile 供后续排查。',
    dataGuideBody: '可以更改用于加载数据的文件夹；只有前面的恢复方式都无效时，才建议执行恢复出厂设置。',
    diagnosticsGuideBody: '需要进一步排查或寻求帮助时，可导出本地诊断包，并查看当前配置文件。',
    safeMode: '安全模式',
    safeModeBody: '安全模式会在桌面版私有数据目录中创建一次性的 DSH Home，不读取当前正常使用的 DSH 数据目录，因此插件、设置、会话和工作区记录都会从全新环境开始。退出或重启安全模式后，下一次普通启动会自动删除该环境。',
    safeModeActiveBody: '当前恢复流程已处于安全模式。你可以回滚或切换临时 Profile；重启后将退出安全模式。',
    safeModeUnavailable: '当前启动阶段无法创建安全模式环境，但仍可查看诊断信息。',
    enterSafeMode: '进入安全模式',
    confirmSafeMode: '进入安全模式？',
    confirmSafeModeMessage: '使用全新的一次性 DSH 环境重启？',
    confirmSafeModeBody: 'DSH Desktop 将创建一个不读取正常 DSH 数据目录的独立 DSH Home，不会修改原有 Profile 和数据。退出安全模式后，下一次普通启动会自动删除临时环境。',
    confirmSafeModeAction: '重启到安全模式',
    safeModeNotificationTitle: '安全模式已启用',
    safeModeNotificationBody: '当前使用临时 DSH Home，不会读取正常 DSH 数据目录。重启或退出后再普通启动，即会删除临时环境并返回原有环境。',
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
    resetAndDataManagement: '重置与数据管理',
    dataManagement: '数据管理',
    dataManagementBody: '这里显示当前桌面端正在使用的 DSH 数据目录。Profile、插件、设置和会话等数据会从该目录加载和保存；更改目录不会删除原目录中的数据。',
    currentDataDirectory: '当前数据目录',
    changeDataDirectory: '更改数据目录',
    restoreDefaultDataDirectory: '恢复默认',
    dataDirectoryUnavailable: '尚未解析出当前 DSH Home，或正处于安全模式，因此暂时无法管理用户数据目录。',
    dataDirectoryPath: '新的数据目录',
    dataDirectoryPlaceholder: '输入完整路径',
    selectDataDirectory: '选择 DSH 数据目录',
    browse: '浏览…',
    applyDataDirectory: '更改目录并重启',
    cancelDataDirectoryChange: '取消更改',
    factoryReset: '恢复出厂设置',
    factoryResetBody: '将当前 DSH 数据目录移入系统废纸篓或回收站，然后重启并重新创建干净的默认 Profile。不会删除该目录以外的项目文件。',
    factoryResetAction: '重置并重装',
    confirmDataDirectoryChange: '更改数据目录？',
    confirmDataDirectoryChangeMessage: '继续选择新的 DSH 数据目录？',
    confirmDataDirectoryChangeBody: '建议不要使用中文路径。\n\n目标文件夹如果为空，则DSH Desktop 会创建一个全新的环境；旧数据目录不会被删除。',
    continueDataDirectoryChange: '继续',
    confirmRestoreDefaultDirectory: '恢复默认数据目录？',
    confirmRestoreDefaultDirectoryMessage: '切换到系统默认数据目录并重启？',
    confirmRestoreDefaultDirectoryBody: 'DSH Desktop 将改为使用当前系统的默认数据目录。当前数据目录不会被删除。',
    confirmRestoreDefaultDirectoryAction: '恢复默认并重启',
    confirmCreateDefaultDirectory: '新建默认数据目录？',
    confirmCreateDefaultDirectoryMessage: '默认数据目录不存在，是否新建？',
    confirmCreateDefaultDirectoryBody: 'DSH Desktop 将在默认路径创建一个全新的环境并重启。当前数据目录不会被删除。',
    confirmCreateDefaultDirectoryAction: '新建并重启',
    confirmFactoryReset: '恢复 DSH Desktop 出厂设置？',
    confirmFactoryResetMessage: '删除当前 DSH 数据目录中的全部数据并重装？',
    confirmFactoryResetBody: currentDirectory => `以下目录将被移入系统废纸篓或回收站：\n\n${currentDirectory}\n\n其中保存的 Profile、插件、设置、凭据、会话、附件和工作区记录都会从 DSH Desktop 中移除；不会删除此目录以外的项目文件。随后 DSH Desktop 会重启并创建干净的默认 Profile。`,
    confirmFactoryResetAction: '重置并重装',
    dataOperationFailedTitle: '数据操作失败',
    dataOperationFailedMessage: '数据目录没有发生更改。请选择空文件夹或已有的合法 DSH 数据目录后重试。',
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
    back: '返回',
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
