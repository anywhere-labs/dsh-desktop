import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-llm@0.1.5-rc.1.patch',
  import.meta.url,
), 'utf8')

describe('adapter prepareCall compatibility patch', () => {
  it('feature-detects prepareCall before both runtime call sites', () => {
    for (const marker of [
      'async function adapterPrepareCall(adapter, provider, model, signal) {',
      'if (typeof adapter.prepareCall === "function") return adapter.prepareCall(provider, model, signal);',
      'await adapterPrepareCall(registration.adapter, config.provider, config.model, signal);',
      'await adapterPrepareCall(adapter, options.provider, options.model, options.signal);',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('synthesizes the LlmAdapter default for plain-object plugin adapters', () => {
    for (const marker of [
      'typeof adapter.resolveModel === "function" ? adapter.resolveModel(provider, model, signal) : { provider, id: model, name: model }',
      'stream: (options) => adapter.stream(options)',
    ]) {
      expect(patch).toContain(marker)
    }
  })
})
