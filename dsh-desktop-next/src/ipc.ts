export const IPC = {
  boot: 'dsh-next:boot', failed: 'dsh-next:failed', directory: 'dsh-next:directory',
  state: 'dsh-next:state', command: 'dsh-next:command',
  settingsOpen: 'dsh-next:settings-open', settingsTake: 'dsh-next:settings-take',
  browserLinks: 'dsh-next:browser-links',
  browserAcquire: 'dsh-next:browser-acquire', browserRelease: 'dsh-next:browser-release',
  browserOpenRequested: 'dsh-next:browser-open-requested',
  permissionQuery: 'dsh-next:permission-query', permissionRequest: 'dsh-next:permission-request', permissionSettings: 'dsh-next:permission-settings',
  material: 'dsh-next:material',
  locale: 'dsh-next:locale',
  nativeThemeSet: 'dsh-next:native-theme-set', windowsAppearance: 'dsh-next:windows-appearance', windowsMenu: 'dsh-next:windows-menu',
} as const
export const APP_URL = 'dsh-app://app/'
export const SHELL_URL = 'dsh-app://shell/index.html'
