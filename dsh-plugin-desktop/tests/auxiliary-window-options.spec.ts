import { describe, expect, it } from 'vitest'
import {
  auxiliaryWindowChromeOptions,
  auxiliaryWindowHasCustomFrame,
} from '../src/auxiliary-window-options.ts'

describe('Desktop auxiliary window chrome', () => {
  it('uses an empty 36px inset frame on macOS', () => {
    expect(auxiliaryWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 12 },
    })
    expect(auxiliaryWindowHasCustomFrame('darwin')).toBe(true)
  })

  it('uses native caption controls over an empty 36px frame on Windows', () => {
    expect(auxiliaryWindowChromeOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: 36,
      },
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    })
    expect(auxiliaryWindowHasCustomFrame('win32')).toBe(true)
  })

  it('does not fake native controls on Linux', () => {
    expect(auxiliaryWindowChromeOptions('linux')).toEqual({})
    expect(auxiliaryWindowHasCustomFrame('linux')).toBe(false)
  })

  it('removes both native controls and the renderer frame from action-only dialogs', () => {
    expect(auxiliaryWindowChromeOptions('darwin', false)).toEqual({
      frame: false,
      closable: false,
      minimizable: false,
      maximizable: false,
    })
    expect(auxiliaryWindowHasCustomFrame('darwin', false)).toBe(false)
    expect(auxiliaryWindowHasCustomFrame('win32', false)).toBe(false)
  })
})
