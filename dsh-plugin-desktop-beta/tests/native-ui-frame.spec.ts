import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { desktopFrameIsVisible } from '../src/native-ui/shared/DesktopFrame.tsx'

const theme = readFileSync(new URL('../src/native-ui/shared/theme.css', import.meta.url), 'utf8')

describe('Desktop-owned native UI frame', () => {
  it('renders only when the BrowserWindow declares visible custom controls', () => {
    expect(desktopFrameIsVisible('?platform=darwin&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=win32&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=darwin&frame=false')).toBe(false)
    expect(desktopFrameIsVisible('?platform=linux')).toBe(false)
    expect(desktopFrameIsVisible('')).toBe(false)
  })

  it('reserves the frame inset when fixed window actions sit before the content', () => {
    expect(theme).toContain('.dshNativeFrame ~ .dshNativeContent')
    expect(theme).not.toContain('.dshNativeFrame + .dshNativeContent')
  })

  it('isolates the app root so body-level dialogs cover the high native frame layer', () => {
    expect(theme).toMatch(/#root\s*\{\s*isolation:\s*isolate;/u)
  })
})
