import { afterEach, expect, it, vi } from 'vitest'
import { OnboardingStyleScope, registerDesktopOnboarding } from '../src/client/onboarding.tsx'
import { ONBOARDING_STYLE_ATTRIBUTE } from '../src/client/onboarding-style-scope.ts'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[], effects: [] as (() => unknown)[], layoutEffects: [] as (() => unknown)[] }))
// Vitest aliases these shared peers to Next's installed copies.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => {
    const setter = vi.fn()
    hooks.setters.push(setter)
    return [hooks.values.shift(), setter]
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) },
  useLayoutEffect: (effect: () => unknown) => { hooks.layoutEffects.push(effect) },
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', Toast: 'official-toast' }))
afterEach(() => { vi.unstubAllGlobals() })

function fixture(signedIn: boolean, failDismiss = false, overrides = {}) {
  const snapshot = { profile: 'work', required: false, accountPending: true, edition: 'desktop', restartPending: false, input: { platform: 'darwin' }, ...overrides }
  hooks.values = [snapshot, '', 0, false]; hooks.setters = []; hooks.effects = []
  const bridge = {
    read: vi.fn(async (): Promise<typeof snapshot | null> => snapshot),
    dismissAccount: vi.fn(async () => { if (failDismiss) throw new Error('save failed') }),
    applyPending: vi.fn(async () => {}),
  }
  vi.stubGlobal('window', { dshDesktopSetup: bridge })
  let Component: (props: any) => any = () => null
  const ctx = { slots: {
    inject: (_name: string, callback: () => void) => callback(),
    register: (_options: unknown, component: typeof Component) => { Component = component },
  } }
  registerDesktopOnboarding(ctx as any)
  const openLogin = vi.fn(), renderNext = vi.fn(), renderLoading = vi.fn(() => 'Loading')
  const props = { bridge, zh: true, accountStatus: signedIn ? 'credential-stored' : 'signed-out',
    openLogin, renderNext, renderLoading, renderSurface: (value: unknown) => value }
  const result = Component(props)
  const renderWithSnapshot = (value: unknown) => {
    hooks.values = [value, '', 0, false]
    return Component(props)
  }
  return { bridge, openLogin, result, snapshot, renderNext, renderWithSnapshot }
}

it('hands a Profile with no Desktop setup pending to the official decision', async () => {
  const view = fixture(false)
  view.bridge.read.mockResolvedValue(null)
  hooks.effects[0]!()
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenCalledWith(null))
  expect(view.renderWithSnapshot(null)).toBeUndefined()
  expect(view.renderNext).toHaveBeenCalledOnce()
})

it('leaves Desktop setup to the pre-Host shell window and continues the official flow', async () => {
  const view = fixture(false)
  view.bridge.read.mockResolvedValue({ ...view.snapshot, required: true, accountPending: false })
  hooks.effects[0]!()
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenCalledWith(null))
  expect(view.bridge.dismissAccount).not.toHaveBeenCalled()
})

it('hands an already signed-in Profile to the official flow without showing login', async () => {
  const view = fixture(true)
  expect(view.result.props.children[0]).toBe('Loading')
  hooks.effects[1]!()
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenCalledWith(null))
  expect(view.bridge.dismissAccount).toHaveBeenCalledExactlyOnceWith('work')
  expect(view.openLogin).not.toHaveBeenCalled()
})

it('retains the continuation if acknowledging an already signed-in Profile fails', async () => {
  const view = fixture(true, true)
  hooks.effects[1]!()
  await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith('Error: save failed'))
  expect(hooks.setters[0]).not.toHaveBeenCalledWith(null)
  expect(view.openLogin).not.toHaveBeenCalled()
})

it('retains pending application while an already signed-in user continues the official flow', async () => {
  const view = fixture(true, false, { restartPending: true })
  const next = { ...view.snapshot, accountPending: false }
  view.bridge.read.mockResolvedValue(next)
  hooks.effects[1]!()
  await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenCalledWith(next))
  expect(view.bridge.applyPending).not.toHaveBeenCalled()
})

it('applies saved settings only when the user explicitly requests the final restart', async () => {
  const view = fixture(false, false, { accountPending: false, restartPending: true })
  expect(view.renderNext).toHaveBeenCalledOnce()
  expect(view.bridge.applyPending).not.toHaveBeenCalled()
  expect(view.result.props.children[1].type).toBe('official-toast')
  view.result.props.children[1].props.actions[0].onClick()
  await vi.waitFor(() => expect(view.bridge.applyPending).toHaveBeenCalledExactlyOnceWith('work'))
})

it('dismisses the official toast without restarting or discarding saved settings', () => {
  const view = fixture(false, false, { accountPending: false, restartPending: true })
  view.result.props.children[1].props.onDone()
  expect(hooks.setters[0]).toHaveBeenCalledWith(null)
  expect(view.bridge.applyPending).not.toHaveBeenCalled()
})

it('activates the onboarding-only styles with Desktop content and its loading state, not the official flow', () => {
  const marked = (node: any) => node?.props?.children?.[1]?.type === OnboardingStyleScope
  expect(marked(fixture(false).result)).toBe(true)
  expect(marked(fixture(true).result)).toBe(true)
  const official = fixture(false, false, { accountPending: false, restartPending: true })
  expect(marked(official.result)).toBe(false)
  expect(official.renderWithSnapshot(null)).toBeUndefined()
})

it('keeps the root mark until the last onboarding style scope unmounts', () => {
  const attributes = new Set<string>()
  vi.stubGlobal('document', { documentElement: {
    setAttribute: (name: string) => { attributes.add(name) },
    removeAttribute: (name: string) => { attributes.delete(name) },
  } })
  hooks.layoutEffects = []
  expect(OnboardingStyleScope()).toBeNull()
  OnboardingStyleScope()
  const [first, second] = hooks.layoutEffects.map(effect => effect() as () => void)
  expect(attributes.has(ONBOARDING_STYLE_ATTRIBUTE)).toBe(true)
  first!()
  expect(attributes.has(ONBOARDING_STYLE_ATTRIBUTE)).toBe(true)
  second!()
  expect(attributes.has(ONBOARDING_STYLE_ATTRIBUTE)).toBe(false)
})
