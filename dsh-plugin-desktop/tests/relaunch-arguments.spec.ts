import { describe, expect, it } from 'vitest'
import {
  DESKTOP_RECOVERY_MODE_ARGUMENT,
  desktopDefaultRelaunchArguments,
  desktopRecoveryModeRequested,
  desktopRecoveryRelaunchArguments,
} from '../src/relaunch-arguments.ts'

describe('Desktop relaunch arguments', () => {
  const argv = [
    '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop',
    'desktop-main.cjs',
    '--profile=work',
    DESKTOP_RECOVERY_MODE_ARGUMENT,
  ]

  it('strips the one-shot recovery marker from an ordinary relaunch', () => {
    expect(desktopDefaultRelaunchArguments(argv)).toEqual(['desktop-main.cjs', '--profile=work'])
  })

  it('adds exactly one recovery marker for a recovery relaunch', () => {
    expect(desktopRecoveryRelaunchArguments(argv)).toEqual([
      'desktop-main.cjs', '--profile=work', DESKTOP_RECOVERY_MODE_ARGUMENT,
    ])
  })

  it('recognizes only an exact process argument', () => {
    expect(desktopRecoveryModeRequested(argv)).toBe(true)
    expect(desktopRecoveryModeRequested([argv[0]!, `${DESKTOP_RECOVERY_MODE_ARGUMENT}=true`])).toBe(false)
  })
})
