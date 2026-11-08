import { describe, expect, it, vi } from 'vitest'
import {
  disabledProvidersOp,
  DISABLED_PROVIDERS_FIELD,
  DISABLED_PROVIDERS_NAMESPACE,
  readDisabledProviders,
  resetDisabledSelections,
  visibleFallback,
  withProviderToggled,
  type ConfigurableProviderEntry,
  type SessionDirectoryLike,
} from '../src/provider-visibility.ts'

const directory: ConfigurableProviderEntry[] = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], declared: undefined },
  { provider: 'opencode-go', displayName: 'opencode-go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'], declared: false },
  { provider: 'codebuddy', displayName: 'CodeBuddy', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'codebuddy'], declared: true },
]

const userLayer = {
  'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' },
  'llm-pi-ai': { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' }, codebuddy: { api: 'openai-completions' } } },
}

describe('provider visibility storage', () => {
  it('exposes the declared volatile field and namespace used by the Host patch', () => {
    expect(DISABLED_PROVIDERS_FIELD).toBe('disabledProviders')
    expect(DISABLED_PROVIDERS_NAMESPACE).toBe('llm-pi-ai')
    expect(disabledProvidersOp(['a', 'a', '', 'b'])).toEqual({ op: 'set', path: ['disabledProviders'], value: ['a', 'b'] })
  })

  it('treats malformed and legacy values as an empty disabled list', () => {
    expect(readDisabledProviders(undefined)).toEqual([])
    expect(readDisabledProviders(null)).toEqual([])
    expect(readDisabledProviders({})).toEqual([])
    expect(readDisabledProviders({ disabledProviders: 'no' })).toEqual([])
    expect(readDisabledProviders({ disabledProviders: ['a', 1, 'a', '', null] })).toEqual(['a'])
  })

  it('defaults unlisted provider ids to enabled and only persists hidden ids', () => {
    expect(withProviderToggled([], 'opencode-go', true)).toEqual([])
    expect(withProviderToggled([], 'opencode-go', false)).toEqual(['opencode-go'])
    expect(withProviderToggled(['opencode-go', 'codebuddy'], 'opencode-go', true)).toEqual(['codebuddy'])
    expect(withProviderToggled(['codebuddy'], 'codebuddy', false)).toEqual(['codebuddy'])
  })
})

describe('reset selection on disable', () => {
  const fallback = { provider: 'deepseek-official', model: 'deepseek-chat' }


  it('falls back to the first visible model when the default is hidden too', () => {
    const groups = [
      { id: 'deepseek-official', models: [{ id: 'deepseek-chat' }] },
      { id: 'codebuddy', models: [{ id: 'claude' }] },
      { id: 'trae', models: [{ id: 'MiniMax-M2.7' }] },
    ]
    expect(visibleFallback({ provider: 'deepseek-official', model: 'deepseek-chat' }, ['codebuddy'], groups))
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(visibleFallback({ provider: 'deepseek-official', model: 'deepseek-chat' }, ['deepseek-official'], groups))
      .toEqual({ provider: 'codebuddy', model: 'claude' })
    expect(visibleFallback({ provider: 'deepseek-official', model: 'deepseek-chat' }, ['deepseek-official', 'codebuddy', 'trae'], groups)).toBeUndefined()
  })

  it('submits the deployment default for each affected live session once', () => {
    const select = vi.fn().mockResolvedValue({ ok: true })
    const directories: SessionDirectoryLike[] = [
      { store: { getSnapshot: () => ({ current: { provider: 'codebuddy', model: 'claude' } }) }, select },
      { store: { getSnapshot: () => ({ current: { provider: 'trae', model: 'MiniMax-M2.7' } }) }, select },
      { store: { getSnapshot: () => ({ current: null }) }, select },
    ]
    expect(resetDisabledSelections(directories, ['codebuddy'], fallback)).toBe(1)
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(fallback)
  })
})
