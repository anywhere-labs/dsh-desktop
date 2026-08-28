import { describe, expect, it, vi } from 'vitest'
import {
  installDesktopSessionContextMenuBridge,
  resolveDesktopSessionContextMenu,
  type DesktopSessionContextMenuWindow,
} from '../src/client/session-context-menu.ts'

describe('desktop session context-menu bridge', () => {
  it('suppresses the native menu and anchors a real session at the pointer', () => {
    const event = {
      clientX: 240,
      clientY: 180,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(resolveDesktopSessionContextMenu(event, false)).toEqual({ x: 240, y: 176 })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('suppresses the native menu without exposing actions for a blank session', () => {
    const event = {
      clientX: 12,
      clientY: 24,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(resolveDesktopSessionContextMenu(event, true)).toBeUndefined()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('restores the previous bridge without replacing a newer owner', () => {
    const previous = vi.fn()
    const replacement = vi.fn()
    const target = {
      __DSH_DESKTOP_SESSION_CONTEXT_MENU__: previous,
    } as DesktopSessionContextMenuWindow

    const dispose = installDesktopSessionContextMenuBridge(target)
    expect(target.__DSH_DESKTOP_SESSION_CONTEXT_MENU__).toBe(resolveDesktopSessionContextMenu)
    target.__DSH_DESKTOP_SESSION_CONTEXT_MENU__ = replacement
    dispose()
    expect(target.__DSH_DESKTOP_SESSION_CONTEXT_MENU__).toBe(replacement)

    const disposeOwned = installDesktopSessionContextMenuBridge(target)
    disposeOwned()
    expect(target.__DSH_DESKTOP_SESSION_CONTEXT_MENU__).toBe(replacement)
  })
})
