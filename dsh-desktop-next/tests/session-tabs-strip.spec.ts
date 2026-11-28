import { expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EMPTY_TABS, togglePin, withCurrent, type TabState } from '../src/client/session-tabs.ts'
import { cell, type ListSnapshot, type SessionTabsController, type StatusRow } from '../src/client/session-tabs-controller.ts'
import { SessionTabsSeat, type Seat } from '../src/client/session-tabs-strip.tsx'

/** A controller double: real cells, scripted placement, and recorded actions. */
function controller(state: TabState, options: { readonly titlebar?: boolean; readonly yielded?: boolean; readonly current?: string } = {}): SessionTabsController {
  const actions = new Proxy({}, { get: () => vi.fn() }) as SessionTabsController['actions']
  const strip = cell(state)
  const titlebar = cell(options.titlebar ?? false)
  return {
    state: strip,
    warm: cell(new Map([['a', 'ready' as const], ['b', 'ready' as const]])),
    titlebar,
    yielded: cell(options.yielded ?? false),
    liveTitlebar: cell<number | undefined>(undefined),
    liveBar: cell<number | undefined>(undefined),
    icon: cell(undefined),
    read: cell({}),
    pending: cell({}),
    unseen: cell(new Set<string>()),
    page: 'test',
    runtime: () => titlebar.get() ? 'desktop' : 'web',
    placement: () => titlebar.get() ? strip.get().placement.desktop ?? 'titlebar' : 'below',
    current: () => options.current,
    visible: () => strip.get().tabs,
    signals: ({ list, status }) => new Map(strip.get().tabs.filter(id => list.byId[id] !== undefined).map(id => {
      const row = status.get(id)
      return [id, row?.pendingInteraction !== undefined ? 'awaiting' : row?.running === true ? 'running' : 'idle'] as const
    })),
    observe: () => {},
    actions,
    install: () => () => {},
  }
}

const list: ListSnapshot = {
  ids: ['a', 'b', 'c', 'd'],
  byId: {
    a: { title: 'Alpha', cwd: 'D:/work/alpha', retainedBy: { mainView: 1 } },
    b: { title: 'Bravo', displayTitle: 'Bravo', retainedBy: {} },
    d: { title: '', displayTitle: 'default-workspace', retainedBy: {} },
    c: { blank: true, retainedBy: {} },
  },
}
const status = new Map<string, StatusRow>([
  ['a', { running: true, pendingInteraction: undefined, completionUnread: false }],
  ['b', { running: false, pendingInteraction: { key: 'q' }, completionUnread: false }],
])
const select = <S,>(snapshot: S) => <R,>(pick: (value: S) => R): R => pick(snapshot)

const render = (seat: Seat, source: SessionTabsController, language = 'zh', panel: unknown = null): string =>
  renderToStaticMarkup(createElement(SessionTabsSeat, {
    controller: source, seat, t: (key: string) => key === 'language' ? language : key,
    useSessions: select(list), useSessionStatus: select(status as ReadonlyMap<string, StatusRow>), usePanelInfo: select({ activePanelId: panel }),
  }))

const strip = (): TabState => togglePin(withCurrent(withCurrent(withCurrent(EMPTY_TABS, 'a', 1), 'b', 2), 'c', 3), 'b')

it('renders the strip below the header without a caption row, with one tab per listed Session', () => {
  const html = render('header', controller(strip(), { current: 'a' }))
  expect(html).toContain('data-next-session-tabs')
  expect(html).toContain('data-seat="header"')
  expect(html.match(/role="tab"/g)).toHaveLength(3)
  // Pinned first, then the divider, then the rest.
  expect(html.indexOf('Bravo')).toBeLessThan(html.indexOf('dshNextTabsDivider'))
  expect(html.indexOf('dshNextTabsDivider')).toBeLessThan(html.indexOf('Alpha'))
  expect(render('titlebar', controller(strip(), { current: 'a' }))).toBe('')
})

it('marks the current tab, the pinned one and each Session\'s state', () => {
  const html = render('header', controller(strip(), { current: 'a' }))
  expect(html).toMatch(/data-tab-id="a"[^>]*aria-selected="true"/)
  expect(html).toMatch(/data-tab-id="b"[^>]*aria-selected="false"[^>]*data-state="awaiting"[^>]*data-pinned="true"/)
  expect(html).toMatch(/data-tab-id="a"[^>]*data-state="running"/)
  expect(html).toContain('dshNextTabLine')
  expect(html).toContain('取消固定')
})

it('titles a Session by its own title, or as the sidebar does: new when blank, untitled otherwise', () => {
  const html = render('header', controller(strip(), { current: 'a' }))
  expect(html).toContain('>Alpha<')
  expect(html).toContain('>Bravo<')
  expect(html).toContain('>新会话<')
  expect(render('header', controller(strip(), { current: 'a' }), 'en')).toContain('>New session<')
  // Without a title of its own a running Session is untitled, not the workspace name its display title falls back to.
  const untitled = render('header', controller(withCurrent(strip(), 'd', 9), { current: 'd' }))
  expect(untitled).toContain('>未命名会话<')
  expect(untitled).not.toContain('default-workspace')
})

it('moves to the title bar where the window has a caption row, and back below when asked', () => {
  const titlebar = controller(strip(), { titlebar: true, current: 'a' })
  expect(render('header', titlebar)).toBe('')
  expect(render('titlebar', titlebar)).toContain('data-seat="titlebar"')
  const below = controller({ ...strip(), placement: { desktop: 'below' } }, { titlebar: true, current: 'a' })
  expect(render('titlebar', below)).toBe('')
  expect(render('header', below)).toContain('data-seat="header"')
})

it('steps aside while dsh-multi-session draws its own strip', () => {
  expect(render('header', controller(strip(), { yielded: true }))).toBe('')
  expect(render('titlebar', controller(strip(), { yielded: true, titlebar: true }))).toBe('')
})

it('shows no selection while another panel covers the conversation', () => {
  const html = render('header', controller(strip(), { current: 'a' }), 'zh', 'plugins')
  expect(html).not.toContain('aria-selected="true"')
})

it('offers the empty strip\'s hint and the strip tools without tabs', () => {
  const html = render('header', controller(EMPTY_TABS))
  expect(html).toContain('没有会话标签')
  expect(html).toContain('新建会话标签')
  expect(html).toContain('最近关闭')
  // No caption row: swapping the position is disabled and says why.
  expect(html).toMatch(/disabled=""[^>]*aria-label="切换标签栏位置"/)
})

it('applies the stored strip height and overflow mode', () => {
  const html = render('header', controller({ ...strip(), barHeight: 44, overflow: 'shrink' }, { current: 'a' }))
  expect(html).toContain('--dshNextTabsBar:44px')
  expect(html).toContain('data-overflow="shrink"')
})

it('numbers the first nine tabs for Alt+Shift+N', () => {
  const html = render('header', controller(strip(), { current: 'a' }))
  expect(html.match(/class="dshNextTabKey"/g)).toHaveLength(3)
})
