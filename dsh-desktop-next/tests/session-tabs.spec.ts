import { expect, it, vi } from 'vitest'
import {
  EMPTY_TABS, MAX_CLOSED, MAX_TABS, currentSession, mostRecent, parseTabState, reopenTarget, serializeTabState,
  tabSignal, tabTitle, warmTabs, withCurrent, withoutMissing, withoutTabs, type TabState,
} from '../src/client/session-tabs.ts'

const titles = { a: 'Alpha', b: 'Bravo', c: 'Charlie' }

it('reports the current Session as the one the main view holds', () => {
  expect(currentSession({})).toBeUndefined()
  expect(currentSession({ a: 0, b: 2 })).toBe('b')
})

it('opens a tab for the visible Session and keeps the order it first appeared in', () => {
  let state = withCurrent(EMPTY_TABS, 'a')
  expect(state.tabs).toEqual(['a'])
  expect(state.active).toBe('a')
  state = withCurrent(state, 'b')
  state = withCurrent(state, 'a')
  expect(state.tabs).toEqual(['a', 'b'])
  expect(state.active).toBe('a')
})

it('returns the same state when the visible Session is already the active tab', () => {
  const once = withCurrent(EMPTY_TABS, 'a')
  // Only the seen timestamp may move, and never back.
  const again = withCurrent(once, 'a')
  expect(again.tabs).toEqual(once.tabs)
  expect(again.seen.a ?? 0).toBeGreaterThanOrEqual(once.seen.a ?? 0)
})

it('ignores a missing Session', () => {
  const state = withCurrent(EMPTY_TABS, 'a')
  expect(withCurrent(state, undefined)).toBe(state)
})

it('caps the remembered tabs, dropping the oldest', () => {
  let state: TabState = EMPTY_TABS
  for (let index = 0; index < MAX_TABS + 5; index += 1) state = withCurrent(state, `s${index}`)
  expect(state.tabs).toHaveLength(MAX_TABS)
  expect(state.tabs[0]).toBe('s5')
})

it('closes tabs, remembers them, and falls back to the most recently used survivor', () => {
  vi.useFakeTimers()
  try {
    let state = withCurrent(withCurrent(withCurrent(EMPTY_TABS, 'a'), 'b'), 'c')
    state = withCurrent(state, 'b')
    const closed = withoutTabs(state, ['b'], titles)
    expect(closed.state.tabs).toEqual(['a', 'c'])
    // `b` was active; `c` was activated after `a`, so it is the one to show next.
    expect(closed.next).toBe('c')
    expect(closed.state.closed[0]).toEqual({ id: 'b', title: 'Bravo', index: 1 })
    expect(closed.state.seen.b).toBeUndefined()
  } finally { vi.useRealTimers() }
})

it('keeps the active tab when another one closes', () => {
  const state = withCurrent(withCurrent(EMPTY_TABS, 'a'), 'b')
  const closed = withoutTabs(state, ['a'], titles)
  expect(closed.next).toBe('b')
  expect(closed.state.active).toBe('b')
})

it('does nothing for tabs that are not open', () => {
  const state = withCurrent(EMPTY_TABS, 'a')
  expect(withoutTabs(state, ['zzz'], titles).state).toBe(state)
})

it('caps the closed list', () => {
  let state = withCurrent(EMPTY_TABS, 'only')
  for (let index = 0; index < MAX_CLOSED + 6; index += 1) {
    state = withCurrent(state, `t${index}`)
    state = withoutTabs(state, [`t${index}`], titles).state
  }
  expect(state.closed.length).toBeLessThanOrEqual(MAX_CLOSED)
})

it('reopens the most recently closed tab that still exists', () => {
  const state: TabState = { ...EMPTY_TABS, closed: [{ id: 'gone', title: 'Gone', index: 0 }, { id: 'b', title: 'Bravo', index: 1 }] }
  expect(reopenTarget(state, new Set(['b']))).toBe('b')
  expect(reopenTarget(state, new Set())).toBeUndefined()
})

it('keeps the visible tab, the busy tabs, and the most recent of the rest warm', () => {
  vi.useFakeTimers()
  try {
    let state = withCurrent(EMPTY_TABS, 'a')
    vi.advanceTimersByTime(10)
    state = withCurrent(state, 'b')
    vi.advanceTimersByTime(10)
    state = withCurrent(state, 'c')
    vi.advanceTimersByTime(10)
    state = withCurrent(state, 'a')
    // `a` is visible, `b` is busy; `c` is newer than `b` and is the idle tab kept.
    expect(warmTabs(state, new Set(['b']), 1)).toEqual(['a', 'b', 'c'])
    expect(warmTabs(state, new Set(), 1)).toEqual(['a', 'c'])
    expect(warmTabs(state, new Set(), 0)).toEqual(['a'])
  } finally { vi.useRealTimers() }
})

it('drops tabs the Session list no longer reports', () => {
  const state = withCurrent(withCurrent(EMPTY_TABS, 'a'), 'b')
  const next = withoutMissing(state, new Set(['a']))
  expect(next.tabs).toEqual(['a'])
  expect(next.active).toBe('a')
  expect(withoutMissing(state, new Set(['a', 'b']))).toBe(state)
})

it('reports a request waiting for the user ahead of work in progress', () => {
  expect(tabSignal({ running: true, awaiting: true, unread: true, warm: true })).toBe('awaiting')
  expect(tabSignal({ running: true, awaiting: false, unread: true, warm: true })).toBe('running')
  expect(tabSignal({ running: false, awaiting: false, unread: true, warm: true })).toBe('unread')
  expect(tabSignal({ running: false, awaiting: false, unread: false, warm: true })).toBe('idle')
  expect(tabSignal({ running: undefined, awaiting: false, unread: false, warm: false })).toBe('cold')
})

it('falls back to a placeholder before the Host projects a title', () => {
  expect(tabTitle('Alpha', 'Untitled')).toBe('Alpha')
  expect(tabTitle('   ', 'Untitled')).toBe('Untitled')
  expect(tabTitle(undefined, 'Untitled')).toBe('Untitled')
})

it('reads back what it stored, dropping anything malformed', () => {
  const state = withCurrent(withCurrent(EMPTY_TABS, 'a'), 'b')
  const closed = withoutTabs(state, ['a'], titles).state
  expect(parseTabState(serializeTabState(closed))).toEqual(closed)
  expect(parseTabState(null)).toBe(EMPTY_TABS)
  expect(parseTabState('not json')).toBe(EMPTY_TABS)
  expect(parseTabState('[]')).toEqual(EMPTY_TABS)
})

it('drops a stored active tab that is not in the stored set, and unknown rows in seen', () => {
  const stored = JSON.stringify({ version: 1, tabs: ['a'], active: 'zzz', seen: { a: 5, zzz: 9 }, closed: [] })
  expect(parseTabState(stored)).toEqual({ tabs: ['a'], seen: { a: 5 }, closed: [] })
  const seen = JSON.stringify({ version: 1, tabs: ['a', 'a', '', 7], active: 'a', seen: {}, closed: [{ id: '', title: 'x' }, { id: 'q' }] })
  expect(parseTabState(seen)).toEqual({ tabs: ['a'], seen: {}, closed: [{ id: 'q', title: '', index: 0 }], active: 'a' })
})

it('picks the most recently activated of a set', () => {
  expect(mostRecent(['a', 'b'], { a: 1, b: 2 })).toBe('b')
  expect(mostRecent(['a', 'b'], {})).toBe('b')
  expect(mostRecent([], {})).toBeUndefined()
})
