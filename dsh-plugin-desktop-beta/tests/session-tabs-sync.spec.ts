import { expect, it } from 'vitest'
import {
  ALIVE_TTL_MS, MAX_READ, READ_SKEW_MS, SESSION_TABS_KEYS, alivePages, beat, initialSource, markRead, openKeepMs,
  otherOpenPages, publishPending, readElsewhere, readPendingMap, readReadMap, remotePending, type KeyValueStore,
} from '../src/client/session-tabs-sync.ts'
import { tabShortcut, type KeyFacts } from '../src/client/session-tabs-keys.ts'
import { badges, chooseIconLink } from '../src/client/session-tabs-icon.ts'

/** A storage double that keeps strings in a map. */
function memory(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
}

it('keeps a quiet browser page open for days but an Electron window only for the live window', () => {
  expect(openKeepMs(true)).toBe(ALIVE_TTL_MS)
  expect(openKeepMs(false)).toBeGreaterThan(ALIVE_TTL_MS)
})

it('beats a heartbeat, says goodbye, and drops the same tab\'s previous document', () => {
  const store = memory()
  beat(store, 'old', 0, { keepMs: 1000 })
  beat(store, 'other', 0, { keepMs: 1000 })
  beat(store, 'new', 10, { keepMs: 1000, predecessor: 'old' })
  expect(otherOpenPages(store, 'new', 10, 1000)).toEqual(new Set(['other']))
  beat(store, 'new', 20, { keepMs: 1000, remove: true })
  expect(otherOpenPages(store, 'other', 20, 1000)).toEqual(new Set())
  // A page quiet for longer than the keep window no longer counts as open.
  expect(otherOpenPages(store, 'zzz', 5000, 1000)).toEqual(new Set())
})

it('lists pages alive within the live window, this one included', () => {
  const store = memory()
  beat(store, 'a', 0, { keepMs: 10 * ALIVE_TTL_MS })
  expect(alivePages(store, 'me', 1000)).toEqual(new Set(['me', 'a']))
  expect(alivePages(store, 'me', ALIVE_TTL_MS + 1)).toEqual(new Set(['me']))
})

it('chooses where a new page\'s strip comes from', () => {
  const none = new Set<string>()
  // This tab's own storage after a reload.
  expect(initialSource({ hasOwn: true, owner: 'me-before', openPages: none, reloadedInPlace: true })).toBe('session')
  expect(initialSource({ hasOwn: true, owner: undefined, openPages: new Set(['x']), reloadedInPlace: false })).toBe('session')
  // A copy handed to a new tab while its owner is still open starts clean.
  expect(initialSource({ hasOwn: true, owner: 'x', openPages: new Set(['x']), reloadedInPlace: false })).toBe('fresh')
  // The same copy after a reload of that new tab is its own again.
  expect(initialSource({ hasOwn: true, owner: 'x', openPages: new Set(['x']), reloadedInPlace: true })).toBe('session')
  // A sibling of an open page starts clean; the first page after a restart restores the snapshot.
  expect(initialSource({ hasOwn: false, owner: undefined, openPages: new Set(['x']), reloadedInPlace: false })).toBe('fresh')
  expect(initialSource({ hasOwn: false, owner: undefined, openPages: none, reloadedInPlace: false })).toBe('snapshot')
})

it('records read facts, keeps the newest, and expires old ones', () => {
  const store = memory()
  markRead(store, 'a', 100)
  markRead(store, 'a', 50)
  expect(readReadMap(store, 200)).toEqual({ a: 100 })
  for (let index = 0; index < MAX_READ + 5; index += 1) markRead(store, `s${String(index)}`, 1000 + index)
  const map = readReadMap(store, 2000)
  expect(Object.keys(map)).toHaveLength(MAX_READ)
  expect(map.a).toBeUndefined()
  expect(readReadMap(store, 1000 + 8 * 24 * 3600 * 1000)).toEqual({})
  markRead(undefined, 'a', 1)
  markRead(store, '', 1)
})

it('counts a Session as read elsewhere when shown after it turned unread, within clock skew', () => {
  expect(readElsewhere({ a: 1000 }, 'a', 1000 + READ_SKEW_MS)).toBe(true)
  expect(readElsewhere({ a: 1000 }, 'a', 1000 + READ_SKEW_MS + 1)).toBe(false)
  expect(readElsewhere({}, 'a', 0)).toBe(false)
})

it('publishes this page\'s pending Sessions, keeping live pages\' entries and dropping dead ones', () => {
  const store = memory()
  store.setItem(SESSION_TABS_KEYS.pending, JSON.stringify({ x: { page: 'live', at: 1 }, y: { page: 'dead', at: 1 }, z: 'bad' }))
  publishPending(store, 'me', ['a'], new Set(['me', 'live']), 5)
  expect(readPendingMap(store)).toEqual({ x: { page: 'live', at: 1 }, a: { page: 'me', at: 5 } })
  // Republishing keeps the original time of an entry this page already owns.
  publishPending(store, 'me', ['a'], new Set(['me', 'live']), 9)
  expect(readPendingMap(store).a).toEqual({ page: 'me', at: 5 })
  publishPending(store, 'me', [], new Set(['me', 'live']), 10)
  expect(readPendingMap(store)).toEqual({ x: { page: 'live', at: 1 } })
  expect(remotePending(readPendingMap(store), 'me', new Set(['me', 'live']))).toEqual(new Set(['x']))
  expect(remotePending(readPendingMap(store), 'live', new Set(['live']))).toEqual(new Set())
})

const key = (overrides: Partial<KeyFacts>): KeyFacts => ({
  code: '', altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...overrides,
})

it('maps Alt+Shift shortcuts and Shift+Arrow, and ignores anything else', () => {
  const alt = { altKey: true, shiftKey: true }
  expect(tabShortcut(key({ ...alt, code: 'ArrowRight' }))).toEqual({ kind: 'step', delta: 1 })
  expect(tabShortcut(key({ ...alt, code: 'ArrowLeft', repeat: true }))).toEqual({ kind: 'step', delta: -1 })
  expect(tabShortcut(key({ ...alt, code: 'Digit9' }))).toEqual({ kind: 'jump', n: 9 })
  expect(tabShortcut(key({ ...alt, code: 'KeyW' }))).toEqual({ kind: 'close' })
  expect(tabShortcut(key({ ...alt, code: 'KeyT' }))).toEqual({ kind: 'reopen' })
  expect(tabShortcut(key({ ...alt, code: 'KeyN' }))).toEqual({ kind: 'new' })
  expect(tabShortcut(key({ shiftKey: true, code: 'ArrowLeft' }))).toEqual({ kind: 'shift', delta: -1 })
  expect(tabShortcut(key({ ...alt, code: 'KeyW', repeat: true }))).toBeUndefined()
  expect(tabShortcut(key({ ...alt, code: 'KeyW', ctrlKey: true }))).toBeUndefined()
  expect(tabShortcut(key({ ...alt, code: 'KeyW', isComposing: true }))).toBeUndefined()
  expect(tabShortcut(key({ ...alt, code: 'KeyW', defaultPrevented: true }))).toBeUndefined()
  expect(tabShortcut(key({ ...alt, code: 'Digit0' }))).toBeUndefined()
  expect(tabShortcut(key({ altKey: true, code: 'ArrowLeft' }))).toBeUndefined()
})

it('badges the icon only for states that need attention', () => {
  expect(badges(undefined)).toBe(false)
  expect(badges({ state: 'idle', accent: '', warn: '' })).toBe(false)
  expect(badges({ state: 'awaiting', accent: '', warn: '' })).toBe(true)
})

it('draws the badge from the icon matching the colour scheme, then one without media, then the first', () => {
  const link = (media: string | null) => ({ media, getAttribute: (name: string) => name === 'media' ? media : null })
  const light = link('(prefers-color-scheme: light)')
  const dark = link('(prefers-color-scheme: dark)')
  const plain = link(null)
  expect(chooseIconLink([light, dark, plain], media => media.includes('dark'))).toBe(dark)
  expect(chooseIconLink([light, plain], () => false)).toBe(plain)
  expect(chooseIconLink([light], () => false)).toBe(light)
  expect(chooseIconLink([], () => true)).toBeUndefined()
})
