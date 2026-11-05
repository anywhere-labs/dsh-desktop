/** Bottom-anchored Desktop terminal panel: tab strip with pinning, resident terminal screens, and history rail. */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalShell } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE } from './desktop-terminal-panel-locales.ts'
import type { DesktopTerminalPanelStore } from './desktop-terminal-panel-store.ts'
import type { DesktopTerminalPanelInjected } from './desktop-terminal-panel-face.ts'
import type { DesktopTerminalPanelTab, DesktopTerminalPanelVisibleTab } from './desktop-terminal-panel-coordinator.ts'
import { resolveActiveTerminalTab, visibleTerminalTabs } from './desktop-terminal-panel-coordinator.ts'
import { collapseTerminalPath, homeDirectoryOf, resolveCdTarget } from './desktop-terminal-panel-path.ts'
import { DesktopTerminalHistory } from './DesktopTerminalHistory.tsx'
import { DesktopTerminalScreen } from './DesktopTerminalScreen.tsx'

export type DesktopTerminalPanelProps = PropsRuntime<'shell.overlay'>
  & PropsStore<DesktopTerminalPanelStore>
  & PropsLocale<typeof DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE>
  & InjectFace<DesktopTerminalPanelInjected>

/** Resize keyboard step in pixels, matching the Logcat drawer's accessibility behavior. */
const RESIZE_KEY_STEP = 24
/** Offered terminal font sizes in pixels. */
const FONT_SIZE_OPTIONS = [11, 12, 13, 14, 16, 18, 20] as const

/**
 * The terminal drawer registered at the shell overlay. Owns tab-strip layout,
 * cwd folding, pin-across-sessions, history capture plumbing, and keeps one
 * mounted xterm per visible tab so switching never rebuilds a screen.
 * @param props - framework shares plus the coordinator inject face.
 * @returns the drawer, or null while closed.
 */
export function DesktopTerminalPanel({
  useStore, actions, t,
  usePanel, useOnScreenSession, useTheme, useTerminal,
  closePanel, setPanelHeight, toggleHistoryRail, setTerminalFontSize,
  openTab, closeTab, focusTab, togglePin, ownerOf, insertCommand, listShells, viewFor, ensureViews,
}: DesktopTerminalPanelProps): ReactNode {
  const panel = usePanel(value => value)
  const sessionId = useOnScreenSession(value => value)
  const theme = useTheme(value => value)
  const store = useStore(snapshot => snapshot)
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const panelRef = useRef<HTMLElement>(null)
  const visibleTabs = visibleTerminalTabs(panel, sessionId)
  const activeKey = resolveActiveTerminalTab(panel, sessionId, visibleTabs)
  const activeItem = visibleTabs.find(item => item.tab.key === activeKey)
  const activeContentId = activeItem?.tab.contentId

  // Opening the drawer materializes views for restored tabs; a Session seen
  // for the first time gets one fresh terminal so the drawer never opens empty.
  // Pinned tabs reattach through their owning Session regardless of where the
  // user is looking.
  useEffect(() => {
    if (!panel.open) return
    if (sessionId !== undefined && panel.tabsBySession[sessionId as string] === undefined) openTab(sessionId)
    else if (sessionId !== undefined) ensureViews(sessionId)
    for (const key of panel.pinnedKeys) {
      const owner = ownerOf(key)
      if (owner !== undefined) ensureViews(owner)
    }
  }, [panel.open, sessionId, panel.tabsBySession, panel.pinnedKeys, openTab, ensureViews, ownerOf])

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    setPanelHeight(window.innerHeight - event.clientY)
  }
  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setPanelHeight(panel.height + (event.key === 'ArrowUp' ? RESIZE_KEY_STEP : -RESIZE_KEY_STEP))
  }

  if (!panel.open) return null

  const onCommit = (contentId: string, commands: string[]): void => {
    for (const command of commands) {
      actions.appendHistory(contentId, command)
      const cwd = store.cwds[contentId] ?? ''
      if (cwd === '') continue
      const next = resolveCdTarget(cwd, command, store.homes[contentId] || undefined)
      if (next !== undefined && next !== cwd) actions.setCwd(contentId, next)
    }
  }

  const tabLabel = (tab: DesktopTerminalPanelTab): string => {
    const cwd = store.cwds[tab.contentId]
    if (cwd === undefined || cwd === '') return t('title')
    return collapseTerminalPath(cwd, store.homes[tab.contentId] || undefined)
  }

  const dimensions: CSSProperties & { '--dsh-desktop-terminal-height': string } = {
    '--dsh-desktop-terminal-height': `${panel.height}px`,
  }
  const historyEntries = activeContentId === undefined ? [] : store.histories[activeContentId] ?? []
  const historyFilter = activeContentId === undefined ? '' : store.filters[activeContentId] ?? ''

  return (
    <section
      id="dsh-desktop-terminal-panel"
      ref={panelRef}
      className="dshDesktopTerminalPanel"
      style={dimensions}
      role="region"
      aria-label={t('title')}
      tabIndex={-1}
    >
      <div
        className="dshDesktopTerminalResizeHandle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('resize')}
        aria-valuemin={200}
        aria-valuemax={800}
        aria-valuenow={panel.height}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onKeyDown={onResizeKeyDown}
      />
      <div className="dshDesktopTerminalTabStrip">
        <div className="dshDesktopTerminalTabs" role="tablist" aria-label={t('title')}>
          {visibleTabs.map(item => (
            <span key={item.tab.key} role="tab" aria-selected={item.tab.key === activeKey}
              className="dshDesktopTerminalTab" data-active={item.tab.key === activeKey} data-pinned={item.pinned || undefined}
              title={store.cwds[item.tab.contentId] ?? ''}
              tabIndex={0}
              onClick={() => focusTab(item.tab.key)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') focusTab(item.tab.key) }}>
              <span className="dshDesktopTerminalTabLabel">{tabLabel(item.tab)}</span>
              <button type="button" className="dshDesktopTerminalTabPin"
                aria-label={item.pinned ? t('unpinTab') : t('pinTab')} title={item.pinned ? t('unpinTab') : t('pinTab')}
                aria-pressed={item.pinned}
                onClick={(event) => { event.stopPropagation(); togglePin(item.tab.key) }}>
                <PinIcon filled={item.pinned} />
              </button>
              <button type="button" className="dshDesktopTerminalTabClose"
                aria-label={t('closeTab')} title={t('closeTab')}
                onClick={(event) => { event.stopPropagation(); closeTab(item.ownerSessionId, item.tab.key) }}>×</button>
            </span>
          ))}
        </div>
        <div className="dshDesktopTerminalStripActions">
          {sessionId !== undefined && (
            <ShellPicker t={t} sessionId={sessionId} listShells={listShells} onPick={(path) => openTab(sessionId, path)} />
          )}
          <label className="dshDesktopTerminalFontSize" title={t('fontSize')}>
            <span aria-hidden="true">A</span>
            <select
              aria-label={t('fontSize')}
              value={panel.fontSize}
              onChange={event => setTerminalFontSize(Number(event.currentTarget.value))}
            >
              {FONT_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}px</option>)}
            </select>
          </label>
          <button type="button" className="dshDesktopTerminalIconButton"
            aria-label={t('toggleHistory')} title={t('toggleHistory')}
            aria-pressed={panel.historyRailOpen}
            onClick={() => toggleHistoryRail()}>☰</button>
          <button type="button" className="dshDesktopTerminalIconButton"
            aria-label={t('closePanel')} title={t('closePanel')}
            onClick={() => closePanel()}>×</button>
        </div>
      </div>
      <div className="dshDesktopTerminalBody">
        <div className="dshDesktopTerminalScreenWrap">
          {sessionId === undefined && visibleTabs.length === 0 && (
            <div className="dshDesktopTerminalEmpty"><p>{t('noSession')}</p></div>
          )}
          {sessionId !== undefined && visibleTabs.length === 0 && (
            <div className="dshDesktopTerminalEmpty">
              <button type="button" className="dshDesktopTerminalPrimaryButton" onClick={() => openTab(sessionId)}>{t('newTab')}</button>
            </div>
          )}
          {visibleTabs.map(item => (
            <TabTerminalHost
              key={item.tab.key}
              item={item}
              active={item.tab.key === activeKey}
              t={t}
              theme={theme}
              fontSize={panel.fontSize}
              useTerminal={useTerminal}
              viewFor={viewFor}
              store={store}
              onInitCwd={(contentId, cwd) => actionsRef.current.initTab(contentId, cwd, homeDirectoryOf(cwd) ?? '')}
              onCommit={onCommit}
              onReplaceTab={() => { closeTab(item.ownerSessionId, item.tab.key); openTab(item.ownerSessionId) }}
            />
          ))}
        </div>
        {panel.historyRailOpen && activeItem !== undefined && (
          <aside className="dshDesktopTerminalHistory" aria-label={t('history')}>
            <DesktopTerminalHistory
              entries={historyEntries}
              filter={historyFilter}
              t={t}
              onFilterChange={(text) => { if (activeContentId !== undefined) actions.setFilter(activeContentId, text) }}
              onInsert={(command, run) => { if (activeKey !== undefined) insertCommand(activeKey, command, run) }}
              onRemove={(id) => { if (activeContentId !== undefined) actions.removeHistory(activeContentId, id) }}
              onClear={() => { if (activeContentId !== undefined) actions.clearHistory(activeContentId) }}
            />
          </aside>
        )}
      </div>
    </section>
  )
}

/** Pin glyph for the tab strip. */
function PinIcon({ filled }: { readonly filled: boolean }): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M9.5 2 14 6.5 12.6 7.9c-1.1 1.1-1.7 2.6-1.4 4.1l.1.5-1.4 1.4-4.2-4.2 1.4-1.4.5.1c1.5.3 3-.3 4.1-1.4L9.5 2zM5 8l-2.8 2.8L5 11l2.8-2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Store snapshot slice needed by one hosted terminal. */
type PanelStoreSnapshot = ReturnType<DesktopTerminalPanelStore['create']> extends { getSnapshot: () => infer S } ? S : never

/**
 * One tab's resident terminal: its own keyed state subscription, status line,
 * and xterm screen. Stays mounted while hidden so switching Sessions or tabs
 * never reconnects or loses scrollback.
 */
function TabTerminalHost({ item, active, t, theme, fontSize, useTerminal, viewFor, store, onInitCwd, onCommit, onReplaceTab }: {
  readonly item: DesktopTerminalPanelVisibleTab
  readonly active: boolean
  readonly t: DesktopTerminalPanelProps['t']
  readonly theme: ThemeSnapshot
  readonly fontSize: number
  readonly useTerminal: DesktopTerminalPanelProps['useTerminal']
  readonly viewFor: DesktopTerminalPanelProps['viewFor']
  readonly store: PanelStoreSnapshot
  readonly onInitCwd: (contentId: string, cwd: string) => void
  readonly onCommit: (contentId: string, commands: string[]) => void
  readonly onReplaceTab: () => void
}): ReactNode {
  const state = useTerminal(item.tab.key)
  const view = viewFor(item.tab.key)
  const contentId = item.tab.contentId
  const onInitRef = useRef(onInitCwd)
  onInitRef.current = onInitCwd

  // Initialize the tracked directory of a fresh tab from its Host metadata.
  useEffect(() => {
    const cwd = state?.info?.cwd
    if (cwd === undefined || cwd === '') return
    if (store.cwds[contentId] !== undefined) return
    onInitRef.current(contentId, cwd)
  }, [contentId, state?.info?.cwd, store.cwds])

  const history = store.histories[contentId] ?? []
  return (
    <div className="dshDesktopTerminalScreenPane" data-visible={active} data-tab-key={item.tab.key}>
      {state !== undefined && view !== undefined && state.issue !== 'missingTerminal' && (
        <TerminalStatusLine t={t} state={state} view={view} onReplaceTab={onReplaceTab} />
      )}
      {state !== undefined && view !== undefined && state.issue === 'missingTerminal' && (
        <div className="dshDesktopTerminalEmpty">
          <p role="alert">{t('missingTerminal')}</p>
          <button type="button" className="dshDesktopTerminalPrimaryButton" onClick={onReplaceTab}>{t('newTab')}</button>
        </div>
      )}
      {(state === undefined || view === undefined) && active && (
        <div className="dshDesktopTerminalStatus" role="status">{t('loading')}</div>
      )}
      {state !== undefined && view !== undefined && state.info !== undefined && (
        <DesktopTerminalScreen
          tabKey={item.tab.key}
          view={view}
          state={state}
          visible={active}
          label={t('title')}
          theme={theme}
          fontSize={fontSize}
          history={history}
          onCommit={commands => onCommit(contentId, commands)}
        />
      )}
    </div>
  )
}

/** Status line and recovery actions for one hosted terminal. */
function TerminalStatusLine({ t, state, view, onReplaceTab }: {
  readonly t: DesktopTerminalPanelProps['t']
  readonly state: TerminalViewState
  readonly view: NonNullable<ReturnType<DesktopTerminalPanelProps['viewFor']>>
  readonly onReplaceTab: () => void
}): ReactNode {
  const error = state.phase === 'disconnected' ? undefined : state.issue === undefined ? state.error ?? state.info?.error : t(state.issue)
  let status: string | undefined
  if (state.phase === 'idle' || state.phase === 'loading') status = t('loading')
  else if (state.phase === 'creating' || state.phase === 'connecting' || state.phase === 'disconnected') status = t(state.phase)
  else if (state.info?.state === 'exited') status = t('exited', { code: String(state.info.exitCode ?? '—') })
  else if (state.info?.state === 'failed') status = t('unavailable')
  else if (state.phase === 'closed') status = t('closed')
  const ended = state.info?.state === 'exited' || state.phase === 'closed'
  const retry = !ended && (state.phase === 'failed' || state.phase === 'disconnected')
  const readOnly = state.phase === 'connected' && state.info?.state === 'running' && !state.writable
  if (status === undefined && !retry && !readOnly && error === undefined) return null
  return (
    <>
      {(status !== undefined || retry || readOnly) && <div className="dshDesktopTerminalStatus" role="status">
        {status}
        {readOnly && <>{t('readonly')} <button type="button" className="dshDesktopTerminalIconButton" onClick={() => { view.connect() }}>{t('control')}</button></>}
        {retry && (state.info === undefined
          ? <button type="button" className="dshDesktopTerminalIconButton" onClick={() => { void view.refresh() }}>{t(state.phase === 'disconnected' ? 'reconnect' : 'retry')}</button>
          : <button type="button" className="dshDesktopTerminalIconButton" onClick={() => { view.connect() }}>{t('reconnect')}</button>)}
        {ended && <button type="button" className="dshDesktopTerminalIconButton" onClick={onReplaceTab}>{t('newTab')}</button>}
      </div>}
      {error !== undefined && <p className="dshDesktopTerminalError" role="alert">{t('failed', { message: error })}</p>}
    </>
  )
}

/** New-tab shell picker: lists Host-discovered shells in a dropdown menu. */
function ShellPicker({ t, sessionId, listShells, onPick }: {
  readonly t: DesktopTerminalPanelProps['t']
  readonly sessionId: SessionId
  readonly listShells: DesktopTerminalPanelProps['listShells']
  readonly onPick: (shellPath?: string) => void
}): ReactNode {
  const [shells, setShells] = useState<readonly TerminalShell[] | undefined>()
  const [loading, setLoading] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const load = () => {
    if (shells !== undefined || loading) return
    setLoading(true)
    const controller = new AbortController()
    listShells(sessionId, controller.signal)
      .then(result => setShells(result.shells))
      .catch(() => setShells([]))
      .finally(() => setLoading(false))
  }
  return (
    <details ref={detailsRef} className="dshDesktopTerminalShellMenu" onToggle={() => { if (detailsRef.current?.open) load() }}>
      <summary aria-label={t('newTab')} title={t('newTab')}>＋</summary>
      <div className="dshDesktopTerminalShellMenuList" role="menu">
        <button type="button" className="dshDesktopTerminalShellItem" onClick={() => { detailsRef.current?.removeAttribute('open'); onPick() }}>
          {t('newTab')}
        </button>
        {loading && <p className="dshDesktopTerminalShellHint">{t('shellsLoading')}</p>}
        {!loading && shells !== undefined && shells.length === 0 && <p className="dshDesktopTerminalShellHint">{t('shellsEmpty')}</p>}
        {!loading && shells?.map(shell => (
          <button key={shell.path} type="button" className="dshDesktopTerminalShellItem"
            onClick={() => { detailsRef.current?.removeAttribute('open'); onPick(shell.path) }}>
            {shell.name} <code>{shell.path}</code>
          </button>
        ))}
      </div>
    </details>
  )
}
