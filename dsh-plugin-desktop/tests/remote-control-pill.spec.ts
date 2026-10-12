// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopFrameTitlebarView } from '../src/client/DesktopFrameTitlebarView.tsx'
import { zh } from '../src/client/desktop-settings-locales.ts'
import type { DesktopClientEnvironment } from '../src/client/environment.ts'
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.unstubAllGlobals() })
it('shows the remote-control pill before native actions and removes its dot after viewing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const open = vi.fn(async () => {})
  const noop = async () => {}
  const props = { api: { openTerminal: noop, restart: noop, restartToRecovery: noop, reloadRenderer: noop, toggleDeveloperTools: noop, checkForUpdates: noop },
    setMode: noop, t: (key: keyof typeof zh) => zh[key],
    environment: { mode: 'extended', platform: 'darwin', version: '2.0.8-beta.1', material: 'transparent' } as DesktopClientEnvironment }
  await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, { ...props, remoteControl: { seen: false, open } })) })
  const button = container.querySelector<HTMLButtonElement>('.dshDesktopRemoteControl')!
  expect(button.textContent).toContain('远程控制')
  expect(button.querySelector('[aria-label="新功能"]')).not.toBeNull()
  expect(button.nextElementSibling?.className).toContain('dshDesktopNativeActions')
  await act(async () => { button.click() })
  expect(open).toHaveBeenCalledTimes(1)
  await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, { ...props, remoteControl: { seen: true, open } })) })
  expect(container.querySelector('.dshDesktopRemoteControlDot')).toBeNull()
  expect(container.querySelector('.dshDesktopRemoteControl')).not.toBeNull()
  await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, props)) })
  expect(container.querySelector('.dshDesktopRemoteControl')).toBeNull()
})
