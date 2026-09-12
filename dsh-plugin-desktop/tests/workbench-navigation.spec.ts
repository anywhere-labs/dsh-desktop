import { describe, expect, it } from 'vitest'
import { dshHomeUrl, withDesktopNavigationMarkers } from '../src/client/workbench-navigation.ts'

const home = 'http://127.0.0.1:43120/?dsh-desktop-mode=extended&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.4&dsh-desktop-material=transparent&dsh-desktop-titlebar-inset=36'

describe('workbench navigation', () => {
  it('preserves Desktop markers when launching a workbench', () => {
    expect(withDesktopNavigationMarkers('/product-visual-workbench/', home)).toBe(
      'http://127.0.0.1:43120/product-visual-workbench/?dsh-desktop-mode=extended&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.4&dsh-desktop-material=transparent&dsh-desktop-titlebar-inset=36',
    )
  })

  it('preserves Desktop markers when returning to the DSH home', () => {
    expect(dshHomeUrl(
      'http://127.0.0.1:43120/deepthink/?dsh-desktop-mode=extended&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.4&dsh-desktop-material=transparent&dsh-desktop-titlebar-inset=36',
    )).toBe(home)
  })
})
