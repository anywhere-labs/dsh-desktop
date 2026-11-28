import { expect, it } from 'vitest'
import {
  BAR_HEIGHT, EMPTY_TABS, MAX_CLOSED, MAX_TABS, TITLEBAR_HEIGHT, assemble, clampBar, clampTitlebar, currentSession,
  dropIndex, effectivePlacement, jumpTarget, mostRecent, mostUrgent, othersOf, parsePage, parsePrefs, reopen,
  reopenTarget, reorder, rightOf, serializePage, serializePrefs, shift, stepTarget, tabSignal, tabTitle, togglePin,
  warmTabs, withBarHeight, withCurrent, withoutClosed, withoutMissing, withoutTabs, withOverflow, withPlacement,
  withTitlebarHeight, type TabFacts, type TabState,
} from '../src/client/session-tabs.ts'

const titles = { a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta' }
/** Open these Sessions one after another, one ms apart. */
const opened = (...ids: string[]): TabState => ids.reduce((state, id, index) => withCurrent(state, id, index + 1), EMPTY_TABS)
const facts = (overrides: Partial<TabFacts> = {}): TabFacts =>
  ({ running: false, awaiting: false, unread: false, current: false, warm: 'ready', ...overrides })

it('reports the first Session in list order that the main view holds', () => {
  expect(currentSession(['a', 'b'], {})).toBeUndefined()
  expect(currentSession(['a', 'b', 'c'], { a: 0, b: 1, c: 2 })).toBe('b')
})

it('opens a tab right after the active one and activates an open tab in place', () => {
  let state = opened('a', 'b', 'c')
  expect(state.tabs).toEqual(['a', 'b', 'c'])
  state = withCurrent(state, 'a', 10)
  state = withCurrent(state, 'd', 11)
  expect(state.tabs).toEqual(['a', 'd', 'b', 'c'])
  expect(state.active).toBe('d')
  expect(withCurrent(state, 'd', 12)).toBe(state)
  expect(withCurrent(state, undefined, 13)).toBe(state)
})

it('never opens a tab inside the pinned group, and drops the reopened one from the closed list', () => {
  let state = togglePin(opened('a', 'b'), 'a')
  state = withCurrent(state, 'a', 10)
  state = withCurrent(withoutTabs(withCurrent(state, 'c', 11), ['c'], titles, 12).state, 'c', 13)
  expect(state.tabs).toEqual(['a', 'c', 'b'])
  expect(state.closed.map(entry => entry.id)).not.toContain('c')
})

it('caps the strip by dropping the stalest unpinned tab, never a pinned or the current one', () => {
  let state = togglePin(withCurrent(EMPTY_TABS, 'keep', 0), 'keep')
  for (let index = 0; index < MAX_TABS + 3; index += 1) state = withCurrent(state, `s${String(index)}`, index + 1)
  expect(state.tabs).toHaveLength(MAX_TABS)
  expect(state.tabs).toContain('keep')
  expect(state.tabs).toContain(`s${String(MAX_TABS + 2)}`)
  expect(state.tabs).not.toContain('s0')
})

it('closes tabs, remembers where they were, and falls back to the most recently used survivor', () => {
  let state = opened('a', 'b', 'c')
  state = withCurrent(state, 'b', 10)
  const closed = withoutTabs(state, ['b'], titles, 20)
  expect(closed.state.tabs).toEqual(['a', 'c'])
  expect(closed.next).toBe('c')
  expect(closed.state.closed[0]).toEqual({ id: 'b', title: 'Bravo', index: 1, at: 20, pinned: false })
  expect(withoutTabs(state, ['zzz'], titles, 21).state).toBe(state)
  const other = withoutTabs(state, ['a'], titles, 22)
  expect(other.next).toBeUndefined()
  expect(other.state.active).toBe('b')
})

it('caps the closed list, newest first', () => {
  let state = opened('base')
  for (let index = 0; index < MAX_CLOSED + 4; index += 1) {
    const id = `t${String(index)}`
    state = withoutTabs(withCurrent(state, id, index + 1), [id], titles, index + 1).state
  }
  expect(state.closed).toHaveLength(MAX_CLOSED)
  expect(state.closed[0]?.id).toBe(`t${String(MAX_CLOSED + 3)}`)
})

it('lists what close-others and close-right close, leaving pinned tabs alone', () => {
  const state = togglePin(opened('a', 'b', 'c', 'd'), 'a')
  expect(othersOf(state, 'c')).toEqual(['b', 'd'])
  expect(rightOf(state, 'b')).toEqual(['c', 'd'])
  expect(rightOf(state, 'zzz')).toEqual([])
})

it('reopens a closed tab where it was, pinned again, dropping gone entries ahead of it', () => {
  let state = togglePin(opened('a', 'b', 'c'), 'b')
  expect(state.tabs).toEqual(['b', 'a', 'c'])
  state = withoutTabs(state, ['b'], titles, 10).state
  state = withoutTabs(withCurrent(state, 'gone', 11), ['gone'], titles, 12).state
  const exists = (id: string): boolean => id !== 'gone'
  expect(reopenTarget(state, exists)).toBe('b')
  const reopened = reopen(state, exists, 13)
  expect(reopened?.id).toBe('b')
  expect(reopened?.state.tabs).toEqual(['b', 'a', 'c'])
  expect(reopened?.state.pinned).toEqual(['b'])
  expect(reopened?.state.closed).toEqual([])
  expect(reopen(withoutClosed(state), exists, 14)).toBeUndefined()
  expect(reopen(state, () => false, 15)).toBeUndefined()
})

it('reopens a named closed tab', () => {
  let state = withoutTabs(opened('a', 'b', 'c'), ['a', 'c'], titles, 10).state
  const reopened = reopen(state, () => true, 11, 'a')
  expect(reopened?.id).toBe('a')
  expect(reopened?.state.closed.map(entry => entry.id)).toEqual(['c'])
  state = withoutClosed(state)
  expect(withoutClosed(state)).toBe(state)
})

it('keeps a moved tab inside its own group', () => {
  const state = togglePin(togglePin(opened('a', 'b', 'c', 'd'), 'a'), 'b')
  expect(state.tabs).toEqual(['a', 'b', 'c', 'd'])
  expect(reorder(state, 'd', 0).tabs).toEqual(['a', 'b', 'd', 'c'])
  expect(reorder(state, 'a', 9).tabs).toEqual(['b', 'a', 'c', 'd'])
  expect(reorder(state, 'c', 2)).toBe(state)
  expect(reorder(state, 'zzz', 0)).toBe(state)
})

it('turns a drop beside another tab into an index, refusing the pinned boundary', () => {
  const state = togglePin(opened('a', 'b', 'c', 'd'), 'a')
  const to = dropIndex(state, 'b', 'd', 'after')
  expect(to).toBe(3)
  expect(reorder(state, 'b', to ?? -1).tabs).toEqual(['a', 'c', 'd', 'b'])
  expect(dropIndex(state, 'd', 'b', 'before')).toBe(1)
  expect(dropIndex(state, 'b', 'a', 'before')).toBeUndefined()
})

it('shifts a tab one place among visible neighbours of its group', () => {
  const state = togglePin(opened('a', 'b', 'c', 'd'), 'a')
  expect(shift(state, state.tabs, 'c', -1).tabs).toEqual(['a', 'c', 'b', 'd'])
  expect(shift(state, ['a', 'b', 'd'], 'b', 1).tabs).toEqual(['a', 'c', 'd', 'b'])
  expect(shift(state, state.tabs, 'b', -1)).toBe(state)
  expect(shift(state, state.tabs, 'd', 1)).toBe(state)
})

it('pins to the end of the pinned group and unpins to just after it', () => {
  let state = opened('a', 'b', 'c')
  state = togglePin(state, 'c')
  expect(state.tabs).toEqual(['c', 'a', 'b'])
  state = togglePin(state, 'b')
  expect(state.tabs).toEqual(['c', 'b', 'a'])
  expect(state.pinned).toEqual(['c', 'b'])
  state = togglePin(state, 'c')
  expect(state.tabs).toEqual(['b', 'c', 'a'])
  expect(state.pinned).toEqual(['b'])
  expect(togglePin(state, 'zzz')).toBe(state)
})

it('steps with wrap-around and jumps by position, 9 meaning the last', () => {
  expect(stepTarget(['a', 'b', 'c'], 'c', 1)).toBe('a')
  expect(stepTarget(['a', 'b', 'c'], 'a', -1)).toBe('c')
  expect(stepTarget(['a', 'b'], undefined, 1)).toBe('a')
  expect(stepTarget([], 'a', 1)).toBeUndefined()
  expect(jumpTarget(['a', 'b', 'c'], 2)).toBe('b')
  expect(jumpTarget(['a', 'b', 'c'], 9)).toBe('c')
  expect(jumpTarget(['a'], 4)).toBeUndefined()
})

it('keeps the visible, pinned and busy tabs warm, then the most recent of the rest', () => {
  let state = opened('a', 'b', 'c', 'd')
  state = togglePin(withCurrent(state, 'a', 10), 'b')
  expect(warmTabs(state, new Set(), 1)).toEqual(['b', 'a', 'd'])
  expect(warmTabs(state, new Set(['c']), 0)).toEqual(['b', 'a', 'c'])
})

it('hides nothing while the list is incomplete and drops only Sessions it stops reporting', () => {
  const state = opened('a', 'b')
  expect(withoutMissing(state, new Set(['a', 'b']))).toBe(state)
  const next = withoutMissing(state, new Set(['a']))
  expect(next.tabs).toEqual(['a'])
  expect(next.active).toBe('a')
})

it('orders the dot: waiting, running, unread, connecting, cold, idle', () => {
  expect(tabSignal(facts({ awaiting: true, running: true, unread: true }))).toBe('awaiting')
  expect(tabSignal(facts({ running: true, unread: true }))).toBe('running')
  expect(tabSignal(facts({ unread: true }))).toBe('unread')
  expect(tabSignal(facts({ running: undefined, current: true, warm: undefined }))).toBe('connecting')
  expect(tabSignal(facts({ running: undefined, warm: 'pending' }))).toBe('connecting')
  expect(tabSignal(facts({ running: undefined, warm: 'ready' }))).toBe('idle')
  expect(tabSignal(facts({ warm: undefined }))).toBe('cold')
  expect(tabSignal(facts({ current: true, warm: undefined }))).toBe('idle')
})

it('reports the most urgent dot across the strip, nothing when all are idle', () => {
  expect(mostUrgent(['idle', 'unread', 'running'])).toBe('running')
  expect(mostUrgent(['connecting', 'awaiting'])).toBe('awaiting')
  expect(mostUrgent(['idle', 'cold'])).toBeUndefined()
})

it('places the strip below the header without a caption row, in the title bar by default otherwise', () => {
  expect(effectivePlacement(EMPTY_TABS, 'desktop', false)).toBe('below')
  expect(effectivePlacement(EMPTY_TABS, 'desktop', true)).toBe('titlebar')
  const below = withPlacement(EMPTY_TABS, 'desktop', 'below')
  expect(effectivePlacement(below, 'desktop', true)).toBe('below')
  expect(effectivePlacement(below, 'web', true)).toBe('titlebar')
  expect(withPlacement(below, 'desktop', 'below')).toBe(below)
})

it('clamps heights and the reset to the default', () => {
  expect(clampTitlebar(10)).toBe(TITLEBAR_HEIGHT.min)
  expect(clampTitlebar(99)).toBe(TITLEBAR_HEIGHT.max)
  expect(clampBar(41.6)).toBe(42)
  expect(withTitlebarHeight(EMPTY_TABS, 44).titlebarHeight).toBe(44)
  expect(withTitlebarHeight(withTitlebarHeight(EMPTY_TABS, 44), undefined).titlebarHeight).toBeUndefined()
  expect(withBarHeight(EMPTY_TABS, 999).barHeight).toBe(BAR_HEIGHT.max)
  expect(withOverflow(EMPTY_TABS, 'scroll')).toBe(EMPTY_TABS)
  expect(withOverflow(EMPTY_TABS, 'shrink').overflow).toBe('shrink')
})

it('falls back to a placeholder title', () => {
  expect(tabTitle('Alpha', 'Untitled')).toBe('Alpha')
  expect(tabTitle('  ', 'Untitled')).toBe('Untitled')
  expect(tabTitle(undefined, 'Untitled')).toBe('Untitled')
})

it('round-trips the page half with its owner, pinned tabs first', () => {
  const state = togglePin(opened('a', 'b'), 'b')
  const page = parsePage(serializePage(state, 'page-1'))
  expect(page).toEqual({ tabs: ['b', 'a'], pinned: ['b'], seen: state.seen, active: 'b', owner: 'page-1' })
  expect(parsePage(null)).toBeUndefined()
  expect(parsePage('nope')).toBeUndefined()
  expect(parsePage('[]')).toBeUndefined()
  expect(parsePage(JSON.stringify({ tabs: ['a', 'a', '', 3], pinned: ['zzz', 'a'], seen: { a: 'x' }, active: 'zzz' })))
    .toEqual({ tabs: ['a'], pinned: ['a'], seen: {}, active: undefined, owner: undefined })
})

it('round-trips preferences, dropping malformed parts', () => {
  let state = withPlacement(withTitlebarHeight(withBarHeight(withOverflow(EMPTY_TABS, 'shrink'), 44), 32), 'desktop', 'below')
  state = withoutTabs(withCurrent(state, 'a', 1), ['a'], titles, 2).state
  expect(parsePrefs(serializePrefs(state))).toEqual({
    placement: { desktop: 'below' }, titlebarHeight: 32, barHeight: 44, overflow: 'shrink', closed: state.closed,
  })
  expect(parsePrefs(null)).toEqual({ placement: {}, titlebarHeight: undefined, barHeight: undefined, overflow: 'scroll', closed: [] })
  expect(parsePrefs(JSON.stringify({ placement: { desktop: 'side' }, titlebarHeight: 999, closed: [{ id: '' }, { id: 'q', pinned: 1 }] })))
    .toEqual({ placement: {}, titlebarHeight: TITLEBAR_HEIGHT.max, barHeight: undefined, overflow: 'scroll', closed: [{ id: 'q', title: '', index: 0, at: 0, pinned: false }] })
})

it('assembles a strip from a stored page half and preferences', () => {
  const prefs = parsePrefs(JSON.stringify({ overflow: 'shrink' }))
  expect(assemble(undefined, prefs)).toEqual({ ...EMPTY_TABS, overflow: 'shrink' })
  const page = parsePage(serializePage(opened('a'), 'p'))
  expect(assemble(page, prefs).tabs).toEqual(['a'])
})

it('picks the most recently activated of a set', () => {
  expect(mostRecent(['a', 'b'], { a: 2, b: 1 })).toBe('a')
  expect(mostRecent(['a', 'b'], {})).toBe('b')
  expect(mostRecent([], {})).toBeUndefined()
})
