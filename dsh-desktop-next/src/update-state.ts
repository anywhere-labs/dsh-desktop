/** Serializable update progress shared by settings, recovery and the tray. */
export interface NextUpdateState {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'preparing' | 'ready' | 'installing' | 'error'
  version?: string
  received?: number
  total?: number
  error?: 'service' | 'download' | 'prepare' | 'install' | 'development' | 'unsupported'
  installable: boolean
}

export function updateLabel(state: NextUpdateState, language: string): string {
  const t = (zh: string, en: string) => language.toLowerCase().startsWith('zh') ? zh : en
  switch (state.phase) {
    case 'checking': return t('正在检查更新…', 'Checking for updates…')
    case 'current': return t('已是最新版本', 'Up to date')
    case 'available': return t(`发现新版本 ${state.version}`, `Update available: ${state.version}`)
    case 'downloading': {
      const progress = state.total ? `${Math.min(100, Math.floor((state.received ?? 0) / state.total * 100))}%` : `${Math.floor((state.received ?? 0) / 1048576)} MB`
      return t(`正在下载更新 ${progress}`, `Downloading update ${progress}`)
    }
    case 'preparing': return t('正在准备安装…', 'Preparing update…')
    case 'ready': return t(`${state.version} 已下载，安装并重启`, `${state.version} downloaded — Install and restart`)
    case 'installing': return t('正在安装并重启…', 'Installing and restarting…')
    case 'error':
      if (state.error === 'development') return t('开发环境可检查更新，请使用安装版进行更新。', 'Updates can be checked in development. Install a packaged build to update.')
      if (state.error === 'unsupported') return t('当前平台暂不支持应用内更新。', 'In-app updates are unavailable on this platform.')
      if (state.error === 'service') return t('暂时无法获取 Next 更新，请稍后重试。', 'Next updates are temporarily unavailable. Try again later.')
      return t('更新未完成，请重试。', 'The update could not be completed. Please retry.')
    default: return t('检查更新', 'Check for updates')
  }
}

export function updateAction(state: NextUpdateState): 'check-updates' | 'download-update' | 'install-update' | undefined {
  if (state.phase === 'ready') return 'install-update'
  if (state.phase === 'available' || state.phase === 'error' && state.version && state.error !== 'service') return 'download-update'
  if (['idle', 'current', 'error'].includes(state.phase)) return 'check-updates'
  return undefined
}
