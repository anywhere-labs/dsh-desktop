import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseDesktopSessionJumpResponse,
  startDesktopSessionJumpPoll,
} from '../src/client/session-jump.ts'
import { DESKTOP_SESSION_JUMP_PATH } from '../src/desktop-settings-contract.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('desktop session jump poll', () => {
  it('opens the queued session and keeps polling', async () => {
    vi.useFakeTimers()
    const open = vi.fn()
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionId: 'session-9' }), { status: 200 }))
    const stop = startDesktopSessionJumpPoll({ sessions: { open } }, fetcher)
    try {
      expect(fetcher).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1600)
      expect(fetcher).toHaveBeenCalledWith(DESKTOP_SESSION_JUMP_PATH, expect.objectContaining({ method: 'GET' }))
      expect(open).toHaveBeenCalledWith('session-9')
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally { stop() }
  })

  it('ignores empty jumps and logs unknown ids without breaking the poll', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const open = vi.fn(() => { throw new Error('unknown session') })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    const stop = startDesktopSessionJumpPoll({ sessions: { open } }, fetcher)
    try {
      await vi.advanceTimersByTimeAsync(1600)
      expect(open).not.toHaveBeenCalled()
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ sessionId: 'gone' }), { status: 200 }))
      await vi.advanceTimersByTimeAsync(2000)
      expect(open).toHaveBeenCalledWith('gone')
      expect(error).toHaveBeenCalled()
    } finally { stop(); error.mockRestore() }
  })

  it('validates jump responses at the renderer boundary', () => {
    expect(parseDesktopSessionJumpResponse({ sessionId: 'abc' })).toBe('abc')
    expect(parseDesktopSessionJumpResponse({})).toBeUndefined()
    expect(parseDesktopSessionJumpResponse({ sessionId: '' })).toBeUndefined()
    expect(parseDesktopSessionJumpResponse({ sessionId: 42 })).toBeUndefined()
    expect(parseDesktopSessionJumpResponse(null)).toBeUndefined()
  })
})
