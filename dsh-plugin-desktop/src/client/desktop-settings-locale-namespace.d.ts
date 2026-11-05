import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-owned settings and workspace-directory copy. */
    'desktop.settings': DesktopSettingsLocaleKey
  }
}
