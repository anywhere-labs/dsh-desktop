import { describe, expect, it } from 'vitest'
import { digestAgentError, formatAgentErrorLine } from '../src/agent-error-logging.ts'
import { maskSecrets } from '../src/mask-secrets.ts'

const SESSION_ID = 'ws-1-session-9f2c1a7e-3b44-4c10-9e55-7a1d2f6b8c30'

describe('digestAgentError', () => {
  it('collects a code from every level and flattens the chain', () => {
    const root = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const wrapped = Object.assign(
      new Error('DeepSeek request extension preparation failed', { cause: root }),
      { code: 'REQUEST_EXTENSION' },
    )

    expect(digestAgentError(wrapped)).toEqual({
      text: 'DeepSeek request extension preparation failed: socket hang up',
      codes: ['REQUEST_EXTENSION', 'ECONNRESET'],
    })
  })

  it('reports the same code once however often the chain repeats it', () => {
    const root = Object.assign(new Error('inner'), { code: 'REQUEST_EXTENSION' })
    const wrapped = Object.assign(new Error('outer', { cause: root }), { code: 'REQUEST_EXTENSION' })

    expect(digestAgentError(wrapped).codes).toEqual(['REQUEST_EXTENSION'])
  })

  it('renders AggregateError members and their codes', () => {
    const parts = [Object.assign(new Error('a'), { code: 'A_FAILED' }), new Error('b')]

    expect(digestAgentError(new AggregateError(parts, 'both failed'))).toEqual({
      text: 'both failed [a; b]',
      codes: ['A_FAILED'],
    })
  })

  it('survives a cycle instead of recursing forever', () => {
    const outer = new Error('outer')
    const inner = new Error('inner', { cause: outer })
    ;(outer as { cause?: unknown }).cause = inner

    expect(digestAgentError(outer).text).toBe('outer: inner: <circular cause>')
  })

  it('renders a cause shared by two branches in full rather than calling it circular', () => {
    const shared = new Error('shared')
    const parts = [new Error('left', { cause: shared }), new Error('right', { cause: shared })]

    expect(digestAgentError(new AggregateError(parts, 'both failed')).text)
      .toBe('both failed [left: shared; right: shared]')
  })

  it('skips a cause that only repeats its wrapper verbatim', () => {
    expect(digestAgentError(new Error('same', { cause: new Error('same') })).text).toBe('same')
  })

  it('falls back to the error name when the message is empty', () => {
    expect(digestAgentError(new RangeError()).text).toBe('RangeError')
  })

  it('handles values that are not Errors', () => {
    expect(digestAgentError({ code: 'RPC_FAILED', message: 'remote refused' }))
      .toEqual({ text: 'remote refused', codes: ['RPC_FAILED'] })
    expect(digestAgentError('plain string')).toEqual({ text: 'plain string', codes: [] })
    expect(digestAgentError(undefined)).toEqual({ text: 'undefined', codes: [] })
  })

  it('collapses only the hostile level, keeping the rest of the chain', () => {
    const hostile = new Error('replaced below')
    Object.defineProperty(hostile, 'message', {
      get(): string { throw new Error('hostile accessor') },
    })

    expect(digestAgentError(new Error('outer', { cause: hostile })).text)
      .toBe('outer: <unrenderable value>')
  })

  it('caps the summary so one oversized provider body cannot flood the line', () => {
    const text = digestAgentError(new Error('x'.repeat(5000))).text

    expect(text).toHaveLength(2001)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('formatAgentErrorLine', () => {
  it('names the failing turn and every code ahead of the chain', () => {
    const error = Object.assign(new Error('preparation failed'), { code: 'REQUEST_EXTENSION' })

    expect(formatAgentErrorLine(SESSION_ID, 3, 2, error))
      .toBe(`agent turn failed (session ${SESSION_ID}, turn 3, step 2) [REQUEST_EXTENSION]: preparation failed`)
  })

  it('omits the bracket when no level carries a code', () => {
    expect(formatAgentErrorLine(SESSION_ID, 0, 0, new Error('plain')))
      .toBe(`agent turn failed (session ${SESSION_ID}, turn 0, step 0): plain`)
  })

  // Regression guard: `code` and `session` are secret-shaped field names in
  // mask-secrets.ts, so spelling them `code: X` or `session: X` would replace
  // the two identifiers this line exists to expose with `****`.
  it('keeps the code and the session identity through maskSecrets', () => {
    const error = Object.assign(new Error('preparation failed'), { code: 'REQUEST_EXTENSION' })

    const line = maskSecrets(formatAgentErrorLine(SESSION_ID, 3, 2, error))

    expect(line).toContain('[REQUEST_EXTENSION]')
    expect(line).toContain(`session ${SESSION_ID}`)
    expect(line).not.toContain('****')
  })
})
