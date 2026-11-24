/**
 * The strip's own shortcuts. They are handled here rather than through the shortcut registry: the registry rejects
 * Alt+Shift defaults on the Web and drops every default of a command when any profile is rejected.
 */

/** What a key press asks the strip to do. */
export type TabShortcut =
  | { readonly kind: 'step'; readonly delta: -1 | 1 }
  | { readonly kind: 'jump'; readonly n: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'reopen' }
  | { readonly kind: 'new' }
  | { readonly kind: 'shift'; readonly delta: -1 | 1 }

/** The parts of a keyboard event a shortcut depends on. */
export interface KeyFacts {
  readonly code: string
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
  readonly defaultPrevented: boolean
}

/**
 * The window-wide shortcut a key press means.
 *
 * | Keys | Action |
 * | --- | --- |
 * | Alt+Shift+← / → | previous / next tab |
 * | Alt+Shift+1…9 | tab by position, 9 the last |
 * | Alt+Shift+W | close the current tab |
 * | Alt+Shift+T | reopen the last closed tab |
 * | Alt+Shift+N | new Session |
 * | Shift+← / → | move the current tab (the caller checks the focus is not in text) |
 *
 * @param event - the key press.
 * @returns the shortcut, or undefined for any other key.
 */
export function tabShortcut(event: KeyFacts): TabShortcut | undefined {
  if (event.defaultPrevented || event.isComposing) return undefined
  if (event.repeat && !event.code.startsWith('Arrow')) return undefined
  if (event.ctrlKey || event.metaKey) return undefined
  const arrow = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : undefined
  if (event.altKey && event.shiftKey) {
    if (arrow !== undefined) return { kind: 'step', delta: arrow }
    const digit = /^Digit([1-9])$/.exec(event.code)
    if (digit !== null) return { kind: 'jump', n: Number(digit[1]) }
    if (event.code === 'KeyW') return { kind: 'close' }
    if (event.code === 'KeyT') return { kind: 'reopen' }
    if (event.code === 'KeyN') return { kind: 'new' }
    return undefined
  }
  if (event.shiftKey && !event.altKey && arrow !== undefined) return { kind: 'shift', delta: arrow }
  return undefined
}

/** Elements where Shift+Arrow edits text or moves inside a widget and must not move tabs. */
export const TEXT_OR_WIDGET = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],.xterm,'
  + '[role=listbox],[role=menu],[role=tree],[role=grid],[role=slider],[role=tablist],[role=radiogroup]'
