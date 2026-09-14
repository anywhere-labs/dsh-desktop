import type { DesktopLocale, DesktopPlatform } from './runtime.ts'

export const COMPATIBILITY_CHROME_CHANNEL = 'dsh-desktop:compatibility-chrome'
export const COMPATIBILITY_CHROME_STATE = 'dsh-desktop:compatibility-chrome-state'

export type CompatibilityChromeCommand = 'mode-compatibility' | 'state' | 'check-for-updates' | 'mode-extended' | 'mode-advanced' | 'terminal' | 'restart' | 'restart-recovery' | 'reload' | 'developer' | 'expand' | 'collapse' | 'remote-control'

export interface CompatibilityChromeState {
  readonly mode: 'compatibility' | 'extended'
  readonly locale: DesktopLocale
  readonly platform: DesktopPlatform
  readonly version: string
  readonly material: string
  readonly remoteControl?: { readonly enabled: boolean; readonly seen: boolean }
}

export interface CompatibilityChromeBridge {
  invoke(command: CompatibilityChromeCommand): Promise<CompatibilityChromeState | undefined>
  onDismiss(listener: () => void): () => void
  subscribe(listener: (state: CompatibilityChromeState) => void): () => void
}
