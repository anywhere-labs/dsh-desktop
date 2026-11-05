/** Private channels of the embedded Platform page, named as upstream Desktop names them (apps/desktop/src/platform-ipc.ts). */
export const PLATFORM_IPC = {
  bootstrap: 'dsh-platform:bootstrap',
  localeChanged: 'dsh-platform:locale-changed',
  open: 'dsh-platform:open',
  bounds: 'dsh-platform:bounds',
  close: 'dsh-platform:close',
} as const

/** Platform document language; the shell resolves the application language before sending it. */
export type PlatformLocale = 'en_US' | 'zh_CN'
