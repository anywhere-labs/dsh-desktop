/**
 * The session strip's seats: one in the Windows caption row, one below the conversation header. Only the seat the
 * current placement selects renders; both read the same runtime, so moving the strip keeps every tab's state.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { BAR_HEIGHT, TITLEBAR_HEIGHT, type TabSignal, type TabState } from './session-tabs.ts'
import { dragBar, dragTitlebar, rowTitle, type Cell, type ListSnapshot, type SessionTabsController, type StatusRow } from './session-tabs-controller.ts'

type Translate = (cn: string, en: string) => string
type Selector<S> = <R>(select: (snapshot: S) => R) => R

/** Where a seat sits. */
export type Seat = 'titlebar' | 'header'

/** What both seats render from. */
export interface SeatProps {
  readonly controller: SessionTabsController
  readonly seat: Seat
  readonly t: (key: string) => string
  readonly useSessions?: Selector<ListSnapshot>
  readonly useSessionStatus?: Selector<ReadonlyMap<string, StatusRow>>
  readonly usePanelInfo?: Selector<{ readonly activePanelId: unknown }>
}

const EMPTY_STATUS: ReadonlyMap<string, StatusRow> = new Map()

function useCell<T>(source: Cell<T>): T {
  return useSyncExternalStore(source.subscribe, source.get, source.get)
}

const SIGNAL_TEXT: Readonly<Record<TabSignal, readonly [string, string]>> = {
  awaiting: ['等待你审批或回答', 'Waiting for your approval or answer'],
  running: ['运行中', 'Running'],
  unread: ['已完成，尚未查看', 'Finished, not read yet'],
  connecting: ['连接中', 'Connecting'],
  idle: ['空闲', 'Idle'],
  cold: ['空闲（未常驻内存）', 'Idle (not kept in memory)'],
}

const icon = (path: ReactNode, size = 14): ReactNode =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{path}</svg>
const Icons = {
  plus: () => icon(<path d="M8 3.25v9.5M3.25 8h9.5" />),
  close: () => icon(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />, 12),
  pin: () => icon(<path d="M6 2.75h4M6.75 2.75v3.6L4.75 9h6.5l-2-2.65v-3.6M8 9v4.25" />, 12),
  history: () => icon(<><path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.78" /><path d="M2.6 2.75v2.6h2.6" /><path d="M8 5.25V8l1.9 1.3" /></>),
  swap: () => icon(<><path d="M5 2.75v10.5M2.75 5 5 2.75 7.25 5" /><path d="M11 13.25V2.75M13.25 11 11 13.25 8.75 11" /></>),
  check: () => icon(<path d="M3.5 8.25 6.5 11l6-6.25" />, 12),
}

/**
 * One seat. It renders nothing unless the strip is placed here, `dsh-multi-session` is not drawing its own, and the
 * conversation is the main view (another panel covering it keeps only the title-bar seat, which stays useful there).
 */
export function SessionTabsSeat(props: SeatProps): ReactNode {
  const { controller, seat } = props
  const yielded = useCell(controller.yielded)
  const hasTitlebar = useCell(controller.titlebar)
  useCell(controller.state)
  const placement = controller.placement()
  const wanted: Seat = placement === 'titlebar' && hasTitlebar ? 'titlebar' : 'header'
  if (yielded || seat !== wanted) return null
  return <TabBar {...props} hasTitlebar={hasTitlebar} />
}

interface MenuState {
  readonly kind: 'tab' | 'strip' | 'history'
  readonly id?: string
  readonly x: number
  readonly y: number
}

interface DragState {
  readonly id: string
  readonly over?: string
  readonly side?: 'before' | 'after'
}

function TabBar({ controller, seat, t: tKey, useSessions, useSessionStatus, usePanelInfo, hasTitlebar }: SeatProps & { readonly hasTitlebar: boolean }): ReactNode {
  const zh = tKey('language') === 'zh'
  const t: Translate = useCallback((cn, en) => zh ? cn : en, [zh])
  const state = useCell(controller.state)
  useCell(controller.warm)
  useCell(controller.read)
  useCell(controller.pending)
  useCell(controller.unseen)
  const liveBar = useCell(controller.liveBar)
  const list = useSessions?.(snapshot => snapshot)
  const status = useSessionStatus?.(snapshot => snapshot) ?? EMPTY_STATUS
  const panelOpen = usePanelInfo?.(info => info.activePanelId !== null) ?? false
  const [menu, setMenu] = useState<MenuState | undefined>(undefined)
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [overrides, setOverrides] = useState<Readonly<Record<string, string>>>({})
  const [renameError, setRenameError] = useState<string | undefined>(undefined)
  const [drag, setDrag] = useState<DragState | undefined>(undefined)
  const stripRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => { setMenu(undefined) }, [])

  const byId = list?.byId ?? {}
  const tabs = state.tabs.filter(id => byId[id] !== undefined)
  const pinned = new Set(state.pinned)
  const pinnedCount = tabs.filter(id => pinned.has(id)).length
  const current = controller.current()
  const activeId = panelOpen ? undefined : current
  const signals = list === undefined ? new Map<string, TabSignal>() : controller.signals({ list, status }, panelOpen)
  useEffect(() => { if (list !== undefined) controller.observe({ list, status }, signals, panelOpen) })
  const titleOf = (id: string): string => overrides[id] ?? rowTitle(byId[id]) ?? (byId[id]?.blank === true ? t('新会话', 'New session') : t('未命名会话', 'Untitled session'))

  // Title bar: start after the desktop menu, which mounts after the strip and changes width with the language.
  useLayoutEffect(() => {
    if (seat !== 'titlebar') return undefined
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const menuHost = document.querySelector('[data-windows-menu]')
        const rect = menuHost?.getBoundingClientRect()
        const end = rect !== undefined && rect.width > 0 ? Math.round(rect.right) + 12 : 180
        stripRef.current?.style.setProperty('--dshNextTabsMenuEnd', `${end}px`)
      })
    }
    let resize: ResizeObserver | undefined
    let watched: Element | null = null
    const watchMenu = (): void => {
      const host = document.querySelector('[data-windows-menu]')
      if (host === watched) return
      resize?.disconnect()
      watched = host
      if (host !== null && typeof ResizeObserver === 'function') { resize = new ResizeObserver(measure); resize.observe(host) }
      measure()
    }
    watchMenu()
    const late = setTimeout(watchMenu, 600)
    const rootObserver = new MutationObserver(measure)
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-fullscreen', 'lang'] })
    const mountObserver = new MutationObserver(watchMenu)
    mountObserver.observe(document.body, { childList: true })
    // Collapsing the sidebar moves the menu without resizing it.
    const sidebarObserver = new MutationObserver(measure)
    sidebarObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(late)
      rootObserver.disconnect()
      mountObserver.disconnect()
      sidebarObserver.disconnect()
      resize?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [seat])

  // Overflow fades, written straight to the DOM so scrolling does not re-render.
  const syncFades = useCallback(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const fades = [scroller.scrollLeft > 2 ? 'l' : '', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2 ? 'r' : ''].filter(Boolean).join(' ')
    if ((scroller.getAttribute('data-fade') ?? '') !== fades) {
      if (fades === '') scroller.removeAttribute('data-fade')
      else scroller.setAttribute('data-fade', fades)
    }
  }, [])
  const layoutKey = `${tabs.join('|')}#${state.pinned.join('|')}#${renaming ?? ''}#${String(Object.keys(overrides).length)}`
  useLayoutEffect(() => { syncFades() }, [syncFades, layoutKey])
  useEffect(() => {
    if (activeId === undefined) return
    const element = tabsRef.current?.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`)
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  useEffect(() => {
    if (typeof ResizeObserver !== 'function') return undefined
    let frame = 0
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(syncFades) })
    if (scrollRef.current !== null) observer.observe(scrollRef.current)
    if (tabsRef.current !== null) observer.observe(tabsRef.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [syncFades])
  // Drop optimistic titles once the list carries the new title.
  useEffect(() => {
    const stale = Object.keys(overrides).filter(id => byId[id] === undefined || rowTitle(byId[id]) === overrides[id])
    if (stale.length === 0) return
    setOverrides(previous => {
      const next = { ...previous }
      for (const id of stale) delete next[id]
      return next
    })
  }, [byId, overrides])
  useEffect(() => {
    if (renameError === undefined) return undefined
    const timer = setTimeout(() => { setRenameError(undefined) }, 2400)
    return () => { clearTimeout(timer) }
  }, [renameError])

  const focusTab = (id: string | undefined): void => {
    if (id === undefined) return
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus()
  }
  const openMenuAt = (kind: MenuState['kind'], id: string | undefined, anchor: Element, event?: { clientX: number; clientY: number; type: string; preventDefault(): void; stopPropagation(): void }): void => {
    event?.preventDefault()
    event?.stopPropagation()
    const rect = anchor.getBoundingClientRect()
    // Pointer coordinates count only when they land on the anchor; otherwise the menu opens below it.
    const inside = event !== undefined && event.type === 'contextmenu'
      && event.clientX >= rect.left - 1 && event.clientX <= rect.right + 1 && event.clientY >= rect.top - 1 && event.clientY <= rect.bottom + 1
    setMenu(inside
      ? { kind, ...id === undefined ? {} : { id }, x: event.clientX + 2, y: Math.max(event.clientY + 2, rect.bottom + 2) }
      : { kind, ...id === undefined ? {} : { id }, x: rect.left, y: rect.bottom + 4 })
  }
  const startRename = (id: string): void => {
    setMenu(undefined)
    setRenameError(undefined)
    setRenaming(id)
    setDraft(titleOf(id))
  }

  // A stable callback bag, so memoised tabs do not re-render on every strip render.
  const api = useRef<TabApi>(undefined as unknown as TabApi)
  api.current = {
    activate: controller.actions.activate,
    close: id => { controller.actions.close([id]) },
    togglePin: controller.actions.togglePin,
    startRename,
    setDraft,
    openMenuAt,
    cancelRename: id => { setRenaming(undefined); requestAnimationFrame(() => { focusTab(id) }) },
    commitRename: async () => {
      const id = renaming
      const value = draft.trim()
      setRenaming(undefined)
      if (id === undefined || value === '' || value === titleOf(id)) return
      setOverrides(previous => ({ ...previous, [id]: value }))
      if (!await controller.actions.rename(id, value)) {
        setOverrides(previous => {
          const next = { ...previous }
          delete next[id]
          return next
        })
        setRenameError(id)
      }
    },
    keyDown: (event, id) => {
      if (renaming !== undefined) return
      const key = event.key
      const index = tabs.indexOf(id)
      const arrow = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : undefined
      if (arrow !== undefined && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        controller.actions.shift(id, arrow)
        requestAnimationFrame(() => { focusTab(id) })
        return
      }
      if (arrow !== undefined && event.altKey && event.shiftKey) { event.preventDefault(); controller.actions.step(arrow); return }
      if (arrow !== undefined && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        focusTab(tabs[(index + arrow + tabs.length) % tabs.length])
        return
      }
      if (key === 'Home' || key === 'End') { event.preventDefault(); focusTab(key === 'Home' ? tabs[0] : tabs[tabs.length - 1]); return }
      if (key === 'Enter' || key === ' ') { event.preventDefault(); controller.actions.activate(id); return }
      if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); if (!pinned.has(id)) controller.actions.close([id]); return }
      if (key === 'F2') { event.preventDefault(); startRename(id); return }
      if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) { event.preventDefault(); openMenuAt('tab', id, event.currentTarget) }
    },
    dragStart: (event, id) => {
      event.dataTransfer.effectAllowed = 'move'
      try {
        event.dataTransfer.setData('application/x-dsh-session-tab', id)
        event.dataTransfer.setData('text/plain', titleOf(id))
      } catch { /* the browser refused drag data */ }
      setDrag({ id })
    },
    dragOver: (event, id) => {
      if (drag === undefined || pinned.has(drag.id) !== pinned.has(id)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      if (drag.over !== id || drag.side !== side) setDrag({ ...drag, over: id, side })
    },
    drop: (event, id) => {
      if (drag === undefined) return
      event.preventDefault()
      controller.actions.drop(drag.id, id, drag.side ?? 'before')
      setDrag(undefined)
    },
    dragEnd: () => { setDrag(undefined) },
  }

  const firstFocusable = activeId !== undefined && tabs.includes(activeId) ? activeId : tabs[0]
  const nodes: ReactNode[] = []
  tabs.forEach((id, index) => {
    if (index === pinnedCount && pinnedCount > 0) nodes.push(<span key="__divider" className="dshNextTabsDivider" aria-hidden="true" />)
    const signal = signals.get(id) ?? 'idle'
    nodes.push(<Tab key={id} id={id} index={index} api={api} title={titleOf(id)} signal={signal}
      signalLabel={t(...SIGNAL_TEXT[signal])} selected={id === activeId} focusable={id === firstFocusable}
      pinned={pinned.has(id)} renaming={renaming === id} draft={renaming === id ? draft : ''}
      dropSide={drag?.over === id && drag.id !== id ? drag.side : undefined} dragging={drag?.id === id}
      renameError={renameError === id} cwd={byId[id]?.cwd} t={t} />)
  })

  const height = liveBar ?? state.barHeight ?? BAR_HEIGHT.default
  const otherPlacement = controller.placement() === 'titlebar' ? 'below' : 'titlebar'
  const background = (target: EventTarget): boolean => target === stripRef.current
    || (target instanceof Element && (target.classList.contains('dshNextTabsList') || target.classList.contains('dshNextTabsScroll') || target.classList.contains('dshNextTabsTools')))

  return <div ref={stripRef} className="dshNextTabs" data-next-session-tabs data-seat={seat} data-overflow={state.overflow}
    style={seat === 'header' ? { ['--dshNextTabsBar' as string]: `${String(height)}px` } : undefined}
    onContextMenu={event => { if (background(event.target)) openMenuAt('strip', undefined, event.currentTarget, event) }}
    onDoubleClick={event => {
      if (event.target instanceof Element && (event.target.classList.contains('dshNextTabsList') || event.target.classList.contains('dshNextTabsScroll'))) {
        controller.actions.newSession()
      }
    }}>
    <div ref={scrollRef} className="dshNextTabsScroll" onScroll={syncFades}
      onWheel={event => {
        const scroller = scrollRef.current
        if (scroller !== null && Math.abs(event.deltaY) > Math.abs(event.deltaX) && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft += event.deltaY
      }}>
      <div ref={tabsRef} className="dshNextTabsList" role="tablist" aria-label={t('已打开的会话', 'Open sessions')} aria-orientation="horizontal">
        {tabs.length > 0 ? nodes : <span className="dshNextTabsEmpty">{t('没有会话标签', 'No session tabs')}</span>}
      </div>
    </div>
    <div className="dshNextTabsTools">
      <button type="button" className="dshNextTabsButton" aria-label={t('新建会话标签', 'New session tab')}
        title={`${t('新建会话标签', 'New session tab')}  Alt+Shift+N`} onClick={() => { controller.actions.newSession() }}
        onContextMenu={event => { openMenuAt('strip', undefined, event.currentTarget, event) }}>{Icons.plus()}</button>
      <button type="button" className="dshNextTabsButton" aria-label={t('最近关闭', 'Recently closed')} aria-haspopup="menu"
        aria-expanded={menu?.kind === 'history'} title={`${t('最近关闭', 'Recently closed')}  Alt+Shift+T`}
        onClick={event => { if (menu?.kind === 'history') closeMenu(); else openMenuAt('history', undefined, event.currentTarget) }}>{Icons.history()}</button>
    </div>
    <div className="dshNextTabsTools" data-end="">
      <button type="button" className="dshNextTabsButton" disabled={!hasTitlebar} aria-label={t('切换标签栏位置', 'Swap tab bar position')}
        title={hasTitlebar
          ? `${t('切换标签栏位置', 'Swap tab bar position')} → ${otherPlacement === 'titlebar' ? t('标题栏', 'Title bar') : t('会话头部下方', 'Below conversation header')}`
          : `${t('切换标签栏位置', 'Swap tab bar position')}（${t('仅 Windows 桌面端', 'Windows Desktop only')}）`}
        onClick={() => { controller.actions.setPlacement(otherPlacement) }}>{Icons.swap()}</button>
    </div>
    <HeightGrip controller={controller} seat={seat} t={t} />
    {menu === undefined ? null : <StripMenu menu={menu} close={closeMenu} controller={controller} state={state} tabs={tabs}
      pinned={pinned} pinnedCount={pinnedCount} activeId={activeId} hasTitlebar={hasTitlebar} byId={byId} t={t}
      titleOf={titleOf} startRename={startRename} />}
  </div>
}

interface TabApi {
  activate(id: string): void
  close(id: string): void
  togglePin(id: string): void
  startRename(id: string): void
  setDraft(value: string): void
  openMenuAt(kind: MenuState['kind'], id: string | undefined, anchor: Element, event?: { clientX: number; clientY: number; type: string; preventDefault(): void; stopPropagation(): void }): void
  cancelRename(id: string): void
  commitRename(): Promise<void>
  keyDown(event: ReactKeyboardEvent<HTMLDivElement>, id: string): void
  dragStart(event: React.DragEvent<HTMLDivElement>, id: string): void
  dragOver(event: React.DragEvent<HTMLDivElement>, id: string): void
  drop(event: React.DragEvent<HTMLDivElement>, id: string): void
  dragEnd(): void
}

interface TabProps {
  readonly id: string
  readonly index: number
  readonly api: { readonly current: TabApi }
  readonly title: string
  readonly signal: TabSignal
  readonly signalLabel: string
  readonly selected: boolean
  readonly focusable: boolean
  readonly pinned: boolean
  readonly renaming: boolean
  readonly draft: string
  readonly dropSide: 'before' | 'after' | undefined
  readonly dragging: boolean
  readonly renameError: boolean
  readonly cwd: string | undefined
  readonly t: Translate
}

const Tab = memo(function Tab({ id, index, api, title, signal, signalLabel, selected, focusable, pinned, renaming, draft, dropSide, dragging, renameError, cwd, t }: TabProps) {
  const tip = [title, pinned ? t('已固定', 'Pinned') : '', signalLabel, cwd ?? ''].filter(Boolean).join('\n')
  return <div data-tab-id={id} className="dshNextTab" role="tab" aria-selected={selected} aria-label={`${title}, ${signalLabel}`}
    tabIndex={focusable ? 0 : -1} title={renameError ? `${t('重命名失败', 'Rename failed')}\n${tip}` : tip}
    data-state={signal} data-pinned={pinned || undefined} data-dragging={dragging || undefined} data-drop={dropSide}
    onClick={() => { if (!renaming) api.current.activate(id) }}
    onDoubleClick={event => { event.preventDefault(); api.current.startRename(id) }}
    onAuxClick={event => { if (event.button === 1) { event.preventDefault(); if (!pinned) api.current.close(id) } }}
    onMouseDown={event => { if (event.button === 1) event.preventDefault() }}
    onContextMenu={event => { api.current.openMenuAt('tab', id, event.currentTarget, event) }}
    onKeyDown={event => { api.current.keyDown(event, id) }}
    draggable={!renaming}
    onDragStart={event => { api.current.dragStart(event, id) }}
    onDragOver={event => { api.current.dragOver(event, id) }}
    onDrop={event => { api.current.drop(event, id) }}
    onDragEnd={() => { api.current.dragEnd() }}>
    <span className="dshNextTabSignal" data-state={signal} aria-hidden="true"><i /><i /><i /></span>
    {renaming
      ? <input className="dshNextTabInput" value={draft} autoFocus aria-label={t('重命名', 'Rename')} spellCheck={false}
        onChange={event => { api.current.setDraft(event.target.value) }}
        onFocus={event => { event.target.select() }}
        onBlur={() => { void api.current.commitRename() }}
        onClick={event => { event.stopPropagation() }}
        onDoubleClick={event => { event.stopPropagation() }}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          else if (event.key === 'Escape') { event.preventDefault(); api.current.cancelRename(id) }
        }} />
      : <span className="dshNextTabLabel">{title}</span>}
    {index < 9 && !renaming ? <span className="dshNextTabKey" aria-hidden="true">{String(index + 1)}</span> : null}
    {pinned ? <button type="button" className="dshNextTabX dshNextTabUnpin" tabIndex={-1} aria-label={t('取消固定', 'Unpin tab')}
      title={t('取消固定', 'Unpin tab')} draggable={false}
      onClick={event => { event.stopPropagation(); api.current.togglePin(id) }}
      onDoubleClick={event => { event.stopPropagation() }}>{Icons.pin()}</button> : null}
    <button type="button" className="dshNextTabX" tabIndex={-1} aria-label={t('关闭标签', 'Close tab')} title={t('关闭标签', 'Close tab')}
      draggable={false} onClick={event => { event.stopPropagation(); api.current.close(id) }}
      onDoubleClick={event => { event.stopPropagation() }}>{Icons.close()}</button>
    {selected ? <span className="dshNextTabLine" aria-hidden="true" /> : null}
  </div>
})

/** The bottom-edge handle: it sizes the caption row in the title bar, the strip itself below the header. */
function HeightGrip({ controller, seat, t }: { readonly controller: SessionTabsController; readonly seat: Seat; readonly t: Translate }): ReactNode {
  const [active, setActive] = useState(false)
  const start = useRef<{ readonly y: number; readonly height: number } | undefined>(undefined)
  const titlebar = seat === 'titlebar'
  const target = titlebar ? controller.liveTitlebar : controller.liveBar
  const end = (): void => {
    if (start.current === undefined) return
    start.current = undefined
    setActive(false)
    const value = target.get()
    if (value !== undefined) {
      if (titlebar) controller.actions.setTitlebarHeight(value)
      else controller.actions.setBarHeight(value)
    }
    target.set(undefined)
  }
  return <div className="dshNextTabsGrip" data-active={active ? '' : undefined} aria-hidden="true"
    title={titlebar ? t('拖动调整标题栏高度，双击恢复默认', 'Drag to resize the title bar, double-click to reset') : t('拖动调整标签栏高度，双击恢复默认', 'Drag to resize the tab bar, double-click to reset')}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      const state = controller.state.get()
      const height = titlebar
        ? Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height')) || TITLEBAR_HEIGHT.default
        : state.barHeight ?? BAR_HEIGHT.default
      start.current = { y: event.clientY, height }
      event.currentTarget.setPointerCapture(event.pointerId)
      setActive(true)
    }}
    onPointerMove={event => {
      if (start.current === undefined) return
      const delta = event.clientY - start.current.y
      target.set(titlebar ? dragTitlebar(start.current.height, delta) : dragBar(start.current.height, delta))
    }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onDoubleClick={() => { if (titlebar) controller.actions.setTitlebarHeight(undefined); else controller.actions.setBarHeight(undefined) }} />
}

interface StripMenuProps {
  readonly menu: MenuState
  readonly close: () => void
  readonly controller: SessionTabsController
  readonly state: TabState
  readonly tabs: readonly string[]
  readonly pinned: ReadonlySet<string>
  readonly pinnedCount: number
  readonly activeId: string | undefined
  readonly hasTitlebar: boolean
  readonly byId: ListSnapshot['byId']
  readonly t: Translate
  readonly titleOf: (id: string) => string
  readonly startRename: (id: string) => void
}

function StripMenu({ menu, close, controller, state, tabs, pinned, pinnedCount, activeId, hasTitlebar, byId, t, titleOf, startRename }: StripMenuProps): ReactNode {
  const { actions } = controller
  const item = (key: string, label: string, onSelect: () => void, options: { readonly hint?: string | undefined; readonly disabled?: boolean; readonly checked?: boolean } = {}): ReactNode =>
    <MenuItem key={key} label={label} hint={options.hint} disabled={options.disabled} checked={options.checked} onSelect={onSelect} close={close} />
  const placement = controller.placement()
  const placementItems = (): ReactNode[] => {
    const items: ReactNode[] = [
      <MenuHead key="ph">{t('标签栏位置', 'Tab bar position')}</MenuHead>,
      item('pt', t('标题栏', 'Title bar'), () => { actions.setPlacement('titlebar') }, { checked: placement === 'titlebar', disabled: !hasTitlebar, hint: hasTitlebar ? undefined : t('仅 Windows 桌面端', 'Windows Desktop only') }),
      item('pb', t('会话头部下方', 'Below conversation header'), () => { actions.setPlacement('below') }, { checked: placement === 'below' }),
      <MenuSeparator key="hs" />,
    ]
    if (placement === 'titlebar' && hasTitlebar) {
      const height = state.titlebarHeight ?? TITLEBAR_HEIGHT.default
      const names: Readonly<Record<number, readonly [string, string]>> = { 32: ['紧凑', 'Compact'], 36: ['默认', 'Default'], 40: ['原始', 'Original'], 44: ['宽松', 'Roomy'] }
      items.push(<MenuHead key="hh">{`${t('标题栏高度', 'Title bar height')} · ${String(height)}px`}</MenuHead>)
      for (const value of TITLEBAR_HEIGHT.presets) {
        const name = names[value] ?? ['', '']
        items.push(item(`h${String(value)}`, t(name[0], name[1]), () => { actions.setTitlebarHeight(value === TITLEBAR_HEIGHT.default ? undefined : value) }, { checked: height === value, hint: `${String(value)}px` }))
      }
    } else {
      const height = state.barHeight ?? BAR_HEIGHT.default
      const names: Readonly<Record<number, readonly [string, string]>> = { 32: ['紧凑', 'Compact'], 38: ['默认', 'Default'], 44: ['宽松', 'Roomy'], 50: ['特大', 'Extra roomy'] }
      items.push(<MenuHead key="hh">{`${t('标签栏高度', 'Tab bar height')} · ${String(height)}px`}</MenuHead>)
      for (const value of BAR_HEIGHT.presets) {
        const name = names[value] ?? ['', '']
        items.push(item(`h${String(value)}`, t(name[0], name[1]), () => { actions.setBarHeight(value === BAR_HEIGHT.default ? undefined : value) }, { checked: height === value, hint: `${String(value)}px` }))
      }
    }
    items.push(
      <MenuSeparator key="os" />,
      <MenuHead key="oh">{t('标签太多时', 'When there are too many tabs')}</MenuHead>,
      item('o-scroll', t('横向滚动', 'Scroll horizontally'), () => { actions.setOverflow('scroll') }, { checked: state.overflow === 'scroll' }),
      item('o-shrink', t('缩小宽度，全部显示', 'Shrink tabs to fit'), () => { actions.setOverflow('shrink') }, { checked: state.overflow === 'shrink' }),
    )
    return items
  }
  let items: ReactNode[]
  if (menu.kind === 'tab' && menu.id !== undefined) {
    const id = menu.id
    const index = tabs.indexOf(id)
    const isPinned = pinned.has(id)
    const groupStart = isPinned ? 0 : pinnedCount
    const groupEnd = isPinned ? pinnedCount - 1 : tabs.length - 1
    items = [
      item('o', t('切换到此标签', 'Switch to this tab'), () => { actions.activate(id) }, { disabled: id === activeId }),
      item('p', isPinned ? t('取消固定', 'Unpin tab') : t('固定标签', 'Pin tab'), () => { actions.togglePin(id) }),
      item('r', t('重命名', 'Rename'), () => { startRename(id) }, { hint: 'F2' }),
      item('n', t('新建会话标签', 'New session tab'), () => { actions.newSession(id) }, { hint: 'Alt+Shift+N' }),
      <MenuSeparator key="s1" />,
      item('ml', t('向左移动', 'Move left'), () => { actions.shift(id, -1) }, { hint: 'Shift+←', disabled: index <= groupStart }),
      item('mr', t('向右移动', 'Move right'), () => { actions.shift(id, 1) }, { hint: 'Shift+→', disabled: index < 0 || index >= groupEnd }),
      <MenuSeparator key="s2" />,
      item('c', t('关闭标签', 'Close tab'), () => { actions.close([id]) }, { hint: 'Alt+Shift+W' }),
      item('co', t('关闭其他标签', 'Close other tabs'), () => { actions.closeOthers(id) }, { disabled: !tabs.some(tab => tab !== id && !pinned.has(tab)) }),
      item('cr', t('关闭右侧标签', 'Close tabs to the right'), () => { actions.closeRight(id) }, { disabled: !tabs.slice(index + 1).some(tab => !pinned.has(tab)) }),
      item('ro', t('恢复最近关闭的标签', 'Reopen closed tab'), () => { actions.reopen() }, { hint: 'Alt+Shift+T', disabled: state.closed.length === 0 }),
      <MenuSeparator key="s3" />,
      ...placementItems(),
    ]
  } else if (menu.kind === 'history') {
    items = [<MenuHead key="h">{t('最近关闭', 'Recently closed')}</MenuHead>]
    if (state.closed.length === 0) items.push(item('e', t('还没有关闭过标签', 'Nothing closed yet'), () => {}, { disabled: true }))
    state.closed.slice(0, 12).forEach((entry, index) => {
      const live = byId[entry.id] !== undefined
      items.push(item(entry.id, live ? titleOf(entry.id) : entry.title || t('未命名会话', 'Untitled session'), () => { actions.reopen(entry.id) },
        { hint: index === 0 ? 'Alt+Shift+T' : undefined, disabled: !live }))
    })
    if (state.closed.length > 0) items.push(<MenuSeparator key="s" />, item('clear', t('清空记录', 'Clear history'), () => { actions.clearClosed() }))
  } else {
    items = [
      item('n', t('新建会话标签', 'New session tab'), () => { actions.newSession() }, { hint: 'Alt+Shift+N' }),
      item('ro', t('恢复最近关闭的标签', 'Reopen closed tab'), () => { actions.reopen() }, { hint: 'Alt+Shift+T', disabled: state.closed.length === 0 }),
      <MenuSeparator key="s" />,
      ...placementItems(),
    ]
  }
  return <Menu x={menu.x} y={menu.y} onClose={close} label={t('已打开的会话', 'Open sessions')}>{items}</Menu>
}

function Menu({ x, y, onClose, label, children }: { readonly x: number; readonly y: number; readonly onClose: () => void; readonly label: string; readonly children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Record<string, string | number>>({ left: x, top: y, visibility: 'hidden' })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    // A transformed ancestor becomes the containing block of a fixed element and shifts it; measure and compensate.
    const dx = rect.left - x
    const dy = rect.top - y
    const flipX = x + rect.width > window.innerWidth - 6
    const flipY = y + rect.height > window.innerHeight - 6
    const left = flipX ? Math.max(6, window.innerWidth - rect.width - 6) : x
    const top = flipY ? Math.max(6, y - rect.height) : y
    setPosition({ left: left - dx, top: top - dy, ['--dshNextTabsOrigin' as string]: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}` })
    element.querySelector<HTMLElement>('.dshNextTabsMenuItem:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y])
  useEffect(() => {
    const down = (event: PointerEvent): void => { if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) onClose() }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const element = ref.current
    if (element === null) return
    const items = [...element.querySelectorAll<HTMLElement>('.dshNextTabsMenuItem:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); (items[index + 1] ?? items[0])?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); (items[index - 1] ?? items[items.length - 1])?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus() }
    else if (event.key === 'Tab') { event.preventDefault(); onClose() }
  }
  // Rendered in place, not portalled, so theme tokens scoped to the app container still apply.
  return <div ref={ref} className="dshNextTabsMenu" data-next-session-tabs-menu role="menu" aria-label={label} style={position}
    onKeyDown={onKeyDown} onContextMenu={event => { event.preventDefault() }}>{children}</div>
}

function MenuItem({ label, hint, onSelect, disabled, checked, close }: {
  readonly label: string; readonly hint?: string | undefined; readonly onSelect: () => void; readonly disabled?: boolean | undefined
  readonly checked?: boolean | undefined; readonly close: () => void
}): ReactNode {
  const radio = checked !== undefined
  return <button type="button" className="dshNextTabsMenuItem" role={radio ? 'menuitemradio' : 'menuitem'} disabled={disabled === true}
    aria-checked={radio ? checked : undefined} onClick={() => { close(); if (disabled !== true) onSelect() }}>
    {radio ? <span className="dshNextTabsMenuCheck">{checked ? Icons.check() : null}</span> : null}
    <span className="dshNextTabsMenuLabel">{label}</span>
    {hint === undefined ? null : <span className="dshNextTabsMenuHint">{hint}</span>}
  </button>
}

const MenuSeparator = (): ReactNode => <div className="dshNextTabsMenuSeparator" role="separator" />
const MenuHead = ({ children }: { readonly children: ReactNode }): ReactNode => <div className="dshNextTabsMenuHead" role="presentation">{children}</div>
