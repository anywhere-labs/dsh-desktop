/**
 * Behaviour tests for the Desktop browser panel controller.
 *
 * The controller polls the Host channel on its own timer, so these tests script
 * the channel's answers and drive the clock instead of an Electron window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopBrowserPanelController } from '../src/client/browser-panel.ts'

/** One tab of a scripted Host state. */
const tab = (id: string, url: string) => ({ id, url, title: url, loading: false })

/** A Host state whose active tab is the first of `tabs`. */
const stateOf = (tabs: readonly ReturnType<typeof tab>[], activeId = tabs[0]?.id ?? null, error?: string) => ({
  activeId,
  tabs,
  canGoBack: false,
  canGoForward: false,
  viewport: { width: 800, height: 600 },
  visible: true,
  layout: 'fit',
  zoom: 1,
  ...(error === undefined ? {} : { error }),
})

/** Answer every channel exchange with the next scripted state, then the last. */
function scriptHost(states: readonly unknown[]): { calls: number } {
  const counter = { calls: 0 }
  globalThis.fetch = vi.fn(async () => {
    const index = Math.min(counter.calls, states.length - 1)
    counter.calls += 1
    return new Response(JSON.stringify({ ok: true, state: states[index], panel: { visible: true, epoch: 0 } }), {
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return counter
}

// The controller places its rectangle through the frame clock; this suite runs
// without a DOM, so the clock is a synchronous stub.
beforeEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Desktop browser panel address field', () => {
  it('keeps the draft while the Host keeps reporting the blank tab', async () => {
    vi.useFakeTimers()
    scriptHost([stateOf([tab('tab-1', 'about:blank')])])
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(1_000)

    controller.setAddress('https://example.com/')
    await vi.advanceTimersByTimeAsync(4_000)

    // A poll runs every second; none of them may replace what the user typed.
    expect(controller.getSnapshot().address).toBe('https://example.com/')
    controller.dispose()
  })

  it('holds the shared column only while the panel is on screen', async () => {
    vi.useFakeTimers()
    scriptHost([stateOf([tab('tab-1', 'https://example.com/')])])
    const ensure = vi.fn()
    const idle = vi.fn()
    const controller = new DesktopBrowserPanelController('session-a', { onEnsure: ensure, onIdle: idle })
    controller.setOpen(true)
    controller.setActive(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ensure).toHaveBeenCalled()

    // The user switched to a Session whose panel is closed: this panel stays
    // open in the background but must stop re-asserting the column, otherwise
    // the Session on screen shows an empty track beside the conversation.
    ensure.mockClear()
    controller.setActive(false)
    expect(idle).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(ensure).not.toHaveBeenCalled()

    controller.setActive(true)
    expect(ensure).toHaveBeenCalled()
    controller.dispose()
  })

  it('keeps a dismissed notice away from the tab it came from only', async () => {
    vi.useFakeTimers()
    const text = 'https://nope.example/ -105: ERR_NAME_NOT_RESOLVED'
    let state = stateOf([tab('tab-1', 'https://nope.example/')], 'tab-1', text)
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, state, panel: { visible: true, epoch: 0 } }),
      { headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getSnapshot().loadError).toBe(text)
    controller.dismissError()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getSnapshot().loadError).toBeUndefined()

    // Another tab reports the same failure, which this user has not dismissed.
    state = stateOf([tab('tab-1', 'https://nope.example/'), tab('tab-2', 'https://nope.example/')], 'tab-2', text)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.getSnapshot().loadError).toBe(text)
    controller.dispose()
  })

  it('shows a failed load and keeps a dismissed notice dismissed', async () => {
    vi.useFakeTimers()
    scriptHost([stateOf([tab('tab-1', 'https://nope.example/')], 'tab-1', 'https://nope.example/ -105: ERR_NAME_NOT_RESOLVED')])
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(controller.getSnapshot().loadError).toBe('https://nope.example/ -105: ERR_NAME_NOT_RESOLVED')
    expect(controller.getSnapshot().error).toBeUndefined()

    // The tab keeps the address that failed, so the field mirrors it, and a
    // draft the user is still typing is left alone by the next polls.
    expect(controller.getSnapshot().address).toBe('https://nope.example/')
    controller.setAddress('nope.example/other')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(controller.getSnapshot().address).toBe('nope.example/other')

    controller.dismissError()
    expect(controller.getSnapshot().loadError).toBeUndefined()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(controller.getSnapshot().loadError).toBeUndefined()
    // The draft the user is typing survives the polls that follow.
    expect(controller.getSnapshot().address).toBe('nope.example/other')

    // Asking for the address again is a new attempt, so the same failure is
    // reported once more instead of staying dismissed.
    await controller.submitAddress()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(controller.getSnapshot().loadError).toBe('https://nope.example/ -105: ERR_NAME_NOT_RESOLVED')
    controller.dispose()
  })

  it('follows the active tab when the page changes', async () => {
    vi.useFakeTimers()
    scriptHost([
      stateOf([tab('tab-1', 'about:blank'), tab('tab-2', 'https://example.com/')], 'tab-1'),
      stateOf([tab('tab-1', 'about:blank'), tab('tab-2', 'https://example.com/')], 'tab-2'),
    ])
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(6_000)

    expect(controller.getSnapshot().address).toBe('https://example.com/')
    controller.dispose()
  })

  it('opens the first tab from the address field when the panel is empty', async () => {
    vi.useFakeTimers()
    scriptHost([{ ...stateOf([]), activeId: null }])
    const bodies: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (_input: unknown, init?: { body?: string }) => {
      if (typeof init?.body === 'string') bodies.push(init.body)
      return await original(_input as RequestInfo, init as RequestInit)
    }) as unknown as typeof fetch
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(1_000)

    controller.setAddress('https://example.com/')
    await controller.submitAddress()

    expect(bodies.some(body => body.includes('"tabs"') && body.includes('https://example.com/'))).toBe(true)
    controller.dispose()
  })

  it('follows a page that navigates itself, and keeps a draft typed afterwards', async () => {
    vi.useFakeTimers()
    scriptHost([
      stateOf([tab('tab-1', 'https://example.com/')]),
      stateOf([tab('tab-1', 'https://example.com/docs')]),
      stateOf([tab('tab-1', 'https://example.com/docs')]),
    ])
    const controller = new DesktopBrowserPanelController('session-a')
    controller.setOpen(true)
    controller.start()
    await vi.advanceTimersByTimeAsync(2_000)

    // The page moved on its own, so the field follows.
    expect(controller.getSnapshot().address).toBe('https://example.com/docs')

    controller.setAddress('https://example.com/search')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(controller.getSnapshot().address).toBe('https://example.com/search')
    controller.dispose()
  })
})
