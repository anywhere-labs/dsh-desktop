/** Desktop-owned native tray copy for the locales shipped by DSH. */

import type { DesktopLocale } from './runtime.ts'

export type DesktopTrayLabelKey =
  | 'addProfile'
  | 'checkForUpdates'
  | 'checkingForUpdates'
  | 'downloadingUpdate'
  | 'exportDiagnostics'
  | 'openDesktop'
  | 'openTerminal'
  | 'profile'
  | 'quit'
  | 'switchToAdvanced'
  | 'switchToCompatibility'
  | 'switchToExtended'
  | 'unavailableForDesktop'
  | 'updateAvailable'

const labels: Record<DesktopLocale, Record<DesktopTrayLabelKey, (value: string) => string>> = {
  en: {
    addProfile: () => 'New Profile…',
    checkForUpdates: () => 'Check for Updates…',
    checkingForUpdates: () => 'Checking for Updates…',
    downloadingUpdate: version => `Downloading DSH Desktop ${version}…`,
    exportDiagnostics: () => 'Export Diagnostics…',
    openDesktop: productName => `Open ${productName}`,
    openTerminal: () => 'Open DSH Terminal',
    profile: profileName => `Profile: ${profileName}`,
    quit: () => 'Quit',
    switchToAdvanced: () => 'Switch to Enhanced Mode',
    switchToCompatibility: () => 'Switch to Compatibility Mode',
    switchToExtended: () => 'Switch to Extended Window',
    unavailableForDesktop: profileName => `${profileName} (Unavailable for Desktop)`,
    updateAvailable: version => `DSH Desktop ${version} Available`,
  },
  zh: {
    addProfile: () => '新建 Profile…',
    checkForUpdates: () => '检查更新…',
    checkingForUpdates: () => '正在检查更新…',
    downloadingUpdate: version => `正在下载 DSH Desktop ${version}…`,
    exportDiagnostics: () => '导出诊断信息…',
    openDesktop: productName => `打开 ${productName}`,
    openTerminal: () => '打开 DSH 终端',
    profile: profileName => `Profile：${profileName}`,
    quit: () => '退出',
    switchToAdvanced: () => '切换到增强模式',
    switchToCompatibility: () => '切换到兼容模式',
    switchToExtended: () => '切换到扩展窗口',
    unavailableForDesktop: profileName => `${profileName}（不可用于桌面端）`,
    updateAvailable: version => `DSH Desktop ${version} 可用`,
  },
}

export interface DesktopDiagnosticsPrivacyCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

export interface DesktopRestartConfirmationCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

const restartConfirmationCopy: Record<DesktopLocale, Record<'normal' | 'recovery', DesktopRestartConfirmationCopy>> = {
  en: {
    normal: {
      title: 'Restart DSH Desktop',
      message: 'Restart DSH Desktop now?',
      detail: 'Running operations and unsent input may be interrupted. Saved settings will not be lost.',
      confirm: 'Restart',
      cancel: 'Cancel',
    },
    recovery: {
      title: 'Restart in Recovery Mode',
      message: 'Restart DSH Desktop in Recovery Mode?',
      detail: 'The next launch opens the recovery assistant before the Profile and plugin Host start. Running operations and unsent input may be interrupted.',
      confirm: 'Restart in Recovery Mode',
      cancel: 'Cancel',
    },
  },
  zh: {
    normal: {
      title: '重启 DSH Desktop',
      message: '现在重启 DSH Desktop？',
      detail: '正在运行的操作和未发送的输入可能会中断，已保存的设置不会丢失。',
      confirm: '重启',
      cancel: '取消',
    },
    recovery: {
      title: '重启到恢复模式',
      message: '重启 DSH Desktop 并进入恢复模式？',
      detail: '下次启动会在 Profile 和插件 Host 运行前打开恢复助手。正在运行的操作和未发送的输入可能会中断。',
      confirm: '重启到恢复模式',
      cancel: '取消',
    },
  },
}

const diagnosticsPrivacyCopy: Record<DesktopLocale, DesktopDiagnosticsPrivacyCopy> = {
  en: {
    title: 'Export Diagnostics',
    message: 'Review the diagnostic archive before sharing it.',
    detail: 'The archive contains recent application logs, local crash dumps, and system information. Logs may contain local paths, workspace IDs, and session IDs. Crash dumps may contain fragments of process memory. Authentication credentials are masked in logs when recognized, but you should still review the archive before uploading it publicly.',
    confirm: 'Export',
    cancel: 'Cancel',
  },
  zh: {
    title: '导出诊断信息',
    message: '分享诊断包前请先检查其中的内容。',
    detail: '诊断包包含最近的应用日志、本地崩溃转储和系统信息。日志可能包含本地路径、工作区 ID 和会话 ID，崩溃转储可能包含进程内存片段。系统会对日志中可识别的认证凭据进行脱敏，但公开上传前仍应检查诊断包。',
    confirm: '导出',
    cancel: '取消',
  },
}

/** Resolve DSH's zh/en locale from an Electron or browser language tag. */
export function desktopLocaleFromLanguageTag(languageTag: string): DesktopLocale {
  return /^zh(?:[-_]|$)/i.test(languageTag) ? 'zh' : 'en'
}

/** Resolve one native tray label in the active desktop locale. */
export function desktopTrayLabel(
  locale: DesktopLocale,
  key: DesktopTrayLabelKey,
  value = '',
): string {
  return labels[locale][key](value)
}

/** Resolve the native privacy confirmation shown before diagnostics export. */
export function desktopDiagnosticsPrivacyCopy(locale: DesktopLocale): DesktopDiagnosticsPrivacyCopy {
  return diagnosticsPrivacyCopy[locale]
}

/** Resolve the native confirmation shown before every ordinary relaunch request. */
export function desktopRestartConfirmationCopy(
  locale: DesktopLocale,
  target: 'normal' | 'recovery' = 'normal',
): DesktopRestartConfirmationCopy {
  return restartConfirmationCopy[locale][target]
}
