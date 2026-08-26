import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  type GenerateOptions,
  type LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'

const SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'legacy adapter reply' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'legacy adapter reply' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('legacy LLM adapter compatibility', () => {
  it('adapts the rc.1 resolveModel and stream contract without swallowing invalid adapters', async () => {
    const resolved: Array<{ provider: string; model: string }> = []
    const streamed: GenerateOptions[] = []
    const legacyAdapter = {
      providerInfo: (provider: string) => ({ id: provider, name: provider }),
      providerRetryPolicy: () => undefined,
      listModels: () => Promise.resolve([]),
      resolveModel: (provider: string, model: string): Promise<LlmResolvedModelInfo> => {
        resolved.push({ provider, model })
        return Promise.resolve({ provider, id: model, name: model, defaultMaxTokens: 256 })
      },
      stream: async function * (options: GenerateOptions): AsyncIterable<StreamChunk> {
        streamed.push(options)
        yield * SCRIPT
      },
    } as unknown as LlmAdapter

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['legacy'], legacyAdapter)

    const prepared = await ctx.llm.prepareCall({ provider: 'legacy', model: 'rc1-model' })
    expect(prepared.config).toEqual({ provider: 'legacy', model: 'rc1-model', maxTokens: 256 })
    expect(resolved).toEqual([{ provider: 'legacy', model: 'rc1-model' }])

    expect(await collect(prepared.stream({ ...prepared.config, messages: [] }))).toEqual(SCRIPT)
    expect(streamed).toHaveLength(1)
    expect(streamed[0]).toMatchObject({ provider: 'legacy', model: 'rc1-model', maxTokens: 256 })

    expect(await collect(ctx.llm.stream({
      provider: 'legacy',
      model: 'direct-model',
      messages: [],
    }))).toEqual(SCRIPT)
    expect(resolved.at(-1)).toEqual({ provider: 'legacy', model: 'direct-model' })
  })

  it('rejects adapters that match neither the rc.2 nor rc.1 contract', async () => {
    const malformedAdapter = {
      providerInfo: (provider: string) => ({ id: provider, name: provider }),
      providerRetryPolicy: () => undefined,
      listModels: () => Promise.resolve([]),
      stream: async function * (): AsyncIterable<StreamChunk> {
        yield * SCRIPT
      },
    } as unknown as LlmAdapter

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['malformed'], malformedAdapter)

    await expect(ctx.llm.prepareCall({ provider: 'malformed', model: 'model' }))
      .rejects.toMatchObject({ code: 'INVALID_ADAPTER' })
  })
})
