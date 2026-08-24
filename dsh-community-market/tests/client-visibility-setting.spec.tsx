// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.js'
import { MarketSidebarVisibilitySetting } from '../src/client/MarketSidebarVisibilitySetting.js'
import type { MarketSettingsDocument } from '../src/catalog/source-store.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, icon, variant: _variant, ...props }: {
    children?: ReactNode
    icon?: ReactNode
    variant?: string
    [key: string]: unknown
  }) => <button {...props}>{icon}{children}</button>,
}))

afterEach(() => { cleanup() })

const t = ((key: string) => key) as PropsLocale<'community-market'>['t']

function settingsHarness(visible: boolean) {
  let snapshot: SettingsScopeSnapshot<MarketSettingsDocument> = {
    status: 'ready',
    value: { sources: [], sidebarLauncherVisible: visible },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async (_field: string, next: unknown) => {
      snapshot = { ...snapshot, value: { sources: [], sidebarLauncherVisible: next === true }, revision: 2 }
      listeners.forEach(listener => listener())
    }),
    unset: vi.fn(async () => {}),
  } satisfies SettingsScope<MarketSettingsDocument>
  return scope
}

describe('community market sidebar visibility setting', () => {
  it('uses the settings scope switch to hide and restore the sidebar launcher', async () => {
    const marketSettings = settingsHarness(true)
    render(<MarketSidebarVisibilitySetting marketSettings={marketSettings} t={t} />)

    const toggle = screen.getByRole('switch', { name: 'sidebarLauncherVisibility' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)

    await waitFor(() => expect(marketSettings.set).toHaveBeenCalledWith('sidebarLauncherVisible', false))
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))

    fireEvent.click(toggle)
    await waitFor(() => expect(marketSettings.set).toHaveBeenLastCalledWith('sidebarLauncherVisible', true))
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  })
})
