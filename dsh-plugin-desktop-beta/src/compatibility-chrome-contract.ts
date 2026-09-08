import type { DesktopLocale, DesktopPlatform } from './runtime.ts'

export const COMPATIBILITY_CHROME_CHANNEL = 'dsh-desktop:compatibility-chrome'
export const COMPATIBILITY_CHROME_STATE = 'dsh-desktop:compatibility-chrome-state'

export type CompatibilityChromeCommand = 'state' | 'check-for-updates' | 'mode-extended' | 'mode-advanced' | 'terminal' | 'restart' | 'restart-recovery' | 'reload' | 'developer' | 'expand' | 'collapse'

export interface CompatibilityChromeState {
  readonly locale: DesktopLocale
  readonly platform: DesktopPlatform
  readonly version: string
  readonly material: string
}

export interface CompatibilityChromeBridge {
  invoke(command: CompatibilityChromeCommand): Promise<CompatibilityChromeState | undefined>
  onDismiss(listener: () => void): () => void
  subscribe(listener: (state: CompatibilityChromeState) => void): () => void
}
