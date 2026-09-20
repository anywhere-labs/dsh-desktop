import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply,
  DESKTOP_RESPONSE_VERBOSITY_SECTION,
  DESKTOP_RESPONSE_VERBOSITY_SETTINGS_NAMESPACE,
  desktopResponseVerbositySectionText,
  DesktopResponseVerbositySettingsSchema,
  name,
  parseDesktopResponseVerbosity,
  type DesktopResponseVerbositySettings,
} from '../src/desktop-response-verbosity.ts'

function settingsScope(initial: DesktopResponseVerbositySettings) {
  let current = initial
  const watchers = new Set<(next: DesktopResponseVerbositySettings) => void>()
  return {
    scope: {
      get: () => current,
      watch: (watcher: (next: DesktopResponseVerbositySettings) => void) => {
        watchers.add(watcher)
        return () => { watchers.delete(watcher) }
      },
    },
    register: vi.fn(() => ({
      get: () => current,
      watch: (watcher: (next: DesktopResponseVerbositySettings) => void) => {
        watchers.add(watcher)
        return () => { watchers.delete(watcher) }
      },
    })),
    update(next: DesktopResponseVerbositySettings) {
      current = next
      for (const watcher of [...watchers]) watcher(next)
    },
  }
}

function promptCapture() {
  const sections: Array<{ name: string, order: number, text: () => string }> = []
  return {
    sections,
    section: vi.fn((section: { name: string, order: number, text: () => string }) => {
      sections.push(section)
      return () => {}
    }),
    getSectionOrder: vi.fn((orderName: string) => {
      expect(orderName).toBe('TEAM_POLICY')
      return 600
    }),
  }
}

function createHarness() {
  const settings = settingsScope({ verbosity: 'standard' })
  const prompt = promptCapture()
  const injections = new Map<string, (ctx: Context) => void>()
  const ctx = {
    inject: (services: string[], callback: (child: Context) => void) => {
      for (const service of services) injections.set(service, callback)
    },
    effect: (register: () => void | (() => void)) => register(),
    settings: { register: settings.register },
    systemPrompt: prompt,
  } as unknown as Context
  apply(ctx)
  injections.get('settings')?.(ctx)
  injections.get('systemPrompt')?.(ctx as unknown as Context)
  return { ctx, settings, prompt }
}

describe('desktop response verbosity Host plugin', () => {
  it('registers a live verbosity namespace defaulting to standard', () => {
    expect(name).toBe('desktop-response-verbosity')
    expect(String(DESKTOP_RESPONSE_VERBOSITY_SETTINGS_NAMESPACE)).toBe('dsh-desktop-response-verbosity')
    expect(DesktopResponseVerbositySettingsSchema({} as DesktopResponseVerbositySettings)).toEqual({
      verbosity: 'standard',
    })
    const harness = createHarness()
    expect(harness.settings.register).toHaveBeenCalledWith(
      DESKTOP_RESPONSE_VERBOSITY_SETTINGS_NAMESPACE,
      DesktopResponseVerbositySettingsSchema,
      { applies: 'live' },
    )
  })

  it('parses stored verbosity values and rejects unknown levels', () => {
    expect(parseDesktopResponseVerbosity(undefined)).toBe('standard')
    expect(parseDesktopResponseVerbosity('concise')).toBe('concise')
    expect(parseDesktopResponseVerbosity('standard')).toBe('standard')
    expect(parseDesktopResponseVerbosity('detailed')).toBe('detailed')
    expect(() => parseDesktopResponseVerbosity('verbose')).toThrow('must be "concise", "standard", or "detailed"')
  })

  it('contributes no prompt text for standard and guidance otherwise', () => {
    expect(desktopResponseVerbositySectionText('standard')).toBe('')
    expect(desktopResponseVerbositySectionText('concise')).toContain('concise')
    expect(desktopResponseVerbositySectionText('concise')).toContain('briefly')
    expect(desktopResponseVerbositySectionText('detailed')).toContain('detailed')
  })

  it('registers one TEAM_POLICY section that follows live settings', () => {
    const harness = createHarness()
    expect(harness.prompt.section).toHaveBeenCalledOnce()
    expect(harness.prompt.getSectionOrder).toHaveBeenCalledWith('TEAM_POLICY')
    const registered = harness.prompt.sections[0]
    expect(registered?.name).toBe(DESKTOP_RESPONSE_VERBOSITY_SECTION)
    expect(registered?.order).toBe(600)
    expect(registered?.text()).toBe('')

    harness.settings.update({ verbosity: 'concise' })
    expect(registered?.text()).toContain('concise')

    harness.settings.update({ verbosity: 'detailed' })
    expect(registered?.text()).toContain('detailed')

    harness.settings.update({ verbosity: 'standard' })
    expect(registered?.text()).toBe('')
  })
})
