import { afterEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { DesktopPermissions } from '../src/permissions.ts'

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[], states: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.states)) hooks.states[index] = initial
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next
    }]
  },
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', Modal: 'dialog', StateDot: 'span', IconSettingsOutlineRegular: 'svg' }))
import { DesktopPermissionsButton, DesktopPermissionsDialog, PermissionDetails } from '../src/client/permissions.tsx'
import { registerVoicePermissions, VoicePermissionsAction } from '../src/client/voice-permissions.tsx'

type Element = ReactElement<Record<string, any>>
const nodes = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'props' in value
    ? [value as Element, ...nodes((value as Element).props.children)] : []
const voice = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const service = (): DesktopPermissions => ({
  query: vi.fn<DesktopPermissions['query']>(async permission => ({ permission, status: 'not-determined', canRequest: true, canOpenSettings: true })),
  request: vi.fn<DesktopPermissions['request']>(async permission => ({ permission, status: 'granted', canRequest: false, canOpenSettings: true })),
  openSettings: vi.fn(async () => {}),
})
const subject = (enabled: boolean) => ({ kind: 'bundle' as const, pkg: { name: voice, enabled, installed: false, optional: true } })
afterEach(() => { hooks.effects = []; hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

it.each([true, false])('offers microphone settings for voice enabled=%s without requesting access', enabled => {
  const permissions = service()
  vi.stubGlobal('window', { desktopNext: { permissions } })
  const action = VoicePermissionsAction({ subject: subject(enabled), t: () => 'zh' } as Parameters<typeof VoicePermissionsAction>[0])!
  expect(action.type).toBe(DesktopPermissionsButton)
  expect(action.props).toMatchObject({ permission: 'microphone', label: '权限设置', language: 'zh' })
  expect(permissions.request).not.toHaveBeenCalled()
  expect(VoicePermissionsAction({ subject: { kind: 'item', id: 'other' }, t: () => 'zh' } as Parameters<typeof VoicePermissionsAction>[0])).toBeNull()
  const other = { ...subject(enabled), pkg: { ...subject(enabled).pkg, name: 'other' } }
  expect(VoicePermissionsAction({ subject: other, t: () => 'en' } as Parameters<typeof VoicePermissionsAction>[0])).toBeNull()
  expect(VoicePermissionsAction({ subject: subject(enabled), t: () => 'en' } as Parameters<typeof VoicePermissionsAction>[0])?.props.label).toBe('Permission settings')
  vi.stubGlobal('window', {})
  expect(VoicePermissionsAction({ subject: subject(enabled), t: () => 'en' } as Parameters<typeof VoicePermissionsAction>[0])).toBeNull()
})

it('registers only the voice bundle card and a filtered detail action', () => {
  const register = vi.fn((_options: unknown, _component: unknown) => () => {})
  registerVoicePermissions({ slots: { inject: (_: string, callback: () => unknown) => callback(), register } } as unknown as Context)
  expect(register.mock.calls.map(call => call[0])).toEqual([
    { name: 'plugins.bundle.actions', key: voice, locale: 'desktop-next' },
    { name: 'plugins.detail.actions', id: 'desktop-next-voice-permissions', locale: 'desktop-next' },
  ])
})

it('opens the scoped dialog and only queries or requests microphone permission', async () => {
  const permissions = service()
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  let button = DesktopPermissionsButton({ service: permissions, language: 'zh', permission: 'microphone' })
  nodes(button).find(node => node.type === 'button')!.props.onClick()
  hooks.cursor = 0
  button = DesktopPermissionsButton({ service: permissions, language: 'zh', permission: 'microphone' })
  const dialog = nodes(button).find(node => node.type === DesktopPermissionsDialog)!
  expect(dialog.props).toMatchObject({ open: true, permission: 'microphone' })
  hooks.states = []; hooks.cursor = 0; hooks.effects = []
  const renderDetails = () => { hooks.cursor = 0; return PermissionDetails({ service: permissions, language: 'zh', permission: 'microphone' }) }
  renderDetails()
  hooks.effects[0]!()
  await vi.waitFor(() => { expect(hooks.states[0]).toHaveLength(1) })
  expect(permissions.query).toHaveBeenCalledExactlyOnceWith('microphone')
  const detail = renderDetails()
  expect(nodes(detail).filter(node => node.props.role === 'group').map(node => node.props['aria-label'])).toEqual(['麦克风'])
  nodes(detail).find(node => node.props.children === '请求授权')!.props.onClick()
  await vi.waitFor(() => { expect(permissions.query).toHaveBeenCalledTimes(2) })
  expect(permissions.request).toHaveBeenCalledExactlyOnceWith('microphone')
  nodes(detail).find(node => node.props.children === '打开系统设置')!.props.onClick()
  await vi.waitFor(() => { expect(permissions.openSettings).toHaveBeenCalledExactlyOnceWith('microphone') })
})
