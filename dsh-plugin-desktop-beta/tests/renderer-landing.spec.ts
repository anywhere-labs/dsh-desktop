import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  HOLD_WINDOW_MS,
  landRendererDocument,
  OFFICIAL_SELECTION_KEY,
  RendererSessionGuard,
  rendererLandingOf,
  selectedSessionId,
} from '../src/renderer-landing.ts'

const require = createRequire(import.meta.url)

function storage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

it('reads the Session the official selection will restore', () => {
  expect(selectedSessionId(JSON.stringify({ sessionId: 'session-1' }))).toBe('session-1')
  // A subagent view stores its Session beside the subagent address.
  expect(selectedSessionId(JSON.stringify({ sessionId: 'child-1', subagentAddress: { kind: 'subagent' } }))).toBe('child-1')
  for (const stored of [null, undefined, '', '{}', '[]', 'null', '{broken', JSON.stringify({ sessionId: 7 }), JSON.stringify({ sessionId: 'x'.repeat(201) })]) {
    expect(selectedSessionId(stored)).toBeUndefined()
  }
})

it('accepts only a well-formed landing', () => {
  const landing = { sessionId: 'session-1', failures: 2, reason: 'crashed', exitCode: -2147483645 }
  expect(rendererLandingOf(landing)).toEqual(landing)
  expect(rendererLandingOf({ ...landing, reason: 'r'.repeat(80) })?.reason).toHaveLength(40)
  for (const value of [null, undefined, 'session-1', { ...landing, sessionId: '' }, { ...landing, failures: 0 },
    { ...landing, failures: 1.5 }, { ...landing, exitCode: '1' }, { ...landing, reason: 1 }]) {
    expect(rendererLandingOf(value)).toBeUndefined()
  }
})

it('restores a Session after its first renderer failure and holds it back after the second (#1690)', () => {
  let now = 1_000
  const guard = new RendererSessionGuard(() => now)
  expect(guard.landing('session-1')).toBeUndefined()
  guard.failed('crashed', -2147483645)
  expect(guard.landing('session-1')).toEqual({ sessionId: 'session-1', failures: 1, held: false, reason: 'crashed', exitCode: -2147483645 })
  // Only the first document after a failure learns of it.
  expect(guard.landing('session-1')).toBeUndefined()
  now += 45_000
  guard.failed('oom', -536870904)
  expect(guard.landing('session-1')).toEqual({ sessionId: 'session-1', failures: 2, held: true, reason: 'oom', exitCode: -536870904 })
  // A held Session opened again by hand lands elsewhere at its next failure, however much later.
  now += HOLD_WINDOW_MS * 3
  guard.failed('crashed', 5)
  expect(guard.landing('session-1')).toMatchObject({ failures: 3, held: true })
  // Without a failure, a reload keeps the Session the user chose to open.
  expect(guard.landing('session-1')).toBeUndefined()
})

it('holds a Session back only for failures close together, and pairs each failure with one Session', () => {
  let now = 0
  const guard = new RendererSessionGuard(() => now)
  guard.failed('crashed', 1)
  expect(guard.landing('session-1')?.held).toBe(false)
  now += HOLD_WINDOW_MS
  guard.failed('crashed', 1)
  expect(guard.landing('session-1')).toMatchObject({ failures: 2, held: false })
  // A failure with nothing selected belongs to no Session, and is not carried to a later document.
  guard.failed('crashed', 1)
  expect(guard.landing(undefined)).toBeUndefined()
  expect(guard.landing('session-1')).toBeUndefined()
  // Another Session's failure does not count for this one.
  guard.failed('crashed', 1)
  expect(guard.landing('session-2')).toMatchObject({ sessionId: 'session-2', failures: 1, held: false })
  now += 1
  guard.failed('crashed', 1)
  expect(guard.landing('session-1')).toMatchObject({ failures: 3, held: true })
})

it('ignores renderer exits the page did not cause', () => {
  const guard = new RendererSessionGuard(() => 0)
  for (const reason of ['clean-exit', 'launch-failed', 'integrity-failure']) {
    guard.failed(reason, 0)
    expect(guard.landing('session-1')).toBeUndefined()
  }
  for (const reason of ['crashed', 'oom', 'killed', 'abnormal-exit', 'memory-eviction']) guard.failed(reason, 1)
  expect(guard.landing('session-1')).toMatchObject({ reason: 'memory-eviction', failures: 1 })
})

it('removes the selection only when the main process holds back the Session it names', () => {
  const landing = { sessionId: 'session-1', failures: 2, reason: 'crashed', exitCode: -2147483645 }
  const selected = { [OFFICIAL_SELECTION_KEY]: JSON.stringify({ sessionId: 'session-1' }) }

  const held = storage(selected)
  const ask = vi.fn(() => landing)
  expect(landRendererDocument(ask, () => held)).toEqual(landing)
  expect(ask).toHaveBeenCalledExactlyOnceWith('session-1')
  expect(held.values.has(OFFICIAL_SELECTION_KEY)).toBe(false)

  const restored = storage(selected)
  expect(landRendererDocument(() => null, () => restored)).toBeUndefined()
  expect(restored.removeItem).not.toHaveBeenCalled()

  // An answer about another Session never removes this one.
  const other = storage({ [OFFICIAL_SELECTION_KEY]: JSON.stringify({ sessionId: 'session-2' }) })
  expect(landRendererDocument(() => landing, () => other)).toBeUndefined()
  expect(other.removeItem).not.toHaveBeenCalled()

  // The question is asked without a selection too, so the main process can settle the last failure.
  const empty = storage({})
  const askEmpty = vi.fn(() => null)
  expect(landRendererDocument(askEmpty, () => empty)).toBeUndefined()
  expect(askEmpty).toHaveBeenCalledExactlyOnceWith(null)
})

it('never throws into the preload when storage or the main process fails', () => {
  const denied = vi.fn(() => null)
  expect(landRendererDocument(denied, () => { throw new Error('SecurityError') })).toBeUndefined()
  expect(denied).toHaveBeenCalledExactlyOnceWith(null)
  const selected = storage({ [OFFICIAL_SELECTION_KEY]: JSON.stringify({ sessionId: 'session-1' }) })
  expect(landRendererDocument(() => { throw new Error('no listener') }, () => selected)).toBeUndefined()
  selected.removeItem.mockImplementation(() => { throw new Error('quota') })
  expect(landRendererDocument(() => ({ sessionId: 'session-1', failures: 2, reason: 'crashed', exitCode: 1 }), () => selected)).toBeUndefined()
  expect(landRendererDocument(() => ({ sessionId: 'session-1', failures: 2, reason: 'crashed', exitCode: 1 }), () => undefined)).toBeUndefined()
})

it('matches where the shipped official client keeps and restores its main-view selection', () => {
  // The preload edits upstream state it does not own; a release that moves it must fail here, not in the field.
  const workspace = dirname(require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json'))
  expect(readFileSync(join(workspace, 'lib', 'client.js'), 'utf8')).toContain(`name:\`${OFFICIAL_SELECTION_KEY}\``)
  const navigation = readFileSync(join(workspace, 'src', 'client', 'navigation.ts'), 'utf8')
  expect(navigation).toContain(`persist: { name: '${OFFICIAL_SELECTION_KEY}' }`)
  // Without a saved Session, restoration falls back to a blank conversation in the most recent workspace.
  expect(navigation).toMatch(/const summary = saved\.sessionId === undefined \? undefined/u)
  expect(navigation).toContain('recentWorkspace(workspaces.items, sessions.byId)')
  const store = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-store/package.json')), 'src', 'index.ts'), 'utf8')
  expect(store).toContain('localStorage.getItem(name)')
  expect(store).toContain('localStorage.setItem(name, JSON.stringify(state))')
})

it('names the conversation in a field the log masking keeps', async () => {
  // The written log masks a field called `session` as a credential, which would leave a failure without its conversation.
  const { maskSecrets } = await import('../src/mask-secrets.ts')
  expect(maskSecrets(JSON.stringify({ conversation: 'session-1', failures: 2 }))).toBe('{"conversation":"session-1","failures":2}')
  expect(maskSecrets(JSON.stringify({ session: 'session-1' }))).not.toContain('session-1')
})
