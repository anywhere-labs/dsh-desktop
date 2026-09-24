// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { DesktopClientEnvironment } from '../src/client/environment.ts'
import { applyDesktopFind, DESKTOP_FIND_LOCALE_NAMESPACE, DESKTOP_FIND_SLOT_ID } from '../src/client/find-bar.ts'
import { DesktopFindController } from '../src/client/find-controller.ts'
import { en, zh } from '../src/client/find-locales.ts'

const ENVIRONMENT: DesktopClientEnvironment = {
  version: '2.0.13-beta.1',
  mode: 'compatibility',
  platform: 'darwin',
  material: 'off',
  micaSupported: false,
}

interface FakeContext {
  readonly ctx: ClientContext
  readonly effects: (() => void)[]
  readonly labels: string[]
  readonly localeRegister: ReturnType<typeof vi.fn>
  readonly slotsInject: ReturnType<typeof vi.fn>
  readonly slotsRegister: ReturnType<typeof vi.fn>
}

/**
 * Minimal Cordis double.
 *
 * `applyDesktopFind` only reaches for `effect`, `locale.register`, and the
 * `shell.overlay` seat, so the double records exactly those and runs every
 * effect body the way the fiber would.
 */
function fakeContext(): FakeContext {
  const effects: (() => void)[] = []
  const labels: string[] = []
  const localeRegister = vi.fn(() => () => {})
  const slotsRegister = vi.fn(() => () => {})
  const slotsInject = vi.fn((_name: string, callback: () => unknown) => {
    callback()
    return () => {}
  })
  const ctx = {
    effect: vi.fn((factory: () => unknown, label: string) => {
      const disposer = factory()
      if (typeof disposer === 'function') {
        effects.push(disposer as () => void)
        labels.push(label)
      }
      return disposer
    }),
    locale: { register: localeRegister },
    slots: { inject: slotsInject, register: slotsRegister },
  } as unknown as ClientContext
  return { ctx, effects, labels, localeRegister, slotsInject, slotsRegister }
}

function keydown(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach(style => { style.remove() })
})

describe('applyDesktopFind', () => {
  it('registers the find-bar dictionaries, styles, and overlay seat', () => {
    const { ctx, localeRegister, slotsInject, slotsRegister } = fakeContext()
    applyDesktopFind(ctx, ENVIRONMENT)

    expect(localeRegister).toHaveBeenCalledWith(DESKTOP_FIND_LOCALE_NAMESPACE, { zh, en })
    expect(slotsInject).toHaveBeenCalledWith('shell.overlay', expect.any(Function))

    const options = slotsRegister.mock.calls[0]?.[0] as {
      name: string
      id: string
      locale: string
      inject: () => { controller: DesktopFindController; environment: DesktopClientEnvironment }
    }
    expect(options.name).toBe('shell.overlay')
    expect(options.id).toBe(DESKTOP_FIND_SLOT_ID)
    expect(options.locale).toBe(DESKTOP_FIND_LOCALE_NAMESPACE)
    expect(options.inject().environment).toBe(ENVIRONMENT)
    expect(options.inject().controller).toBeInstanceOf(DesktopFindController)

    const style = document.getElementById('dsh-desktop-find-styles')
    expect(style?.textContent).toContain('::highlight(dsh-desktop-find)')
    expect(style?.textContent).toContain('::highlight(dsh-desktop-find-active)')
  })

  it('owns Ctrl/Cmd+F at the window level', () => {
    const { ctx, slotsRegister } = fakeContext()
    applyDesktopFind(ctx, ENVIRONMENT)
    const options = slotsRegister.mock.calls[0]?.[0] as {
      inject: () => { controller: DesktopFindController }
    }
    const { controller } = options.inject()
    expect(controller.getSnapshot().open).toBe(false)

    window.dispatchEvent(keydown('f', { metaKey: true }))
    expect(controller.getSnapshot().open).toBe(true)
    expect(controller.getSnapshot().focusToken).toBe(1)

    window.dispatchEvent(keydown('Escape'))
    expect(controller.getSnapshot().open).toBe(false)
  })

  it('stops owning the gesture when its shortcut effect is released', () => {
    const { ctx, effects, labels, slotsRegister } = fakeContext()
    applyDesktopFind(ctx, ENVIRONMENT)
    const options = slotsRegister.mock.calls[0]?.[0] as {
      inject: () => { controller: DesktopFindController }
    }
    const { controller } = options.inject()

    const shortcuts = labels.indexOf('dsh-plugin-desktop: find-bar shortcuts')
    expect(shortcuts).toBeGreaterThanOrEqual(0)
    effects[shortcuts]?.()

    // The controller is still live, so a bar that opens here would prove the
    // window listener outlived its effect.
    window.dispatchEvent(keydown('f', { metaKey: true }))
    expect(controller.getSnapshot().open).toBe(false)
  })

  it('releases its styles and controller on teardown', () => {
    const { ctx, effects, slotsRegister } = fakeContext()
    applyDesktopFind(ctx, ENVIRONMENT)
    const options = slotsRegister.mock.calls[0]?.[0] as {
      inject: () => { controller: DesktopFindController }
    }
    const { controller } = options.inject()

    for (const dispose of [...effects].reverse()) dispose()
    expect(document.getElementById('dsh-desktop-find-styles')).toBeNull()
    controller.open()
    expect(controller.getSnapshot().open).toBe(false)
  })
})
