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
  readonly guideActions: Readonly<Record<Exclude<DesktopRecoveryTab, 'quick'>, string>>
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
    requestedMode: 'Recovery Mode opened manually',
    requestedBody: 'Normal startup is paused. The current Profile and plugins have not loaded.',
    currentProfile: 'Current Profile',
    currentProfileDirectory: 'Profile folder',
    failureStage: 'Startup stopped at',
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
    guideActions: { plugins: 'Manage plugins', rollback: 'View checkpoints', profiles: 'Switch Profile', data: 'Manage data', diagnostics: 'View diagnostics' },
    quickRecovery: 'Quick recovery',
    quickRecoveryBody: 'Choose a recovery option for the problem. If the cause is unclear, try Safe Mode first. If you already have a clue, go directly to plugins, checkpoints, or Profiles.',
    pluginGuideBody: 'Problems after installing or updating a plugin? Review plugins in the current Profile and uninstall third-party plugins that may be involved.',
    rollbackGuideBody: 'Unable to start after a configuration change? Choose a startup checkpoint from before the failure, then preview and restore its configuration.',
    profileSwitchGuideBody: 'Need to get back to work? Switch to another Profile or create a new configuration environment. The current Profile is kept for later investigation.',
    dataGuideBody: 'View or change the DSH data directory. A factory reset removes data from the current directory, so try other recovery options first.',
    diagnosticsGuideBody: 'View configuration files or export a diagnostic archive to investigate. Review the archive before sharing it.',
    safeMode: 'Safe Mode',
    safeModeBody: 'Start with a temporary environment without loading existing plugins, settings, conversations, or workspace records. Existing data is kept. After leaving Safe Mode, the temporary environment is removed on the next normal startup.',
    safeModeActiveBody: 'You are using a temporary environment. Existing Profiles and data are not loaded. Configuration actions here affect only the temporary environment. Restart to leave Safe Mode.',
    safeModeUnavailable: 'Safe Mode cannot be prepared at this startup stage. Diagnostics remain available.',
    enterSafeMode: 'Enter Safe Mode',
    confirmSafeMode: 'Enter Safe Mode?',
    confirmSafeModeMessage: 'Restart with a temporary environment?',
    confirmSafeModeBody: 'The app will use a separate temporary data directory without reading or changing existing Profiles or data. After leaving Safe Mode, the temporary environment is removed on the next normal startup.',
    confirmSafeModeAction: 'Restart in Safe Mode',
    safeModeNotificationTitle: 'Safe Mode is active',
    safeModeNotificationBody: 'The app is using a temporary environment without loading existing DSH data. The next normal startup restores access to existing data and removes the temporary environment.',
    checkpoints: 'Startup checkpoints',
    checkpointsUnavailable: 'Startup checkpoints cannot be read right now.',
    rollbackBody: 'Checkpoints save configuration from successful startups. Restoring one also restores the current Profile, the shared settings.yaml file, and patches in the DSH data directory.',
    plugins: 'Plugin management',
    pluginsBody: 'View plugins installed directly in the current Profile and uninstall plugins causing problems.',
    pluginsUnavailable: 'Plugin information for the current Profile has not loaded. Open Diagnostics to view configuration files or export a diagnostic archive.',
    pluginsEmpty: 'No plugins were found in the current Profile.',
    core: 'Built in',
    profileDependency: 'Directly installed plugin',
    external: 'Not directly removable',
    disabled: 'Disabled',
    uninstall: 'Uninstall',
    diagnostics: 'Diagnostic archive',
    savingDiagnostics: 'Saving a local diagnostic archive…',
    diagnosticsSaved: 'The diagnostic archive was saved locally and is never uploaded automatically.',
    diagnosticsFailed: 'Could not save the diagnostic archive. Please export it again.',
    saveDiagnostics: 'Export diagnostics',
    showDiagnostics: 'Show in folder',
    privacy: 'The archive may contain local paths, logs, system information, and crash-memory fragments. Review it before sharing.',
    configurationFiles: 'Configuration files',
    configurationFilesBody: 'View or edit the current Profile configuration and shared configuration in the DSH data directory. Restart the app to apply changes.',
    openSettingsDocument: 'Open settings.yaml',
    openProfilePatch: 'Edit Profile patch',
    openProfileManifest: 'Edit plugin manifest',
    openProfileDirectory: 'Open Profile folder',
    profiles: 'Available Profiles',
    profilesBody: 'Switch to another Desktop-compatible Profile or create a new one.',
    profilesUnavailable: 'Available Profiles have not loaded. Switching is unavailable right now.',
    profilesEmpty: 'No other Desktop-compatible Profiles are available.',
    switchProfile: 'Switch',
    addProfile: 'New Profile',
    resetAndDataManagement: 'Reset & data management',
    dataManagement: 'Data management',
    dataManagementBody: 'View or change the DSH data directory, which stores Profiles, plugins, settings, and conversations. Changing the directory does not delete data in the previous location.',
    currentDataDirectory: 'Current data directory',
    changeDataDirectory: 'Change data directory',
    restoreDefaultDataDirectory: 'Restore default',
    dataDirectoryUnavailable: 'The current data directory has not been resolved, or the app is in Safe Mode. The data directory cannot be changed right now.',
    dataDirectoryPath: 'New data directory',
    dataDirectoryPlaceholder: 'Enter the full path',
    selectDataDirectory: 'Select a DSH data directory',
    browse: 'Browse…',
    applyDataDirectory: 'Change directory and restart',
    cancelDataDirectoryChange: 'Cancel change',
    factoryReset: 'Factory reset',
    factoryResetBody: 'Move the current DSH data directory to the Trash or Recycle Bin, then restart and create a new default Profile. Project files outside this directory are kept.',
    factoryResetAction: 'Reset data and restart',
    confirmDataDirectoryChange: 'Change the data directory?',
    confirmDataDirectoryChangeMessage: 'Choose a new DSH data directory?',
    confirmDataDirectoryChangeBody: 'Choose an empty folder or an existing DSH data directory. An empty folder will be used to create a new environment. The previous data directory will be kept.',
    continueDataDirectoryChange: 'Choose directory',
    confirmRestoreDefaultDirectory: 'Restore the default data directory?',
    confirmRestoreDefaultDirectoryMessage: 'Switch to the default data directory and restart?',
    confirmRestoreDefaultDirectoryBody: 'DSH Desktop will use the default data directory for this system after restart. The current data directory will not be deleted.',
    confirmRestoreDefaultDirectoryAction: 'Restore and restart',
    confirmCreateDefaultDirectory: 'Create the default data directory?',
    confirmCreateDefaultDirectoryMessage: 'The default data directory does not exist. Create it?',
    confirmCreateDefaultDirectoryBody: 'DSH Desktop will create a new environment at the default path and use it after restart. The current data directory will not be deleted.',
    confirmCreateDefaultDirectoryAction: 'Create and restart',
    confirmFactoryReset: 'Factory reset DSH Desktop?',
    confirmFactoryResetMessage: 'Remove current DSH data and initialize a new environment?',
    confirmFactoryResetBody: currentDirectory => `The following directory will be moved to the operating-system Trash or Recycle Bin:\n\n${currentDirectory}\n\nProfiles, plugins, settings, credentials, sessions, attachments, and workspace records stored there will be removed from DSH Desktop. Project files outside this directory are not deleted. DSH Desktop will restart and create a clean default Profile.`,
    confirmFactoryResetAction: 'Reset data and restart',
    dataOperationFailedTitle: 'Data operation failed',
    dataOperationFailedMessage: 'The data directory operation did not complete. Check the error details and the current directory state before retrying.',
    openTerminal: 'Open DSH Terminal',
    emptySlot: 'No checkpoint yet',
    availableSlot: 'Ready to restore',
    noHealthyStartup: 'No configuration from a successful startup has been saved here yet.',
    openCheckpoint: 'Browse files',
    rollbackCheckpoint: 'Restore this checkpoint',
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
    confirmUninstallBody: 'Uninstall this plugin from the current Profile and update plugin dependencies.',
    confirmRollback: 'Restore this checkpoint?',
    confirmRollbackBody: capturedAt => `This immediately restores the current Profile plus the checkpointed settings.yaml and Harness-home patch captured at ${capturedAt}. After restarting, DSH Desktop will use the rolled-back configuration.`,
    confirmRollbackAction: 'Restore configuration',
    uninstalledSuccess: 'The plugin was removed from the current Profile. Restart DSH Desktop to use the updated plugin configuration.',
    rollbackSuccess: slotId => `Rolled back to ${slotId}. Restart DSH Desktop to use this configuration; the first healthy start after rollback will preserve all three existing slots.`,
    profileSelectedSuccess: 'This Profile is now selected. Restart DSH Desktop to use it.',
    actionFailed: 'Could not complete the recovery action. Check the error details, or export diagnostics to investigate further.',
    rollbackFailedTitle: 'Could not restore checkpoint',
    rollbackFailedMessage: 'Configuration restoration did not complete. Check the error details before retrying. The recovery assistant will stay open.',
    uninstallFailedTitle: 'Plugin uninstall failed',
    uninstallFailedMessage: 'Plugin removal did not complete. Check the error details and try again. The recovery assistant will stay open.',
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
    requestedMode: '已手动进入恢复模式',
    requestedBody: '已暂停正常启动，尚未加载当前 Profile 和插件。',
    currentProfile: '当前 Profile',
    currentProfileDirectory: 'Profile 目录',
    failureStage: '启动停止位置',
    stageLabels: {
      'electron-ready': 'Electron 初始化',
      'shell-environment': 'Shell 环境准备',
      'runtime-bootstrap': '桌面运行时准备',
      'profile-selection': 'Profile 选择',
      'profile-composition': '插件配置组合',
      'host-boot': '启动插件服务',
      'renderer-startup': '桌面界面启动',
      'health-commit': '确认启动结果',
    },
    tabs: { quick: '快速恢复', plugins: '插件管理', rollback: '回滚', profiles: '切换 Profile', data: '重置与数据管理', diagnostics: '诊断' },
    guideActions: { plugins: '管理插件', rollback: '查看检查点', profiles: '切换 Profile', data: '管理数据', diagnostics: '查看诊断' },
    quickRecovery: '快速恢复',
    quickRecoveryBody: '选择适合当前问题的恢复方式。不确定原因时，可先尝试安全模式；如果已有故障线索，也可以直接管理插件、恢复检查点或切换 Profile。',
    pluginGuideBody: '安装或更新插件后出现问题？查看当前 Profile 的插件，卸载可能引发问题的第三方插件。',
    rollbackGuideBody: '更新配置后无法启动？选择故障发生前的启动检查点，预览并恢复当时的配置。',
    profileSwitchGuideBody: '需要先恢复使用？切换到其他 Profile，或创建新的配置环境。当前 Profile 会保留，便于之后排查。',
    dataGuideBody: '查看或更改 DSH 数据目录。恢复出厂设置会移除当前目录中的数据，建议先尝试其他恢复方式。',
    diagnosticsGuideBody: '查看配置文件，或导出诊断包以排查问题。分享诊断包前，请先检查其中的内容。',
    safeMode: '安全模式',
    safeModeBody: '使用临时环境启动，暂不读取原有插件、设置、会话和工作区记录。原有数据会保留；退出安全模式后，下次正常启动时会自动清理临时环境。',
    safeModeActiveBody: '当前处于临时环境，原有 Profile 和数据未加载。这里的配置操作仅针对临时环境；重启后将退出安全模式。',
    safeModeUnavailable: '当前启动阶段无法创建安全模式环境，但仍可查看诊断信息。',
    enterSafeMode: '进入安全模式',
    confirmSafeMode: '进入安全模式？',
    confirmSafeModeMessage: '重启并使用临时环境？',
    confirmSafeModeBody: '应用将使用独立的临时数据目录，不读取或修改原有 Profile 和数据。退出安全模式后，下次正常启动时会自动清理临时环境。',
    confirmSafeModeAction: '重启到安全模式',
    safeModeNotificationTitle: '安全模式已启用',
    safeModeNotificationBody: '当前使用临时环境，未读取原有 DSH 数据。下次正常启动时将恢复使用原有数据，并清理临时环境。',
    checkpoints: '启动检查点',
    checkpointsUnavailable: '当前无法读取启动检查点。',
    rollbackBody: '检查点保存成功启动时的配置。选择一个检查点，将同时恢复当前 Profile、共享设置文件 settings.yaml 和 DSH 数据目录中的补丁。',
    plugins: '插件管理',
    pluginsBody: '查看当前 Profile 中直接安装的插件，并卸载引发问题的插件。',
    pluginsUnavailable: '尚未读取到当前 Profile 的插件信息。可前往“诊断”查看配置或导出诊断包。',
    pluginsEmpty: '当前 Profile 中没有插件。',
    core: '内置组件',
    profileDependency: '直接安装的插件',
    external: '不可直接卸载',
    disabled: '已禁用',
    uninstall: '卸载',
    diagnostics: '诊断包',
    savingDiagnostics: '正在保存本地诊断包…',
    diagnosticsSaved: '诊断包已保存在本地，不会自动上传。',
    diagnosticsFailed: '未能保存诊断包。请重新导出。',
    saveDiagnostics: '导出诊断信息',
    showDiagnostics: '在文件夹中显示',
    privacy: '诊断包可能包含本地路径、日志、系统信息和崩溃内存片段，分享前请先检查。',
    configurationFiles: '配置文件',
    configurationFilesBody: '查看或编辑当前 Profile 的配置与 DSH 数据目录中的共享配置。更改后需重启应用才能生效。',
    openSettingsDocument: '打开 settings.yaml',
    openProfilePatch: '编辑 Profile 补丁',
    openProfileManifest: '编辑插件清单',
    openProfileDirectory: '打开 Profile 目录',
    profiles: '可用 Profile',
    profilesBody: '切换到其他支持桌面端的 Profile，或新建一个 Profile。',
    profilesUnavailable: '尚未读取到可用 Profile，暂时无法切换。',
    profilesEmpty: '没有其他支持桌面端的 Profile。',
    switchProfile: '切换',
    addProfile: '新建 Profile',
    resetAndDataManagement: '重置与数据管理',
    dataManagement: '数据管理',
    dataManagementBody: '查看或更改 DSH 数据目录。Profile、插件、设置和会话等数据保存在此目录中；更改目录不会删除原目录中的数据。',
    currentDataDirectory: '当前数据目录',
    changeDataDirectory: '更改数据目录',
    restoreDefaultDataDirectory: '恢复默认',
    dataDirectoryUnavailable: '尚未确定当前数据目录，或应用正处于安全模式，暂时无法更改数据目录。',
    dataDirectoryPath: '新的数据目录',
    dataDirectoryPlaceholder: '输入完整路径',
    selectDataDirectory: '选择 DSH 数据目录',
    browse: '浏览…',
    applyDataDirectory: '更改目录并重启',
    cancelDataDirectoryChange: '取消更改',
    factoryReset: '恢复出厂设置',
    factoryResetBody: '将当前 DSH 数据目录移入废纸篓或回收站，然后重启并创建新的默认 Profile。此目录以外的项目文件会保留。',
    factoryResetAction: '重置数据并重启',
    confirmDataDirectoryChange: '更改数据目录？',
    confirmDataDirectoryChangeMessage: '选择新的 DSH 数据目录？',
    confirmDataDirectoryChangeBody: '请选择空文件夹或已有的 DSH 数据目录。空文件夹将用于创建新环境；原数据目录会保留。',
    continueDataDirectoryChange: '选择目录',
    confirmRestoreDefaultDirectory: '恢复默认数据目录？',
    confirmRestoreDefaultDirectoryMessage: '切换到系统默认数据目录并重启？',
    confirmRestoreDefaultDirectoryBody: 'DSH Desktop 将改为使用当前系统的默认数据目录。当前数据目录不会被删除。',
    confirmRestoreDefaultDirectoryAction: '恢复默认并重启',
    confirmCreateDefaultDirectory: '新建默认数据目录？',
    confirmCreateDefaultDirectoryMessage: '默认数据目录不存在，是否新建？',
    confirmCreateDefaultDirectoryBody: 'DSH Desktop 将在默认路径创建一个全新的环境并重启。当前数据目录不会被删除。',
    confirmCreateDefaultDirectoryAction: '新建并重启',
    confirmFactoryReset: '恢复 DSH Desktop 出厂设置？',
    confirmFactoryResetMessage: '移除当前 DSH 数据并重新初始化？',
    confirmFactoryResetBody: currentDirectory => `以下目录将被移入系统废纸篓或回收站：\n\n${currentDirectory}\n\n其中保存的 Profile、插件、设置、凭据、会话、附件和工作区记录都会从 DSH Desktop 中移除；不会删除此目录以外的项目文件。随后 DSH Desktop 会重启并创建干净的默认 Profile。`,
    confirmFactoryResetAction: '重置数据并重启',
    dataOperationFailedTitle: '数据操作失败',
    dataOperationFailedMessage: '未能完成数据目录操作。请查看错误详情，确认当前目录状态后再重试。',
    openTerminal: '打开 DSH 终端',
    emptySlot: '尚无检查点',
    availableSlot: '可恢复',
    noHealthyStartup: '此位置尚未保存成功启动时的配置。',
    openCheckpoint: '浏览文件',
    rollbackCheckpoint: '恢复此检查点',
    desktopVersion: 'DSH Desktop 版本',
    pluginCount: '插件',
    configurationFileCount: '配置文件',
    checkpointSize: '检查点大小',
    unknown: '未知',
    restart: '重启 DSH Desktop',
    quit: '退出',
    working: '正在执行恢复操作…',
    back: '返回',
    cancel: '取消',
    confirmUninstall: '卸载这个插件？',
    confirmUninstallBody: '将从当前 Profile 中卸载此插件，并更新插件依赖。',
    confirmRollback: '恢复此检查点？',
    confirmRollbackBody: capturedAt => `将立即恢复 ${capturedAt} 创建的检查点中的 Profile、共享设置文件 settings.yaml 与 DSH 数据目录补丁；重启后，DSH Desktop 将使用回滚后的配置。`,
    confirmRollbackAction: '恢复配置',
    uninstalledSuccess: '插件已从当前 Profile 中卸载。请重启 DSH Desktop 以使用更新后的插件配置。',
    rollbackSuccess: slotId => `已恢复检查点 ${slotId}。重启后将使用恢复的配置；首次成功启动时会保留现有检查点。`,
    profileSelectedSuccess: '已设为当前 Profile。请重启 DSH Desktop 以使用该 Profile。',
    actionFailed: '未能完成恢复操作。请查看错误详情；如需进一步排查，可导出诊断信息。',
    rollbackFailedTitle: '未能恢复检查点',
    rollbackFailedMessage: '配置恢复未完成。请查看错误详情，再决定是否重试。恢复助手会保持打开。',
    uninstallFailedTitle: '插件卸载失败',
    uninstallFailedMessage: '未能完成插件卸载。请查看错误详情后重试。恢复助手会保持打开。',
    operationStage: '操作阶段',
    operationStageLabels: {
      'checkpoint-restore': '恢复检查点文件',
      'dependency-materialization': 'Profile 依赖重建',
      'plugin-change': 'DSH 插件卸载',
    },
    errorCode: '错误代码',
    technicalDetails: '技术详情',
    close: '关闭',
  },
  ru: {
    title: 'Помощник восстановления DSH Desktop',
    fallbackBody: 'Не удалось прочитать данные для восстановления. Закройте и снова запустите DSH Desktop.',
    reason: 'Почему открылся режим восстановления',
    requestedMode: 'Режим восстановления открыт вручную',
    requestedBody: 'Обычный запуск приостановлен. Текущий профиль и плагины ещё не загружены.',
    currentProfile: 'Текущий профиль',
    currentProfileDirectory: 'Папка профиля',
    failureStage: 'Запуск остановился на этапе',
    stageLabels: {
      'electron-ready': 'Инициализация Electron',
      'shell-environment': 'Подготовка среды командной оболочки',
      'runtime-bootstrap': 'Подготовка среды выполнения Desktop',
      'profile-selection': 'Выбор профиля',
      'profile-composition': 'Формирование конфигурации плагинов',
      'host-boot': 'Запуск службы плагинов',
      'renderer-startup': 'Запуск интерфейса Desktop',
      'health-commit': 'Подтверждение успешного запуска',
    },
    tabs: { quick: 'Быстрое восстановление', plugins: 'Плагины', rollback: 'Откат', profiles: 'Профили', data: 'Сброс и данные', diagnostics: 'Диагностика' },
    guideActions: { plugins: 'Управлять плагинами', rollback: 'Посмотреть контрольные точки', profiles: 'Сменить профиль', data: 'Управлять данными', diagnostics: 'Открыть диагностику' },
    quickRecovery: 'Быстрое восстановление',
    quickRecoveryBody: 'Выберите подходящий способ восстановления. Если причина сбоя неизвестна, сначала попробуйте безопасный режим. Если знаете, где искать проблему, проверьте плагины, контрольные точки или профили.',
    pluginGuideBody: 'Проблема возникла после установки или обновления плагина? Проверьте плагины текущего профиля и удалите сторонние плагины, которые могли её вызвать.',
    rollbackGuideBody: 'Приложение перестало запускаться после изменения конфигурации? Выберите контрольную точку, созданную до сбоя, проверьте её и восстановите сохранённую конфигурацию.',
    profileSwitchGuideBody: 'Нужно вернуться к работе? Переключитесь на другой профиль или создайте новое окружение. Текущий профиль сохранится для последующей проверки.',
    dataGuideBody: 'Просмотрите или смените каталог данных DSH. Сброс удаляет данные из текущего каталога, поэтому сначала попробуйте другие способы восстановления.',
    diagnosticsGuideBody: 'Просмотрите файлы конфигурации или экспортируйте архив диагностики. Перед отправкой архива проверьте его содержимое.',
    safeMode: 'Безопасный режим',
    safeModeBody: 'Запуск во временном окружении без загрузки существующих плагинов, настроек, переписки и сведений о рабочих областях. Исходные данные сохранятся. После выхода из безопасного режима временное окружение будет удалено при следующем обычном запуске.',
    safeModeActiveBody: 'Вы работаете во временном окружении. Существующие профили и данные не загружены. Изменения конфигурации здесь затронут только временное окружение. Перезапустите приложение, чтобы выйти из безопасного режима.',
    safeModeUnavailable: 'На этом этапе запуска нельзя подготовить безопасный режим. Данные диагностики по-прежнему доступны.',
    enterSafeMode: 'Перейти в безопасный режим',
    confirmSafeMode: 'Перейти в безопасный режим?',
    confirmSafeModeMessage: 'Перезапустить приложение во временном окружении?',
    confirmSafeModeBody: 'Приложение будет использовать отдельный временный каталог данных, не читая и не изменяя существующие профили и данные. После выхода из безопасного режима временное окружение будет удалено при следующем обычном запуске.',
    confirmSafeModeAction: 'Перезапустить в безопасном режиме',
    safeModeNotificationTitle: 'Безопасный режим включён',
    safeModeNotificationBody: 'Приложение работает во временном окружении без загрузки существующих данных DSH. При следующем обычном запуске доступ к этим данным восстановится, а временное окружение будет удалено.',
    checkpoints: 'Контрольные точки запуска',
    checkpointsUnavailable: 'Сейчас не удаётся прочитать контрольные точки запуска.',
    rollbackBody: 'Контрольные точки сохраняют конфигурацию после успешного запуска. Восстановление контрольной точки также восстановит текущий профиль, общий файл settings.yaml и патчи в каталоге данных DSH.',
    plugins: 'Управление плагинами',
    pluginsBody: 'Просмотрите плагины, напрямую установленные в текущем профиле, и удалите те, которые вызывают проблемы.',
    pluginsUnavailable: 'Не удалось загрузить сведения о плагинах текущего профиля. На вкладке «Диагностика» можно открыть файлы конфигурации или экспортировать архив диагностики.',
    pluginsEmpty: 'В текущем профиле не найдены плагины.',
    core: 'Встроенный компонент',
    profileDependency: 'Плагин, установленный напрямую',
    external: 'Нельзя удалить напрямую',
    disabled: 'Отключён',
    uninstall: 'Удалить',
    diagnostics: 'Архив диагностики',
    savingDiagnostics: 'Сохранение локального архива диагностики…',
    diagnosticsSaved: 'Архив диагностики сохранён локально и никогда не загружается автоматически.',
    diagnosticsFailed: 'Не удалось сохранить архив диагностики. Попробуйте экспортировать его ещё раз.',
    saveDiagnostics: 'Экспортировать данные диагностики',
    showDiagnostics: 'Показать в папке',
    privacy: 'Архив может содержать локальные пути, журналы, сведения о системе и фрагменты памяти процесса. Проверьте его перед отправкой.',
    configurationFiles: 'Файлы конфигурации',
    configurationFilesBody: 'Просмотрите или измените конфигурацию текущего профиля и общую конфигурацию в каталоге данных DSH. Чтобы изменения вступили в силу, перезапустите приложение.',
    openSettingsDocument: 'Открыть settings.yaml',
    openProfilePatch: 'Изменить патч профиля',
    openProfileManifest: 'Изменить манифест плагинов',
    openProfileDirectory: 'Открыть папку профиля',
    profiles: 'Доступные профили',
    profilesBody: 'Переключитесь на другой профиль, совместимый с Desktop, или создайте новый.',
    profilesUnavailable: 'Не удалось загрузить список профилей. Сейчас переключение недоступно.',
    profilesEmpty: 'Других профилей, совместимых с Desktop, нет.',
    switchProfile: 'Переключиться',
    addProfile: 'Новый профиль',
    resetAndDataManagement: 'Сброс и управление данными',
    dataManagement: 'Управление данными',
    dataManagementBody: 'Здесь можно посмотреть или сменить каталог данных DSH, в котором хранятся профили, плагины, настройки и переписка. При смене каталога данные в прежнем месте не удаляются.',
    currentDataDirectory: 'Текущий каталог данных',
    changeDataDirectory: 'Сменить каталог данных',
    restoreDefaultDataDirectory: 'Вернуть каталог по умолчанию',
    dataDirectoryUnavailable: 'Текущий каталог данных ещё не определён или приложение работает в безопасном режиме. Сейчас сменить каталог нельзя.',
    dataDirectoryPath: 'Новый каталог данных',
    dataDirectoryPlaceholder: 'Введите полный путь',
    selectDataDirectory: 'Выберите каталог данных DSH',
    browse: 'Обзор…',
    applyDataDirectory: 'Сменить каталог и перезапустить',
    cancelDataDirectoryChange: 'Отменить смену каталога',
    factoryReset: 'Сбросить настройки и данные',
    factoryResetBody: 'Переместить текущий каталог данных DSH в системную корзину, затем перезапустить приложение и создать новый профиль по умолчанию. Файлы проектов вне этого каталога сохранятся.',
    factoryResetAction: 'Сбросить данные и перезапустить',
    confirmDataDirectoryChange: 'Сменить каталог данных?',
    confirmDataDirectoryChangeMessage: 'Выбрать новый каталог данных DSH?',
    confirmDataDirectoryChangeBody: 'Выберите пустую папку или существующий каталог данных DSH. В пустой папке будет создано новое окружение. Прежний каталог данных сохранится.',
    continueDataDirectoryChange: 'Выбрать каталог',
    confirmRestoreDefaultDirectory: 'Вернуться к каталогу данных по умолчанию?',
    confirmRestoreDefaultDirectoryMessage: 'Переключиться на каталог данных по умолчанию и перезапустить приложение?',
    confirmRestoreDefaultDirectoryBody: 'После перезапуска DSH Desktop будет использовать системный каталог данных по умолчанию. Текущий каталог удалён не будет.',
    confirmRestoreDefaultDirectoryAction: 'Вернуться и перезапустить',
    confirmCreateDefaultDirectory: 'Создать каталог данных по умолчанию?',
    confirmCreateDefaultDirectoryMessage: 'Каталог данных по умолчанию не существует. Создать его?',
    confirmCreateDefaultDirectoryBody: 'DSH Desktop создаст новое окружение по пути по умолчанию и будет использовать его после перезапуска. Текущий каталог данных удалён не будет.',
    confirmCreateDefaultDirectoryAction: 'Создать и перезапустить',
    confirmFactoryReset: 'Сбросить настройки и данные DSH Desktop?',
    confirmFactoryResetMessage: 'Удалить текущие данные DSH и создать новое окружение?',
    confirmFactoryResetBody: currentDirectory => `Следующий каталог будет перемещён в системную корзину:\n\n${currentDirectory}\n\nХранящиеся в нём профили, плагины, настройки, учётные данные, сессии, вложения и сведения о рабочих областях перестанут быть доступны в DSH Desktop. Файлы проектов вне этого каталога не удаляются. Приложение перезапустится и создаст новый профиль по умолчанию.`,
    confirmFactoryResetAction: 'Сбросить данные и перезапустить',
    dataOperationFailedTitle: 'Не удалось выполнить действие с данными',
    dataOperationFailedMessage: 'Действие с каталогом данных не завершено. Прежде чем повторять попытку, проверьте подробности ошибки и текущее состояние каталога.',
    openTerminal: 'Открыть терминал DSH',
    emptySlot: 'Контрольной точки пока нет',
    availableSlot: 'Готова к восстановлению',
    noHealthyStartup: 'Здесь ещё не сохранена конфигурация после успешного запуска.',
    openCheckpoint: 'Посмотреть файлы',
    rollbackCheckpoint: 'Восстановить эту контрольную точку',
    desktopVersion: 'Версия DSH Desktop',
    pluginCount: 'Плагины',
    configurationFileCount: 'Файлы конфигурации',
    checkpointSize: 'Размер контрольной точки',
    unknown: 'Неизвестно',
    restart: 'Перезапустить DSH Desktop',
    quit: 'Выйти',
    working: 'Выполняется выбранное действие…',
    back: 'Назад',
    cancel: 'Отмена',
    confirmUninstall: 'Удалить этот плагин?',
    confirmUninstallBody: 'Плагин будет удалён из текущего профиля, а его зависимости обновлены.',
    confirmRollback: 'Восстановить эту контрольную точку?',
    confirmRollbackBody: capturedAt => `Будут сразу восстановлены текущий профиль, общий файл settings.yaml и патч каталога DSH в состоянии на ${capturedAt}. После перезапуска DSH Desktop будет использовать восстановленную конфигурацию.`,
    confirmRollbackAction: 'Восстановить конфигурацию',
    uninstalledSuccess: 'Плагин удалён из текущего профиля. Перезапустите DSH Desktop, чтобы использовать обновлённую конфигурацию плагинов.',
    rollbackSuccess: slotId => `Восстановлена контрольная точка ${slotId}. Перезапустите DSH Desktop, чтобы использовать эту конфигурацию. Первый успешный запуск после отката сохранит все три существующие контрольные точки.`,
    profileSelectedSuccess: 'Этот профиль выбран. Перезапустите DSH Desktop, чтобы его использовать.',
    actionFailed: 'Не удалось выполнить действие по восстановлению. Проверьте подробности ошибки или экспортируйте данные диагностики.',
    rollbackFailedTitle: 'Не удалось восстановить контрольную точку',
    rollbackFailedMessage: 'Восстановление конфигурации не завершено. Проверьте подробности ошибки, прежде чем повторять попытку. Помощник восстановления останется открытым.',
    uninstallFailedTitle: 'Не удалось удалить плагин',
    uninstallFailedMessage: 'Удаление плагина не завершено. Проверьте подробности ошибки и повторите попытку. Помощник восстановления останется открытым.',
    operationStage: 'Этап операции',
    operationStageLabels: {
      'checkpoint-restore': 'Восстановление файлов контрольной точки',
      'dependency-materialization': 'Пересоздание зависимостей профиля',
      'plugin-change': 'Удаление плагина DSH',
    },
    errorCode: 'Код ошибки',
    technicalDetails: 'Технические подробности',
    close: 'Закрыть',
  },
}

export function desktopRecoveryCopy(locale: DesktopLocale): DesktopRecoveryCopy {
  return COPY[locale]
}
