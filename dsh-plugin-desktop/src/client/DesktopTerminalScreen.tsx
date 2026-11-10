/** One terminal tab's xterm screen, input tracking, and history-driven suggestion popup. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { TerminalScreenTheme, observeTerminalScreenCursor } from './desktop-terminal-panel-screen-theme.ts'
import { TerminalInputTracker, inlineSuggestion, rankHistoryEntries, type TerminalHistoryEntry } from './desktop-terminal-panel-history.ts'
import { TERMINAL_PANEL_FOCUS_EVENT } from './desktop-terminal-panel-coordinator.ts'

/** Panel-to-screen wiring; every prop is plain data or a callback owned by the panel. */
export interface DesktopTerminalScreenProps {
  readonly tabKey: string
  readonly view: TerminalView
  readonly state: TerminalViewState
  readonly visible: boolean
  readonly label: string
  readonly theme: ThemeSnapshot
  /** Shared terminal font size in pixels; changes hot-update the emulator and refit. */
  readonly fontSize: number
  readonly history: readonly TerminalHistoryEntry[]
  /** @param commands - committed command lines captured from terminal input. */
  readonly onCommit: (commands: string[]) => void
}

/** Suggestion popup row cap; the inline ghost always mirrors the first row. */
const SUGGESTION_ROWS = 6
/** Cursor rows from the top below which the popup flips under the cursor line. */
const SUGGESTION_FLIP_ROWS = 7
/** Screen chrome padding (px) matching the stylesheet, used to position overlays. */
const SCREEN_PADDING_X = 8
const SCREEN_PADDING_Y = 6

interface CursorAnchor {
  readonly left: number
  readonly top: number
  readonly cellWidth: number
  readonly cellHeight: number
  readonly flip: boolean
}

/**
 * Render one terminal with connection state, keystroke-driven history capture,
 * and a cursor-anchored suggestion popup accepted with → / End.
 * @param props - terminal model, observable state, history, and callbacks.
 * @returns the terminal screen plus overlays.
 */
export function DesktopTerminalScreen({ tabKey, view, state, visible, label, theme, fontSize, history, onCommit }: DesktopTerminalScreenProps): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal>()
  const fit = useRef<FitAddon>()
  const colors = useRef<TerminalScreenTheme>()
  const lastRevision = useRef(0)
  const tracker = useRef(new TerminalInputTracker())
  const [line, setLine] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [anchor, setAnchor] = useState<CursorAnchor | undefined>()
  const current = useRef({ state, visible, line })
  current.current = { state, visible, line }
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize

  const suggestion = useMemo(() => dismissed ? undefined : inlineSuggestion(line, history), [line, history, dismissed])
  const suggestionRows = useMemo(
    () => dismissed || line.trim().length < 2 ? [] : rankHistoryEntries(history, line, true).slice(0, SUGGESTION_ROWS),
    [line, history, dismissed],
  )
  const suggestionRef = useRef<string | undefined>()
  suggestionRef.current = suggestion
  const popupRef = useRef<readonly TerminalHistoryEntry[]>([])
  popupRef.current = suggestionRows
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => view.mount(), [view])

  /* oxlint-disable typescript/no-non-null-assertion -- React sets the DOM ref, then these effects initialize and use the emulator. */
  useLayoutEffect(() => {
    const node = element.current!
    const xterm = new Terminal({ minimumContrastRatio: 4.5, cursorBlink: true, fontSize: fontSizeRef.current, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', scrollback: current.current.state.environment?.scrollback ?? 0 })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(node)
    const palette = new TerminalScreenTheme(xterm)
    colors.current = palette
    const cursor = observeTerminalScreenCursor(xterm, node, () => palette.cursor)
    xterm.textarea?.setAttribute('aria-label', label)
    terminal.current = xterm
    fit.current = addon
    lastRevision.current = 0
    const input = xterm.onData((data) => {
      const altScreen = xterm.buffer.active.type === 'alternate'
      const committed = tracker.current.feed(data, altScreen)
      view.write(data)
      const next = tracker.current.current
      current.current.line = next
      setLine(next)
      setDismissed(false)
      if (committed.length > 0) onCommitRef.current(committed)
    })
    // Swallow the keys the panel owns; everything else flows to the emulator untouched.
    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      // Ctrl+J toggles the drawer through the shortcuts adapter; the shell never sees a stray LF.
      if (event.code === 'KeyJ' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return false
      const ghost = suggestionRef.current
      if (ghost !== undefined && (event.key === 'ArrowRight' || event.key === 'End')
        && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const typed = current.current.line
        const suffix = ghost.slice(typed.length)
        if (suffix !== '') {
          tracker.current.feed(suffix, false)
          view.write(suffix)
          current.current.line = ghost
          setLine(ghost)
        }
        return false
      }
      if (event.key === 'Escape' && popupRef.current.length > 0) {
        setDismissed(true)
        return false
      }
      return true
    })
    const measure = (): void => {
      if (!current.current.visible || !current.current.state.writable || node.clientWidth === 0 || node.clientHeight === 0) return
      fitScreen(xterm, addon, current.current.state, view)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    const focusRequest = (event: Event): void => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === tabKey) xterm.focus()
    }
    document.addEventListener(TERMINAL_PANEL_FOCUS_EVENT, focusRequest)
    return () => {
      document.removeEventListener(TERMINAL_PANEL_FOCUS_EVENT, focusRequest)
      observer.disconnect()
      input.dispose()
      cursor.dispose()
      palette.dispose()
      xterm.dispose()
      terminal.current = undefined
      fit.current = undefined
    }
  }, [view, tabKey])

  useLayoutEffect(() => {
    const style = getComputedStyle(element.current!)
    colors.current!.update(style.backgroundColor, style.color)
  }, [theme, view])

  useLayoutEffect(() => {
    const xterm = terminal.current!
    const render = state.render
    if (render === undefined || render.revision <= lastRevision.current) return
    lastRevision.current = render.revision
    if (render.frame.type === 'snapshot') {
      xterm.reset()
      xterm.resize(render.frame.info.cols, render.frame.info.rows)
      tracker.current.clear()
      current.current.line = ''
      setLine('')
    }
    xterm.write(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data, () => { view.acknowledge(render.revision) })
  }, [state.render, view])

  useLayoutEffect(() => {
    const xterm = terminal.current!
    xterm.options.disableStdin = !state.writable
    if (visible && state.writable && element.current?.clientWidth && element.current.clientHeight) {
      fitScreen(xterm, fit.current!, state, view)
    } else if (state.info !== undefined && !state.writable) xterm.resize(state.info.cols, state.info.rows)
  }, [visible, state.writable, state.info?.cols, state.info?.rows, view])

  // Hot-apply a panel font-size change without recreating the emulator.
  useLayoutEffect(() => {
    const xterm = terminal.current
    if (xterm === undefined || xterm.options.fontSize === fontSize) return
    xterm.options.fontSize = fontSize
    if (visible && state.writable && element.current?.clientWidth && element.current.clientHeight) {
      fitScreen(xterm, fit.current!, state, view)
    }
  }, [fontSize, visible, state, view])

  useEffect(() => {
    terminal.current!.textarea?.setAttribute('aria-label', label)
  }, [label])
  useEffect(() => { if (visible && state.writable) terminal.current!.focus() }, [visible, state.writable])
  /* oxlint-enable typescript/no-non-null-assertion */

  // Re-anchor the overlays against the cursor cell whenever the line or the frame moved.
  useLayoutEffect(() => {
    const xterm = terminal.current
    const node = element.current
    if (xterm === undefined || node === null || (suggestion === undefined && suggestionRows.length === 0)) {
      setAnchor(undefined)
      return
    }
    const dimensions = fit.current?.proposeDimensions()
    const buffer = xterm.buffer.active
    if (dimensions === undefined || buffer.type === 'alternate' || dimensions.cols === 0 || dimensions.rows === 0) {
      setAnchor(undefined)
      return
    }
    const cellWidth = (node.clientWidth - SCREEN_PADDING_X * 2) / dimensions.cols
    const cellHeight = (node.clientHeight - SCREEN_PADDING_Y * 2) / dimensions.rows
    setAnchor({
      left: SCREEN_PADDING_X + buffer.cursorX * cellWidth,
      top: SCREEN_PADDING_Y + buffer.cursorY * cellHeight,
      cellWidth,
      cellHeight,
      flip: buffer.cursorY < SUGGESTION_FLIP_ROWS,
    })
  }, [line, suggestion, suggestionRows, state.render])

  const ghostSuffix = suggestion !== undefined && suggestion.length > line.length ? suggestion.slice(line.length) : undefined
  return (
    <div className="dshDesktopTerminalScreen" data-visible={visible} ref={element}>
      {anchor !== undefined && ghostSuffix !== undefined && (
        <div
          className="dshDesktopTerminalGhost"
          aria-hidden="true"
          style={{ left: anchor.left, top: anchor.top, height: anchor.cellHeight, lineHeight: `${anchor.cellHeight}px`, fontSize }}
        >{ghostSuffix}</div>
      )}
      {anchor !== undefined && suggestionRows.length > 0 && (
        <div
          className="dshDesktopTerminalSuggest"
          role="listbox"
          aria-label={label}
          style={anchor.flip
            ? { left: anchor.left, top: anchor.top + anchor.cellHeight + 2 }
            : { left: anchor.left, bottom: Math.max(4, (element.current?.clientHeight ?? 0) - anchor.top) }}
        >
          {suggestionRows.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={index === 0}
              data-first={index === 0 || undefined}
              className="dshDesktopTerminalSuggestItem"
              onMouseDown={(event) => {
                event.preventDefault()
                const typed = current.current.line
                if (entry.command.toLowerCase().startsWith(typed.toLowerCase())) {
                  const suffix = entry.command.slice(typed.length)
                  tracker.current.feed(suffix, false)
                  view.write(suffix)
                } else {
                  // Fuzzy hits that do not extend the line replace it: Ctrl-U clears readline first.
                  tracker.current.feed('\x15', false)
                  tracker.current.feed(entry.command, false)
                  view.write(`\x15${entry.command}`)
                }
                current.current.line = entry.command
                setLine(entry.command)
                terminal.current?.focus()
              }}
            >{entry.command}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function fitScreen(xterm: Terminal, fit: FitAddon, state: TerminalViewState, view: TerminalView): void {
  const dimensions = fit.proposeDimensions()
  const environment = state.environment
  if (dimensions === undefined || environment === undefined) return
  const cols = Math.min(dimensions.cols, environment.maxCols)
  const rows = Math.min(dimensions.rows, environment.maxRows)
  if (cols < 2 || rows < 1) return
  xterm.resize(cols, rows)
  view.resize(cols, rows)
}
