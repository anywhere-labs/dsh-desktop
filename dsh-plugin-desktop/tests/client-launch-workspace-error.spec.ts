// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { reportDesktopLaunchWorkspaceError } from '../src/client/launch-workspace.ts'
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
it('keeps launch failure visible, dismissible, and text-only', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  reportDesktopLaunchWorkspaceError('Could not attach <script>bad()</script>')
  const alert = document.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('<script>bad()</script>')
  expect(alert?.querySelector('script')).toBeNull()
  reportDesktopLaunchWorkspaceError('New failure')
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('New failure')
  document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
