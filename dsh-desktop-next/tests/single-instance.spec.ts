import { describe, expect, it, vi } from 'vitest'
import { claimDesktopSingleInstance, type DesktopSingleInstanceApplication } from '../src/single-instance.ts'

describe('desktop single-instance ownership', () => {
  it('honors the existing NSIS quit handoff without focusing or booting the Host', () => {
    let listener: ((event?: unknown, argv?: string[]) => void) | undefined
    const app = { requestSingleInstanceLock: () => true, quit: vi.fn(), on: (_event: 'second-instance', handler: typeof listener) => { listener = handler } }
    const focus = vi.fn()
    expect(claimDesktopSingleInstance(app, focus, { platform: 'win32', argv: ['DSH NEXT.exe'] })).toBe(true)
    listener?.({}, ['DSH NEXT.exe', '--dsh-installer-quit'])
    expect(app.quit).toHaveBeenCalledOnce(); expect(focus).not.toHaveBeenCalled()
    expect(claimDesktopSingleInstance(app, focus, { platform: 'win32', argv: ['DSH NEXT.exe', '--dsh-installer-quit'] })).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(2)
  })
  it('quits a second process without registering lifecycle work', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const application = {
      requestSingleInstanceLock: () => false,
      quit,
      on,
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('routes a later launch to the primary process', () => {
    let secondInstance: (() => void) | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.()
    expect(focus).toHaveBeenCalledOnce()
  })
})
