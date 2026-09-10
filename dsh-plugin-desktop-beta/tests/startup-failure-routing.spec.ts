import { describe, expect, it } from 'vitest'
import { routeDesktopStartupFailure } from '../src/startup-failure-routing.ts'
import type { DesktopStartupFailureStage } from '../src/startup-recovery-window.ts'

const READY_STAGES: readonly DesktopStartupFailureStage[] = [
  'electron-ready',
  'shell-environment',
  'runtime-bootstrap',
  'profile-selection',
  'profile-composition',
  'host-boot',
  'renderer-startup',
  'health-commit',
]

describe('Desktop startup failure routing', () => {
  it('uses stderr before Electron is ready', () => {
    expect(routeDesktopStartupFailure({ appReady: false, stage: 'electron-ready' })).toBe('stderr-only')
  })

  it('opens unified Recovery for every app-ready startup stage', () => {
    for (const stage of READY_STAGES) {
      expect(routeDesktopStartupFailure({ appReady: true, stage })).toBe('startup-recovery')
    }
  })
})
