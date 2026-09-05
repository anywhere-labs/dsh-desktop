/** Shared validation and keyboard-event conversion for Desktop global shortcuts. */

export const DEFAULT_QUICK_ASK_SHORTCUT = 'CommandOrControl+Shift+K'
export const DEFAULT_MAIN_WINDOW_SHORTCUT = 'CommandOrControl+Shift+Space'

const MODIFIERS = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Option', 'AltGr', 'Shift', 'Super'])
const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'Plus', 'VolumeUp', 'VolumeDown', 'VolumeMute',
  'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen',
])

/** Accept a conservative, cross-platform subset of Electron Accelerator syntax. */
export function isDesktopShortcut(value: string): boolean {
  if (value.length === 0 || value.length > 80 || value.trim() !== value) return false
  const parts = value.split('+')
  if (parts.length < 2 || parts.some(part => part.length === 0)) return false
  const key = parts.at(-1) as string
  const modifiers = parts.slice(0, -1)
  if (new Set(modifiers).size !== modifiers.length || modifiers.some(part => !MODIFIERS.has(part))) return false
  if (modifiers.includes('CommandOrControl') && (modifiers.includes('Command') || modifiers.includes('Control'))) return false
  if (modifiers.includes('Alt') && modifiers.includes('Option')) return false
  return /^[A-Z0-9]$/u.test(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key) || NAMED_KEYS.has(key)
}

const EVENT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Enter', Tab: 'Tab',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape',
})

/** Convert one browser keydown into the canonical Electron Accelerator shown in settings. */
export function desktopShortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | undefined {
  if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift') return undefined
  const modifiers: string[] = []
  if (event.metaKey || event.ctrlKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (modifiers.length === 0) return undefined
  const key = EVENT_KEYS[event.key] ?? (/^[a-z0-9]$/iu.test(event.key) ? event.key.toUpperCase() : /^F(?:[1-9]|1[0-9]|2[0-4])$/iu.test(event.key) ? event.key.toUpperCase() : undefined)
  if (key === undefined) return undefined
  const shortcut = [...modifiers, key].join('+')
  return isDesktopShortcut(shortcut) ? shortcut : undefined
}
