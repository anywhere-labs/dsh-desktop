// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RecoveryApp } from '../src/native-ui/recovery/App.tsx'
import { desktopRecoveryCopy } from '../src/recovery-copy.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined
async function mount(busy = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const state = { locale: 'zh', failureStage: 'host-boot', failureDetail: '', busy,
    diagnostics: { status: 'failed' }, restartReady: false, activeTab: 'quick', configurationAvailable: false }
  window.history.replaceState(null, '', `?state=${Buffer.from(JSON.stringify(state)).toString('base64url')}`)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(RecoveryApp)) })
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})
const copy = desktopRecoveryCopy('zh')
it.each(Object.keys(copy.guideActions) as (keyof typeof copy.guideActions)[])(
  'opens %s from the recovery homepage without invoking a recovery action', async destination => {
    await mount()
    const location = window.location.href
    const button = [...container!.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])')].find(item => item.textContent === copy.guideActions[destination])!
    expect(button).toBeDefined()
    await act(async () => { button.click() })
    const tab = container!.querySelector('[role="tab"][aria-selected="true"]')!
    expect(tab.textContent).toBe(copy.tabs[destination])
    expect(document.activeElement).toBe(tab)
    expect(window.location.href).toBe(location)
    expect(container!.querySelector('[role="tabpanel"]')).not.toBeNull()
  },
)
it('disables every homepage shortcut while an operation is running', async () => {
  await mount(true)
  for (const label of Object.values(copy.guideActions)) {
    const button = [...container!.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])')].find(item => item.textContent === label)!
    expect(button.disabled).toBe(true)
    await act(async () => { button.click() })
  }
  expect(container!.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(copy.tabs.quick)
})
