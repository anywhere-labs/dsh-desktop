/** Right-hand command history rail of the Desktop terminal panel: fuzzy filter, copy, insert, run. */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { rankHistoryEntries, type TerminalHistoryEntry } from './desktop-terminal-panel-history.ts'
import type { DesktopTerminalPanelLocaleKey } from './desktop-terminal-panel-locales.ts'

/** Locale translator seat handed down from the panel's PropsLocale share. */
export type DesktopTerminalPanelTranslate = (key: DesktopTerminalPanelLocaleKey, params?: Record<string, string>) => string

/** History rail wiring; all data and mutations arrive as plain props from the panel. */
export interface DesktopTerminalHistoryProps {
  readonly entries: readonly TerminalHistoryEntry[]
  readonly filter: string
  readonly t: DesktopTerminalPanelTranslate
  /** @param text - new filter draft. */
  readonly onFilterChange: (text: string) => void
  /** @param command - chosen history command. @param run - execute immediately after insertion. */
  readonly onInsert: (command: string, run: boolean) => void
  /** @param id - entry to delete from history. */
  readonly onRemove: (id: number) => void
  readonly onClear: () => void
}

/**
 * List one terminal's recorded commands newest-first with case-insensitive
 * fuzzy filtering; row click inserts, buttons copy, run, or delete entries.
 * @param props - entries, filter draft, translated copy, and callbacks.
 * @returns the history rail content.
 */
export function DesktopTerminalHistory({ entries, filter, t, onFilterChange, onInsert, onRemove, onClear }: DesktopTerminalHistoryProps): ReactNode {
  const [notice, setNotice] = useState<'copied' | 'copyFailed' | ''>('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()
  const ranked = useMemo(() => rankHistoryEntries(entries, filter), [entries, filter])

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setNotice('copied')
    } catch {
      setNotice('copyFailed')
    }
    if (noticeTimer.current !== undefined) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 2000)
  }

  return (
    <>
      <div className="dshDesktopTerminalHistoryHeader">
        <span>{t('history')}</span>
        <button type="button" className="dshDesktopTerminalHistoryButton" style={{ width: 'auto', padding: '0 6px' }}
          aria-label={t('clearHistory')} title={t('clearHistory')}
          disabled={entries.length === 0}
          onClick={() => onClear()}>{t('clearHistory')}</button>
      </div>
      <div className="dshDesktopTerminalHistoryFilter">
        <input
          type="search"
          value={filter}
          placeholder={t('historyFilterPlaceholder')}
          aria-label={t('historyFilterPlaceholder')}
          onChange={event => onFilterChange(event.currentTarget.value)}
        />
      </div>
      {notice !== '' && <div className="dshDesktopTerminalHistoryNotice" role="status">{t(notice)}</div>}
      <div className="dshDesktopTerminalHistoryList">
        {ranked.length === 0 && (
          <p className="dshDesktopTerminalHistoryEmpty">{t(entries.length === 0 ? 'historyEmpty' : 'historyNoMatch')}</p>
        )}
        {ranked.map(entry => (
          <div key={entry.id} className="dshDesktopTerminalHistoryRow">
            <button type="button" className="dshDesktopTerminalHistoryCommand" title={entry.command}
              onClick={() => onInsert(entry.command, false)}>{entry.command}</button>
            <button type="button" className="dshDesktopTerminalHistoryButton" aria-label={t('copy')} title={t('copy')}
              onClick={() => { void copy(entry.command) }}>⧉</button>
            <button type="button" className="dshDesktopTerminalHistoryButton" aria-label={t('insertAndRun')} title={t('insertAndRun')}
              onClick={() => onInsert(entry.command, true)}>▸</button>
            <button type="button" className="dshDesktopTerminalHistoryButton" aria-label={t('removeEntry')} title={t('removeEntry')}
              onClick={() => onRemove(entry.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}
