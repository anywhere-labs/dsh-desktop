/**
 * The open-Session strip in the conversation header.
 *
 * It lists the Sessions this window has open, switches between them, keeps the recent ones in memory so returning to
 * one shows its history at once, and marks a tab whose Session is busy or waiting for the user. Closing a tab only
 * forgets it here: the Session stays in the profile.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-status/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  EMPTY_TABS, currentSession, parseTabState, reopenTarget, serializeTabState, tabSignal, tabTitle, warmTabs,
  withCurrent, withoutMissing, withoutTabs, type TabState,
} from './session-tabs.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A tab kept in memory so returning to it shows its history at once. */
    sessionTabs: unknown
  }
}

/** Where the strip remembers its tabs: this window's own storage, so a reload returns to the same strip. */
export const TABS_STORAGE_KEY = 'desktop-next.session-tabs.v1'

type Translate = (cn: string, en: string) => string

/** The strip remembers plain strings; the Session list brands its ids. */
const asSessionId = (id: string): SessionId => id as unknown as SessionId

/** The Session Controller surface the strip holds tabs with. */
interface Retainer {
  retain(target: string, options: { source: 'sessionTabs' }): { release(): void }
}

/** The workspace browser, asked which workspace a Session belongs to before starting a neighbour. */
interface Workspaces {
  readonly list?: { getSnapshot(): { readonly items?: readonly { readonly workspaceId?: string; readonly sessionIds?: readonly string[] }[] } }
}

/**
 * The number of main views holding each Session, as the list reports them.
 * @param rows - the list's rows by id.
 * @returns per-Session counts, zero entries dropped.
 */
function retainedCounts(rows: Readonly<Record<string, { readonly retainedBy?: { readonly mainView?: number } }>>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [id, row] of Object.entries(rows)) {
    const held = row.retainedBy?.mainView ?? 0
    if (held > 0) counts[id] = held
  }
  return counts
}

/**
 * The strip. It renders nothing while another main panel covers the conversation: tabs belong to that view.
 * @param props - the slot's runtime hooks, the locale face, and the client context.
 * @returns the strip, or null.
 */
export function SessionTabs({ context, useSessions, useSessionStatus, usePanelInfo, t }: PropsLocale<'desktop-next'>
  & PropsRuntime<'conversation.header.leading'> & { context: Context }): ReactNode {
  const zh = t('language') === 'zh'
  const translate: Translate = useCallback((cn, en) => zh ? cn : en, [zh])
  const list = useSessions(snapshot => snapshot)
  const status = useSessionStatus(snapshot => snapshot)
  const panelOpen = usePanelInfo(info => info.activePanelId !== null)
  const [state, setState] = useState<TabState>(readStoredTabs)
  const current = currentSession(retainedCounts(list.byId))
  const remember = useCallback((next: TabState): TabState => {
    try { sessionStorage.setItem(TABS_STORAGE_KEY, serializeTabState(next)) } catch { /* storage unavailable: keep the strip in memory */ }
    return next
  }, [])
  // The strip follows the visible Session, so one opened from the sidebar or a link gains a tab.
  useEffect(() => {
    setState(previous => {
      const next = withCurrent(previous, current)
      return next === previous ? previous : remember(next)
    })
  }, [current, remember])
  // A Session deleted elsewhere leaves no tab behind.
  useEffect(() => {
    setState(previous => {
      const next = withoutMissing(previous, new Set(Object.keys(list.byId)))
      return next === previous ? previous : remember(next)
    })
  }, [list.byId, remember])
  const rows = list.byId
  const tabs = useMemo(() => state.tabs.filter(id => rows[asSessionId(id)] !== undefined), [state.tabs, rows])
  const titles = useMemo(() => Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, row.displayTitle])), [rows])
  const facts = useMemo(() => new Map(tabs.map(id => [id, status.get(asSessionId(id))] as const)), [tabs, status])
  const busy = useMemo(() => new Set(tabs.filter(id => {
    const entry = facts.get(id)
    return entry?.running === true || entry?.pendingInteraction !== undefined
  })), [tabs, facts])
  useWarmTabs(context, state, busy)
  const leavePanel = useCallback(() => {
    if (panelOpen) (context.get('layout') as { selectPanel?(id: null): void } | undefined)?.selectPanel?.(null)
  }, [context, panelOpen])
  const activate = useCallback((id: string) => {
    leavePanel()
    if (id === current) return
    ;(context.get('uiWorkspace') as { openSession?(target: string): void } | undefined)?.openSession?.(id)
  }, [context, current, leavePanel])
  const startSession = useCallback(() => {
    leavePanel()
    const workspace = current === undefined ? undefined : workspaceOf(context, current)
    ;(context.get('uiWorkspace') as { startSession?(workspace?: string): void } | undefined)?.startSession?.(workspace)
  }, [context, current, leavePanel])
  const close = useCallback((ids: readonly string[]) => {
    setState(previous => {
      const closed = withoutTabs(previous, ids, titles)
      if (closed.state === previous) return previous
      // Switching after the strip is stored keeps the stored active tab in step with the Session that opens.
      if (closed.next !== undefined) queueMicrotask(() => { activate(closed.next as string) })
      return remember(closed.state)
    })
  }, [activate, remember, titles])
  const reopen = useCallback(() => {
    const target = reopenTarget(state, new Set(Object.keys(rows)))
    if (target === undefined) return
    setState(previous => remember({ ...previous, closed: previous.closed.filter(entry => entry.id !== target) }))
    activate(target)
  }, [activate, remember, rows, state])
  if (panelOpen || tabs.length === 0) return null
  const fallback = translate('未命名会话', 'Untitled session')
  return <div className="dshNextSessionTabs" role="tablist" aria-label={translate('已打开的会话', 'Open sessions')} data-next-session-tabs>
    <div className="dshNextSessionTabsStrip">
      {tabs.map(id => {
        const row = rows[asSessionId(id)]
        const entry = facts.get(id)
        const title = tabTitle(row?.displayTitle, fallback)
        const signal = tabSignal({
          running: entry?.running ?? row?.running,
          awaiting: entry?.pendingInteraction !== undefined,
          unread: entry?.completionUnread === true,
          warm: entry?.running !== undefined || busy.has(id),
        })
        const active = id === current
        return <div key={id} className="dshNextSessionTab" data-state={signal} data-active={active || undefined}>
          <button type="button" role="tab" aria-selected={active} className="dshNextSessionTabButton" title={title}
            onClick={() => { activate(id) }}
            onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close([id]) } }}>
            <span className="dshNextSessionTabDot" aria-hidden="true" />
            <span className="dshNextSessionTabLabel">{title}</span>
          </button>
          <button type="button" className="dshNextSessionTabClose"
            aria-label={translate(`关闭 ${title}`, `Close ${title}`)} onClick={() => { close([id]) }}>×</button>
        </div>
      })}
    </div>
    <div className="dshNextSessionTabsActions">
      {state.closed.length === 0 ? null : <button type="button" className="dshNextSessionTabsAction"
        aria-label={translate('恢复最近关闭的标签', 'Reopen the last closed tab')} onClick={reopen}>↺</button>}
      <button type="button" className="dshNextSessionTabsAction"
        aria-label={translate('新建会话标签', 'New session tab')} onClick={startSession}>＋</button>
    </div>
  </div>
}

/**
 * Read the strip this window remembers.
 * @returns the remembered strip, or the empty one.
 */
function readStoredTabs(): TabState {
  try { return parseTabState(sessionStorage.getItem(TABS_STORAGE_KEY)) } catch { return EMPTY_TABS }
}

/**
 * The workspace a Session belongs to, as the workspace browser lists it.
 * @param context - the client context.
 * @param sessionId - the Session to look up.
 * @returns its workspace id, or undefined when no workspace browser is mounted or lists it.
 */
function workspaceOf(context: Context, sessionId: string): string | undefined {
  const workspaces = context.get('workspaces') as Workspaces | undefined
  try {
    return workspaces?.list?.getSnapshot().items?.find(item => item.sessionIds?.includes(sessionId))?.workspaceId
  } catch {
    return undefined
  }
}

/**
 * Hold the recent tabs in memory so returning to one shows its history at once, and release the rest.
 * @param context - the client context, for the Session Controller.
 * @param state - the remembered strip.
 * @param busy - Sessions that stay held whatever their age.
 */
function useWarmTabs(context: Context, state: TabState, busy: ReadonlySet<string>): void {
  const held = useRef(new Map<string, { release(): void }>())
  const wanted = useMemo(() => new Set(warmTabs(state, busy)), [state, busy])
  useEffect(() => {
    const sessions = context.get('sessions') as Retainer | undefined
    if (sessions === undefined) return
    const references = held.current
    for (const id of wanted) {
      if (references.has(id)) continue
      try { references.set(id, sessions.retain(id, { source: 'sessionTabs' })) } catch { /* a Session the Host no longer has */ }
    }
    for (const [id, reference] of references) {
      if (wanted.has(id)) continue
      try { reference.release() } catch { /* already released */ }
      references.delete(id)
    }
  }, [context, wanted])
  useEffect(() => {
    const references = held.current
    return () => {
      for (const reference of references.values()) {
        try { reference.release() } catch { /* already released */ }
      }
      references.clear()
    }
  }, [])
}
