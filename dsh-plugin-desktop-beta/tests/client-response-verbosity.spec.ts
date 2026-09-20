// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopSettingsSection,
  persistDesktopResponseVerbosity,
  type DesktopSettingsSectionProps,
} from '../src/client/DesktopSettingsSection.tsx'
import { en, zh } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

function scope(value: unknown) {
  const snapshot = { status: 'ready', writable: true, value }
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

function settingsApi() {
  return {
    read: async () => ({
      current: 'desktop',
      profiles: [],
      aa: { requested: false, effective: false },
      market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
      web: { localUrl: '', lanUrls: [], lanState: 'inactive', lanError: null, lanCaFingerprint: null, lanCaUrls: [] },
    }),
  }
}

async function mount(verbosity: { verbosity: 'concise' | 'standard' | 'detailed' } = { verbosity: 'standard' }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const set = vi.fn(async () => {})
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    api: settingsApi(),
    platform: 'darwin',
    initialMode: 'compatibility',
    micaSupported: false,
    setMode: async () => {},
    desktopSettings: scope({ mode: 'compatibility', openBrowser: false, networkExposure: 'loopback' }),
    notificationSettings: scope({ enabled: false }),
    verbositySettings: { ...scope(verbosity), set },
  } as unknown as DesktopSettingsSectionProps
  await act(async () => { root!.render(createElement(DesktopSettingsSection, props)) })
  return {
    section: container.querySelector('[aria-labelledby="dsh-desktop-verbosity-title"]')!,
    set,
  }
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('response verbosity settings section', () => {
  it('routes one verbosity write through the verbosity namespace', async () => {
    const set = vi.fn(async () => {})
    await persistDesktopResponseVerbosity({ set } as never, 'concise')
    expect(set).toHaveBeenCalledWith('verbosity', 'concise')
  })

  it('keeps the verbosity dictionaries aligned across locales', () => {
    for (const key of [
      'verbosityTitle',
      'verbosityIntro',
      'verbosityConcise',
      'verbosityConciseBody',
      'verbosityStandard',
      'verbosityStandardBody',
      'verbosityDetailed',
      'verbosityDetailedBody',
    ] as const) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  it('marks the stored level and persists a concise choice without restart copy', async () => {
    const { section, set } = await mount()
    expect(section.textContent).toContain(zh.verbosityTitle)
    expect(section.textContent).toContain(zh.verbosityIntro)
    const choices = section.querySelectorAll<HTMLElement>('[role="radio"]')
    expect(choices).toHaveLength(3)
    expect(choices[1]?.getAttribute('aria-checked')).toBe('true')

    await act(async () => { choices[0]?.click() })
    expect(set).toHaveBeenCalledWith('verbosity', 'concise')
    expect(section.textContent).not.toContain(zh.restartRequired)
  })

  it('marks a stored concise level on mount', async () => {
    const { section } = await mount({ verbosity: 'concise' })
    const choices = section.querySelectorAll<HTMLElement>('[role="radio"]')
    expect(choices[0]?.getAttribute('aria-checked')).toBe('true')
    expect(choices[1]?.getAttribute('aria-checked')).toBe('false')
  })
})
