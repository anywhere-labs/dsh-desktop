/** Desktop-owned native tray copy for the locales shipped by DSH. */

import type { DesktopLocale } from './runtime.ts'
import { desktopRecoveryCopy } from './recovery-copy.ts'

export type DesktopTrayLabelKey =
  | 'addProfile'
  | 'checkForUpdates'
  | 'checkingForUpdates'
  | 'downloadingUpdate'
  | 'enterSafeMode'
  | 'exportDiagnostics'
  | 'exitSafeMode'
  | 'openDesktop'
  | 'openTerminal'
  | 'profile'
  | 'quit'
  | 'reloadRenderer'
  | 'shellMode'
  | 'advanced'
  | 'compatibility'
  | 'extended'
  | 'installStable'
  | 'unavailableForDesktop'
  | 'updateAvailable'

const labels: Record<DesktopLocale, Record<DesktopTrayLabelKey, (value: string) => string>> = {
  en: {
    addProfile: () => 'New Profile…',
    checkForUpdates: () => 'Check for Updates…',
    checkingForUpdates: () => 'Checking for Updates…',
    downloadingUpdate: version => `Downloading DSH Desktop ${version}…`,
    enterSafeMode: () => 'Enter Safe Mode…',
    exportDiagnostics: () => 'Export Diagnostics…',
    exitSafeMode: () => 'Exit Safe Mode and Restart…',
    openDesktop: productName => `Open ${productName}`,
    openTerminal: () => 'Open DSH Terminal',
    profile: profileName => `Profile: ${profileName}`,
    quit: () => 'Quit',
    reloadRenderer: () => 'Reload Interface',
    shellMode: mode => `Mode: ${mode}`,
    advanced: () => 'Enhanced Mode',
    compatibility: () => 'Compatibility Mode',
    extended: () => 'Extended Window',
    installStable: () => 'Install Stable Edition…',
    unavailableForDesktop: profileName => `${profileName} (Unavailable for Desktop)`,
    updateAvailable: version => `DSH Desktop ${version} Available`,
  },
  zh: {
    addProfile: () => '新建 Profile…',
    checkForUpdates: () => '检查更新…',
    checkingForUpdates: () => '正在检查更新…',
    downloadingUpdate: version => `正在下载 DSH Desktop ${version}…`,
    enterSafeMode: () => '进入安全模式…',
    exportDiagnostics: () => '导出诊断信息…',
    exitSafeMode: () => '退出安全模式并重启…',
    openDesktop: productName => `打开 ${productName}`,
    openTerminal: () => '打开 DSH 终端',
    profile: profileName => `Profile：${profileName}`,
    quit: () => '退出',
    reloadRenderer: () => '重新加载界面',
    shellMode: mode => `模式：${mode}`,
    advanced: () => '增强模式',
    compatibility: () => '兼容模式',
    extended: () => '扩展窗口',
    installStable: () => '安装稳定版…',
    unavailableForDesktop: profileName => `${profileName}（不可用于桌面端）`,
    updateAvailable: version => `DSH Desktop ${version} 可用`,
  },
  ru: {
    addProfile: () => 'Новый профиль…',
    checkForUpdates: () => 'Проверить обновления…',
    checkingForUpdates: () => 'Проверяем обновления…',
    downloadingUpdate: version => `Загружаем DSH Desktop ${version}…`,
    enterSafeMode: () => 'Перейти в безопасный режим…',
    exportDiagnostics: () => 'Экспортировать данные диагностики…',
    exitSafeMode: () => 'Выйти из безопасного режима и перезапустить…',
    openDesktop: productName => `Открыть ${productName}`,
    openTerminal: () => 'Открыть терминал DSH',
    profile: profileName => `Профиль: ${profileName}`,
    quit: () => 'Выйти',
    reloadRenderer: () => 'Перезагрузить интерфейс',
    shellMode: mode => mode,
    advanced: () => 'Расширенный режим',
    compatibility: () => 'Режим совместимости',
    extended: () => 'Расширенное окно',
    installStable: () => 'Установить стабильную версию…',
    unavailableForDesktop: profileName => `${profileName} (недоступен в DSH Desktop)`,
    updateAvailable: version => `Доступна версия DSH Desktop ${version}`,
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

export const rendererRecoveryCopy: Record<DesktopLocale, DesktopRestartConfirmationCopy> = {
  en: {
    title: 'Restore DSH Desktop',
    message: 'The interface could not recover automatically.',
    detail: 'Automatic recovery stopped after repeated failures to avoid a restart loop. You can try again without restarting the background service. Unsent input may be lost. Export diagnostics from the tray to investigate. Choose Open DSH Desktop from the tray to return to this prompt later.',
    confirm: 'Try recovery again',
    cancel: 'Not now',
  },
  zh: {
    title: '恢复 DSH Desktop',
    message: '界面未能自动恢复。',
    detail: '自动恢复连续失败，为避免重启循环已暂停。可以再次尝试恢复，无需重启后台服务。未发送的输入可能丢失。请从托盘导出诊断信息以继续调查。稍后可从托盘选择“打开 DSH Desktop”再次打开此提示。',
    confirm: '再次尝试恢复',
    cancel: '暂不处理',
  },
  ru: {
    title: 'Восстановление DSH Desktop',
    message: 'Не удалось автоматически восстановить интерфейс.',
    detail: 'После нескольких неудачных попыток автоматическое восстановление приостановлено, чтобы избежать бесконечных перезапусков. Можно повторить попытку без перезапуска фоновой службы. Неотправленный текст может быть потерян. Для диагностики экспортируйте данные через меню приложения. Вернуться к этому окну позже можно через пункт «Открыть DSH Desktop» в меню приложения.',
    confirm: 'Повторить восстановление',
    cancel: 'Не сейчас',
  },
}

const restartConfirmationCopy: Record<DesktopLocale, Record<'normal' | 'recovery', DesktopRestartConfirmationCopy>> = {
  en: {
    normal: {
      title: 'Restart DSH Desktop',
      message: 'Restart DSH Desktop now?',
      detail: 'Running operations may be interrupted, and unsent content may be lost. Saved settings will be kept.',
      confirm: 'Restart',
      cancel: 'Cancel',
    },
    recovery: {
      title: 'Restart in Recovery Mode',
      message: 'Restart DSH Desktop in Recovery Mode?',
      detail: 'The app will open the recovery assistant before loading the current Profile and plugins. Running operations may be interrupted, and unsent content may be lost.',
      confirm: 'Restart in Recovery Mode',
      cancel: 'Cancel',
    },
  },
  zh: {
    normal: {
      title: '重启 DSH Desktop',
      message: '现在重启 DSH Desktop？',
      detail: '正在运行的操作可能中断，未发送的内容可能丢失。已保存的设置会保留。',
      confirm: '重启应用',
      cancel: '取消',
    },
    recovery: {
      title: '重启到恢复模式',
      message: '重启 DSH Desktop 并进入恢复模式？',
      detail: '应用将先打开恢复助手，暂不加载当前 Profile 和插件。正在运行的操作可能中断，未发送的内容可能丢失。',
      confirm: '重启到恢复模式',
      cancel: '取消',
    },
  },
  ru: {
    normal: {
      title: 'Перезапуск DSH Desktop',
      message: 'Перезапустить DSH Desktop сейчас?',
      detail: 'Выполняемые операции могут прерваться, а неотправленный текст — потеряться. Сохранённые настройки останутся без изменений.',
      confirm: 'Перезапустить',
      cancel: 'Отмена',
    },
    recovery: {
      title: 'Перезапуск в режиме восстановления',
      message: 'Перезапустить DSH Desktop в режиме восстановления?',
      detail: 'Перед загрузкой текущего профиля и плагинов откроется помощник восстановления. Выполняемые операции могут прерваться, а неотправленный текст — потеряться.',
      confirm: 'Перезапустить в режиме восстановления',
      cancel: 'Отмена',
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
  ru: {
    title: 'Экспорт данных диагностики',
    message: 'Перед отправкой проверьте содержимое диагностического архива.',
    detail: 'Архив содержит последние журналы приложения, локальные дампы сбоев и сведения о системе. В журналах могут быть локальные пути, идентификаторы рабочих областей и сеансов, а в дампах — фрагменты памяти процесса. Распознанные учётные данные в журналах маскируются, но перед публикацией архива всё равно проверьте его содержимое.',
    confirm: 'Экспортировать',
    cancel: 'Отмена',
  },
}

/** Resolve a native desktop locale from an Electron or browser language tag. */
export function desktopLocaleFromLanguageTag(languageTag: string): DesktopLocale {
  if (/^zh(?:[-_]|$)/i.test(languageTag)) return 'zh'
  if (/^ru(?:[-_]|$)/i.test(languageTag)) return 'ru'
  return 'en'
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
  target: 'normal' | 'recovery' | 'safe-mode' = 'normal',
): DesktopRestartConfirmationCopy {
  if (target === 'safe-mode') {
    const copy = desktopRecoveryCopy(locale)
    return {
      title: copy.confirmSafeMode,
      message: copy.confirmSafeModeMessage,
      detail: copy.confirmSafeModeBody,
      confirm: copy.confirmSafeModeAction,
      cancel: copy.cancel,
    }
  }
  return restartConfirmationCopy[locale][target]
}
