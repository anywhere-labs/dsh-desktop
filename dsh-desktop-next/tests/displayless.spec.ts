import { expect, it } from 'vitest'
import { HEADLESS_PLATFORM_SWITCH, displaylessLaunch, displaylessRestartArguments } from '../src/displayless.ts'

const app = '/opt/app/desktop'

it('restarts a Linux launch on the headless platform only when neither X11 nor Wayland offers a display', () => {
  expect(displaylessRestartArguments('linux', {}, [app])).toEqual([HEADLESS_PLATFORM_SWITCH])
  expect(displaylessRestartArguments('linux', { DISPLAY: '', WAYLAND_DISPLAY: '' }, [app, '--no-sandbox', '--next-background']))
    .toEqual(['--no-sandbox', '--next-background', HEADLESS_PLATFORM_SWITCH])
  expect(displaylessRestartArguments('linux', { DISPLAY: ':0' }, [app])).toBeUndefined()
  expect(displaylessRestartArguments('linux', { WAYLAND_DISPLAY: 'wayland-0' }, [app])).toBeUndefined()
  for (const platform of ['darwin', 'win32'] as const) expect(displaylessRestartArguments(platform, {}, [app])).toBeUndefined()
})

it('restarts once: a launch that already names an Ozone platform proceeds as it is', () => {
  expect(displaylessRestartArguments('linux', {}, [app, HEADLESS_PLATFORM_SWITCH])).toBeUndefined()
  expect(displaylessRestartArguments('linux', {}, [app, '--ozone-platform=x11'])).toBeUndefined()
  // The hint is a different switch; the headless platform overrides it.
  expect(displaylessRestartArguments('linux', {}, [app, '--ozone-platform-hint=auto'])).toEqual(['--ozone-platform-hint=auto', HEADLESS_PLATFORM_SWITCH])
})

it('keeps the switch where Chromium reads it, before an argument terminator', () => {
  expect(displaylessRestartArguments('linux', {}, [app, '--no-sandbox', '--', 'file'])).toEqual(['--no-sandbox', HEADLESS_PLATFORM_SWITCH, '--', 'file'])
})

it('treats a Linux launch on the headless platform as one without a display', () => {
  expect(displaylessLaunch('linux', [app, HEADLESS_PLATFORM_SWITCH])).toBe(true)
  expect(displaylessLaunch('linux', [app])).toBe(false)
  expect(displaylessLaunch('darwin', [app, HEADLESS_PLATFORM_SWITCH])).toBe(false)
})
