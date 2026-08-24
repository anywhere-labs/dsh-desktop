import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDesktopExitCoordinator,
  createDesktopShutdown,
  installShutdownRequests,
  type DesktopQuitEvent,
  type DesktopQuitSource,
  type DesktopSignalSource,
} from '../src/shutdown.ts'

afterEach(() => { vi.useRealTimers() })

describe('application shutdown requests', () => {
  it('relaunches only a successful exit after a mode change', () => {
    const beforeExit = vi.fn()
    const native = {
      prepareToQuit: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
    }
    const coordinator = createDesktopExitCoordinator(native, beforeExit)

    coordinator.requestRelaunch()
    coordinator.finish(0)

    expect(beforeExit).toHaveBeenCalledOnce()
    expect(native.prepareToQuit).toHaveBeenCalledOnce()
    expect(native.relaunch).toHaveBeenCalledOnce()
    expect(native.exit).toHaveBeenCalledWith(0)
  })

  it('does not relaunch a failed generation', () => {
    const native = {
      prepareToQuit: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
    }
    const coordinator = createDesktopExitCoordinator(native, () => {})

    coordinator.requestRelaunch()
    coordinator.finish(1)

    expect(native.relaunch).not.toHaveBeenCalled()
    expect(native.exit).toHaveBeenCalledWith(1)
  })

  it('runs a native handoff after cleanup and before a successful exit', async () => {
    const events: string[] = []
    const native = {
      prepareToQuit: vi.fn(() => { events.push('prepare') }),
      relaunch: vi.fn(),
      exit: vi.fn(() => { events.push('exit') }),
    }
    const coordinator = createDesktopExitCoordinator(native, () => { events.push('cleanup') })
    coordinator.requestBeforeExit(async () => {
      events.push('handoff:start')
      await Promise.resolve()
      events.push('handoff:done')
    })

    await coordinator.finish(0)

    expect(events).toEqual(['cleanup', 'prepare', 'handoff:start', 'handoff:done', 'exit'])
    expect(native.relaunch).not.toHaveBeenCalled()
  })

  it('skips a native handoff on failed shutdown and exits nonzero when handoff fails', async () => {
    const native = {
      prepareToQuit: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
    }
    const skipped = vi.fn()
    const failed = createDesktopExitCoordinator(native, () => {})
    failed.requestBeforeExit(skipped)
    await failed.finish(1)
    expect(skipped).not.toHaveBeenCalled()
    expect(native.exit).toHaveBeenLastCalledWith(1)

    const rejected = createDesktopExitCoordinator(native, () => {})
    rejected.requestBeforeExit(async () => { throw new Error('launch failed') })
    await rejected.finish(0)
    expect(native.exit).toHaveBeenLastCalledWith(1)
  })

  it('does not allow relaunch and native handoff requests to conflict', () => {
    const native = {
      prepareToQuit: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
    }
    const relaunch = createDesktopExitCoordinator(native, () => {})
    relaunch.requestRelaunch()
    expect(() => { relaunch.requestBeforeExit(() => {}) }).toThrow('native exit action')

    const handoff = createDesktopExitCoordinator(native, () => {})
    handoff.requestBeforeExit(() => {})
    expect(() => { handoff.requestRelaunch() }).toThrow('native exit handoff')
  })

  it('exits after graceful disposal and ignores later completions', async () => {
    const dispose = vi.fn(async () => {})
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(dispose, exit)

    await shutdown.request(0)
    await shutdown.request(1)

    expect(dispose).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('awaits asynchronous finalization after graceful disposal', async () => {
    const events: string[] = []
    let finishExit!: () => void
    const shutdown = createDesktopShutdown(
      async () => { events.push('dispose') },
      async () => {
        events.push('exit:start')
        await new Promise<void>(resolve => { finishExit = resolve })
        events.push('exit:done')
      },
    )

    const request = shutdown.request(0)
    await vi.waitFor(() => { expect(events).toContain('exit:start') })
    expect(events).toEqual(['dispose', 'exit:start'])
    finishExit()
    await request
    expect(events).toEqual(['dispose', 'exit:start', 'exit:done'])
  })

  it('forces a wedged shutdown after the grace period', async () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(
      () => new Promise<void>(() => {}),
      exit,
      25,
    )
    const request = shutdown.request(0)

    await vi.advanceTimersByTimeAsync(25)

    expect(request).toBeInstanceOf(Promise)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('marks a failed disposal so a requested relaunch cannot proceed', async () => {
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(
      async () => { throw new Error('dispose failed') },
      exit,
    )

    await shutdown.request(0)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('keeps duplicate graceful quit requests idempotent while disposal is pending', async () => {
    let finish!: () => void
    const dispose = () => new Promise<void>((resolve) => { finish = resolve })
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(dispose, exit, 5_000)
    const first = shutdown.request(0)
    await Promise.resolve()

    const duplicate = shutdown.request(0)
    expect(duplicate).toBe(first)
    expect(exit).not.toHaveBeenCalled()

    finish()
    await first
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('escalates a repeated request without waiting for disposal', async () => {
    let finish!: () => void
    const dispose = () => new Promise<void>((resolve) => { finish = resolve })
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(dispose, exit, 5_000)
    const first = shutdown.request(0)
    await Promise.resolve()

    void shutdown.request(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    finish()
    await first
    expect(exit).toHaveBeenCalledOnce()
  })

  it('routes native quit and process signals through one removable coordinator', () => {
    const signalListeners = new Map<string, () => void>()
    const appListeners = new Map<string, (event: DesktopQuitEvent) => void>()
    const signals: DesktopSignalSource = {
      on: (event, listener) => signalListeners.set(event, listener),
      off: (event, listener) => {
        if (signalListeners.get(event) === listener) signalListeners.delete(event)
      },
    }
    const app: DesktopQuitSource = {
      on: (event, listener) => appListeners.set(event, listener),
      off: (event, listener) => {
        if (appListeners.get(event) === listener) appListeners.delete(event)
      },
    }
    const requestQuit = vi.fn()
    const remove = installShutdownRequests(signals, app, requestQuit)
    const quitEvent = { preventDefault: vi.fn() }

    signalListeners.get('SIGINT')?.()
    signalListeners.get('SIGTERM')?.()
    appListeners.get('before-quit')?.(quitEvent)

    expect(requestQuit.mock.calls).toEqual([[130], [0], [0]])
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()

    remove()
    expect(signalListeners.size).toBe(0)
    expect(appListeners.size).toBe(0)
  })
})
