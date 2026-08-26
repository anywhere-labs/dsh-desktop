import { describe, expect, it } from 'vitest'
import {
  createDesktopBrowserAccess,
  decideDesktopBrowserAccess,
  DESKTOP_RENDERER_ACCESS_HEADER,
  desktopBrowserUrlHasRendererMarkers,
} from '../src/desktop-browser-access.ts'

const RENDERER_TOKEN = Buffer.alloc(32, 7).toString('base64url')

describe('Desktop browser access policy', () => {
  it('creates an opaque generation-scoped renderer capability', () => {
    const first = createDesktopBrowserAccess(false)
    const second = createDesktopBrowserAccess(false)

    expect(first.rendererHeader.name).toBe(DESKTOP_RENDERER_ACCESS_HEADER)
    expect(first.rendererHeader.value).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.rendererHeader.value).not.toBe(second.rendererHeader.value)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.rendererHeader)).toBe(true)
  })

  it('rejects invalid injected test tokens', () => {
    expect(() => createDesktopBrowserAccess(false, 'short')).toThrow('32 base64url bytes')
  })

  it('always permits an Electron request carrying the exact capability', () => {
    const access = createDesktopBrowserAccess(false, RENDERER_TOKEN)

    expect(decideDesktopBrowserAccess(access, {
      headers: { [DESKTOP_RENDERER_ACCESS_HEADER]: RENDERER_TOKEN },
      url: '/?dsh-desktop-mode=compatibility',
    })).toBe('renderer')
    expect(decideDesktopBrowserAccess(access, {
      headers: { [DESKTOP_RENDERER_ACCESS_HEADER]: `${RENDERER_TOKEN}x` },
      url: '/',
    })).toBe('denied')
    expect(decideDesktopBrowserAccess(access, {
      headers: { [DESKTOP_RENDERER_ACCESS_HEADER]: [RENDERER_TOKEN] },
      url: '/',
    })).toBe('denied')
    expect(() => decideDesktopBrowserAccess(access, {
      headers: { [DESKTOP_RENDERER_ACCESS_HEADER]: '你'.repeat(43) },
      url: '/',
    })).not.toThrow()
    expect(decideDesktopBrowserAccess(access, {
      headers: { [DESKTOP_RENDERER_ACCESS_HEADER]: '你'.repeat(43) },
      url: '/',
    })).toBe('denied')
  })

  it('allows only marker-free ordinary-browser traffic when enabled', () => {
    const access = createDesktopBrowserAccess(true, RENDERER_TOKEN)

    for (const url of ['/', '/assets/index.js', '/api/events.sse', '/?workspace=one']) {
      expect(decideDesktopBrowserAccess(access, { headers: {}, url })).toBe('browser')
    }
    for (const url of [
      '/?dsh-desktop-mode=compatibility',
      '/?dsh-desktop-platform=win32',
      '/?other=1&dsh-desktop-future=value',
    ]) {
      expect(decideDesktopBrowserAccess(access, { headers: {}, url })).toBe('denied')
    }
  })

  it('fails closed for malformed URLs and Desktop marker attempts', () => {
    expect(desktopBrowserUrlHasRendererMarkers('http://[')).toBe(true)
    expect(desktopBrowserUrlHasRendererMarkers('/?desktop-mode=compatibility')).toBe(false)
    expect(desktopBrowserUrlHasRendererMarkers('/?dsh-desktop-mode=compatibility')).toBe(true)
  })
})
