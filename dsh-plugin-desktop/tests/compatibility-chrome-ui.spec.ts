import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installChromeOverlay } from '../src/native-ui/compatibility-chrome/overlay.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('compatibility HTML chrome', () => {
  it('uses the same controls and frame rules as extended mode', () => {
    const read = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    expect(read('client/ExtendedTitlebar.tsx')).toContain('<DesktopFrameTitlebarView {...props} />')
    expect(read('native-ui/compatibility-chrome/main.tsx')).toContain('<DesktopFrameTitlebarView')
    const shared = read('client/extended-styles.ts').split('.dshDesktopFrameTitlebar {')[1]?.split('\n`')[0]
    expect(shared).toBeDefined()
    const frame = '.dshDesktopFrameTitlebar {' + shared
    expect(read('native-ui/compatibility-chrome/style.css')).toContain(frame
      .replaceAll('${DESKTOP_FRAME_HEIGHT}', '36')
      .replaceAll('${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH + 8}', '88')
      .replaceAll('${WINDOWS_CAPTION_CONTROLS_WIDTH + 8}', '146'))
    const view = read('client/DesktopFrameTitlebarView.tsx')
    expect(view).toContain('delay={150}')
    expect(view).toContain('closeDelay={200}')
    expect(view).toContain('MODE_OPTIONS.filter(option => option.mode !== mode)')
    expect(view).toContain("t(option.body)")
  })

  it('expands only for popup DOM and collapses again after removal or disposal', async () => {
    let popup: object | null = null
    let update: () => void = () => {}
    const disconnect = vi.fn()
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('document', {
      body: {}, querySelector: () => popup,
      addEventListener: (name: string, listener: (event: unknown) => void) => { listeners.set(name, listener) },
      removeEventListener: (name: string) => { listeners.delete(name) },
    })
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { update = callback }
      observe = vi.fn()
      disconnect = disconnect
    })
    const invoke = vi.fn(async () => {})
    const dismiss = vi.fn()
    const failed = vi.fn()
    const dispose = installChromeOverlay(invoke, dismiss, failed)
    expect(invoke).not.toHaveBeenCalled()
    popup = {}
    update()
    update()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('expand')
    popup = null
    update()
    expect(invoke).toHaveBeenLastCalledWith('collapse')
    listeners.get('keydown')?.({ key: 'Escape' })
    expect(dismiss).toHaveBeenCalledOnce()
    popup = {}
    update()
    dispose()
    expect(invoke).toHaveBeenLastCalledWith('collapse')
    expect(disconnect).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    await Promise.resolve()
    expect(failed).not.toHaveBeenCalled()
  })
})
