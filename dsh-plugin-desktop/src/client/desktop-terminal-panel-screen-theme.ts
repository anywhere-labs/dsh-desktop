/**
 * xterm theme and cursor handling for the terminal panel screen. Vendored
 * from upstream `ui-sidebar-terminal` (terminal-theme.ts / terminal-cursor.ts,
 * MIT): the client plugin rules forbid importing another feature plugin's
 * values, and the desktop package cannot promote shared code upstream.
 * Keep behavior identical; only the module boundary is new.
 */
import type { IDisposable, ITheme, Terminal } from '@xterm/xterm'

/* oxlint-disable typescript/no-non-null-assertion -- OSC widths/indices are checked; DSH defaults precede cursor reads. */
const ansiKeys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
const specialKeys = ['foreground', 'background', 'cursor'] as const

/** Keep program color overrides separate from the DSH defaults used by OSC resets. */
export class TerminalScreenTheme implements IDisposable {
  private defaults: ITheme = {}
  private readonly indexed = new Map<number, string>()
  private readonly special = new Map<(typeof specialKeys)[number], string>()
  private readonly subscriptions: IDisposable[]

  /**
   * Observe complete OSC commands without consuming xterm's queries or color handling.
   * @param terminal - opened emulator owned by the mounted screen.
   */
  constructor(private readonly terminal: Terminal) {
    const observe = (code: number, change: (data: string) => void): IDisposable =>
      terminal.parser.registerOscHandler(code, (data) => { change(data); return false })
    this.subscriptions = [
      observe(4, (data) => {
        const parts = data.split(';')
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const index = colorIndex(parts[i]!)
          const color = oscColor(parts[i + 1]!)
          if (index !== undefined && color !== undefined) this.indexed.set(index, color)
        }
      }),
      observe(104, (data) => {
        if (data === '') this.indexed.clear()
        else for (const part of data.split(';')) {
          const index = colorIndex(part)
          if (index !== undefined) this.indexed.delete(index)
        }
        this.apply()
      }),
      ...specialKeys.flatMap((key, offset) => [
        observe(10 + offset, (data) => {
          for (const [i, part] of data.split(';').entries()) {
            const target = specialKeys[offset + i]
            const color = oscColor(part)
            if (target !== undefined && color !== undefined) this.special.set(target, color)
          }
        }),
        observe(110 + offset, () => { this.special.delete(key); this.apply() }),
      ]),
    ]
  }

  /**
   * Apply changed DSH colors without replacing application-defined palette entries.
   * @param background - resolved opaque DSH background.
   * @param foreground - resolved DSH text color.
   */
  update(background: string, foreground: string): void {
    if (this.defaults.background === background && this.defaults.foreground === foreground) return
    this.defaults = {
      background, foreground, cursor: foreground, cursorAccent: background,
      selectionBackground: foreground, selectionForeground: background, selectionInactiveBackground: foreground,
    }
    this.apply()
  }

  /** Preferred cursor color after the initial DSH update, including OSC 12 overrides. */
  get cursor(): string { return this.special.get('cursor') ?? this.defaults.cursor! }

  /** Remove parser observers before the emulator is disposed. */
  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose() }

  private apply(): void {
    const theme: ITheme = { ...this.defaults, ...Object.fromEntries(this.special) }
    for (const [index, color] of this.indexed) {
      if (index < ansiKeys.length) theme[ansiKeys[index]!] = color
      else (theme.extendedAnsi ??= [])[index - ansiKeys.length] = color
    }
    this.terminal.options.theme = theme
  }
}

function colorIndex(value: string): number | undefined {
  return /^\d+$/u.test(value) && Number(value) < 256 ? Number(value) : undefined
}

// XParseColor hashes truncate channels; rgb: channels scale. CSS #rgb has different semantics.
function oscColor(value: string): string | undefined {
  const rgb = /^rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})$/iu.exec(value)
  let channels: string[]
  if (rgb !== null) {
    channels = rgb.slice(1)
    if (!channels.every(channel => channel.length === channels[0]!.length)) return
  } else {
    if (!/^#(?:[\da-f]{3}){1,4}$/iu.test(value)) return
    const width = (value.length - 1) / 3
    channels = [value.slice(1, width + 1), value.slice(width + 1, 2 * width + 1), value.slice(2 * width + 1)]
  }
  return `#${channels.map((channel) => {
    const n = rgb === null
      ? Number.parseInt(channel.padEnd(2, '0').slice(0, 2), 16)
      : Math.round(Number.parseInt(channel, 16) * 255 / (16 ** channel.length - 1))
    return n.toString(16).padStart(2, '0')
  }).join('')}`
}

/**
 * Keep the cursor visible on default, indexed, true-color and inverse cell backgrounds.
 * @param terminal - opened DOM-rendered emulator.
 * @param node - screen root containing the emulator and scoped cursor CSS variables.
 * @param preferredCursor - current DSH or application cursor color.
 * @returns listener disposer; no terminal input or palette changes are emitted.
 */
export function observeTerminalScreenCursor(terminal: Terminal, node: HTMLElement, preferredCursor: () => string): IDisposable {
  return terminal.onRender(() => {
    const cursor = node.querySelector<HTMLElement>('.xterm-cursor')
    if (cursor === null) return
    // Removing only the cursor marker exposes the cell's rendered colors, including reverse video.
    cursor.classList.remove('xterm-cursor')
    let background: string
    let foreground: string
    try {
      const style = getComputedStyle(cursor)
      foreground = style.color
      background = opaqueColor(style.backgroundColor, () => getComputedStyle(node.querySelector('.xterm-scrollable-element')!).backgroundColor)
    } finally { cursor.classList.add('xterm-cursor') }
    const preferred = opaqueColor(preferredCursor(), () => background)
    const backgroundLuminance = luminance(background)
    const preferredLuminance = luminance(preferred)
    // WCAG contrast is 3:1 for the cursor and 4.5:1 for the character inside it.
    const contrast = (Math.max(backgroundLuminance, preferredLuminance) + 0.05) / (Math.min(backgroundLuminance, preferredLuminance) + 0.05)
    const fill = contrast >= 3 ? preferred : backgroundLuminance > 0.179 ? '#000000' : '#ffffff'
    node.style.setProperty('--terminal-cursor', fill)
    node.style.setProperty('--terminal-cursor-accent', luminance(fill) > 0.179 ? '#000000' : '#ffffff')
    node.style.setProperty('--terminal-cursor-cell-background', background)
    node.style.setProperty('--terminal-cursor-cell-foreground', foreground)
  })
}

// xterm emits sRGB colors; OSC values are normalized to six-digit hex by TerminalScreenTheme.
function luminance(color: string): number {
  const [r, g, b] = colorChannels(color).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function colorChannels(color: string): number[] {
  return color.startsWith('#')
    ? [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map(value => Number.parseInt(value, 16))
    : color.match(/[\d.]+/gu)!.map(Number)
}

function opaqueColor(color: string, background: () => string): string {
  const channels = colorChannels(color)
  const alpha = channels[3] ?? 1
  if (alpha === 1) return color
  const surface = colorChannels(background())
  const rgb = channels.slice(0, 3).map((channel, index) => Math.round(channel * alpha + surface[index]! * (1 - alpha)))
  return `rgb(${rgb.join(', ')})`
}
