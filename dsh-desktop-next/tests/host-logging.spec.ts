import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { configureHostLogging, installHostLogging } from '../src/host/logging.ts'
import { HOST_LOG_PREFIX } from '../src/log-record.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  configureHostLogging({ developerLogging: false, logLevel: 'info' })
  vi.restoreAllMocks()
})
async function environment(developerLogging = true) {
  configureHostLogging({ developerLogging, logLevel: 'debug' })
  const written: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { written.push(String(chunk)); return true })
  const ctx = new Context(); contexts.push(ctx)
  const fiber = ctx.plugin({ name: 'test-next-logging', apply: installHostLogging })
  await fiber.await()
  expect(fiber.state).toBe(2)
  const records = () => written.filter(line => line.startsWith(HOST_LOG_PREFIX)).map(line => JSON.parse(line.slice(HOST_LOG_PREFIX.length)))
  // Deliberately partial business payloads: exercise the real bus and observers without starting services.
  const dispatch = ctx.waterfall.bind(ctx) as (...args: any[]) => any
  return { ctx, fiber, records, dispatch }
}

it('exports native Cordis severity and source with redaction and removes the exporter on disposal', async () => {
  const { ctx, fiber, records } = await environment()
  ctx.logger('test-plugin').warn('Authorization: Bearer private-value')
  expect(records().at(-1)).toMatchObject({ source: 'host.kernel.test-plugin', level: 'warn', event: 'log' })
  expect(JSON.stringify(records())).not.toContain('private-value')
  const size = ctx.logger.exporters.size
  await fiber.dispose()
  expect(ctx.logger.exporters.size).toBe(size - 1)
})

it('observes model streams without logging messages or modifying yielded chunks', async () => {
  const { ctx, records, dispatch } = await environment()
  const options = { provider: 'test', model: 'example', sessionId: 'session-a', messages: [{ role: 'user', content: 'private prompt' }] }
  const chunks = [{ type: 'text', text: 'private response' }, { type: 'end' }]
  const stream = dispatch('llm/stream', options, async function* () { yield* chunks })
  const result = []
  for await (const chunk of stream) result.push(chunk)
  expect(result).toEqual(chunks)
  const request = records().filter(record => record.source === 'host.llm')
  expect(request).toHaveLength(2)
  expect(request[0].operationId).toBe(request[1].operationId)
  expect(request[1]).toMatchObject({ event: 'request.complete', fields: { chunks: 2, outcome: 'completed', sessionId: 'session-a' } })
  expect(JSON.stringify(request)).not.toContain('private prompt')
  expect(JSON.stringify(request)).not.toContain('private response')
})

it('keeps stream errors and early-consumer cancellation semantics intact', async () => {
  const { ctx, records, dispatch } = await environment()
  const options = { provider: 'test', model: 'example', messages: [] }
  const failure = new Error('network failed', { cause: new Error('socket closed') })
  const failed = dispatch('llm/stream', options, async function* () { throw failure })
  await expect(failed.next()).rejects.toBe(failure)
  expect(records().at(-1)).toMatchObject({ event: 'request.failed', error: { cause: { message: 'socket closed' } } })
  const disposed = vi.fn()
  const stream = dispatch('llm/stream', options, async function* () { try { yield { type: 'text', text: 'hidden' }; yield {} } finally { disposed() } })
  await stream.next(); await stream.return()
  expect(disposed).toHaveBeenCalledOnce()
  expect(records().at(-1)).toMatchObject({ event: 'request.complete', fields: { outcome: 'consumer-closed' } })
})

it('returns the identical tool result while recording execution metadata without arguments and content', async () => {
  const { ctx, records, dispatch } = await environment()
  const exec = { callId: 'call-a', rootCallId: 'call-a', name: 'bash', agent: { id: 'session-a' }, arguments: { command: 'private command' }, signal: new AbortController().signal }
  const result = { isError: false, value: 'private value', content: [{ type: 'text', text: 'private output' }] }
  await expect(dispatch('tools/execute', exec, async () => result)).resolves.toBe(result)
  const events = records().filter(record => record.source === 'host.tools')
  expect(events[1]).toMatchObject({ event: 'execute.complete', fields: { callId: 'call-a', sessionId: 'session-a', contentBlocks: 1 } })
  expect(events[0].operationId).toBe(events[1].operationId)
  expect(JSON.stringify(events)).not.toContain('private')
})

it('keeps one warning per error result and an error only for a throwing tool when developer logging is disabled', async () => {
  const { ctx, records, dispatch } = await environment(false)
  const exec = { callId: 'call-a', rootCallId: 'call-a', name: 'bash', signal: new AbortController().signal }
  const failure = { isError: true, error: { message: 'private failure detail', info: { code: 'ABORTED' } }, content: [] }
  await expect(dispatch('tools/execute', exec, async () => failure)).resolves.toBe(failure)
  expect(records()).toEqual([expect.objectContaining({ source: 'host.tools', event: 'execute.error-result', level: 'warn',
    fields: expect.objectContaining({ callId: 'call-a', tool: 'bash', failureCode: 'ABORTED' }) })])
  expect(JSON.stringify(records())).not.toContain('private failure detail')
  const thrown = new Error('plugin bug')
  await expect(dispatch('tools/execute', { ...exec, callId: 'call-b' }, async () => { throw thrown })).rejects.toBe(thrown)
  expect(records().at(-1)).toMatchObject({ event: 'execute.failed', level: 'error', fields: { callId: 'call-b' }, error: { message: 'plugin bug' } })
  expect(records().some(record => record.event === 'execute.start')).toBe(false)
  ctx.emit('internal/status', { state: 2, entry: { id: 'plugin-a', options: { name: 'example-module' } } } as never, 1 as never)
  ctx.provide('sessions', {} as never)
  await new Promise(resolve => setTimeout(resolve, 0))
  ctx.emit('session/event', { header: { id: 'session-a' } } as never, { type: 'tool/result', seq: 4, time: 1,
    data: { turn: 1, step: 1, message: { toolCallId: 'call-a', isError: true }, error: { code: 'ABORTED' } } } as never)
  expect(records()).toHaveLength(2)
  ctx.logger('test').debug('should be hidden')
  expect(JSON.stringify(records())).not.toContain('should be hidden')
})

it('records cancelled tools and model requests as completions, not failures', async () => {
  const { records, dispatch } = await environment()
  const controller = new AbortController(); controller.abort()
  const exec = { callId: 'call-a', rootCallId: 'call-a', name: 'bash', signal: controller.signal }
  const cancelled = { isError: true, error: { message: 'cancelled', info: { code: 'ABORTED' } }, content: [] }
  await expect(dispatch('tools/execute', exec, async () => cancelled)).resolves.toBe(cancelled)
  const abort = new Error('aborted')
  await expect(dispatch('tools/execute', { ...exec, callId: 'call-b' }, async () => { throw abort })).rejects.toBe(abort)
  const stream = dispatch('llm/stream', { provider: 'test', model: 'example', messages: [], signal: controller.signal }, async function* () { throw abort })
  await expect(stream.next()).rejects.toBe(abort)
  expect(records().filter(record => record.level === 'error' || record.level === 'warn')).toEqual([])
  expect(records().filter(record => record.event.endsWith('.complete')).map(record => record.fields.cancelled ?? record.fields.outcome))
    .toEqual([true, true, 'cancelled'])
})

it('records the retry decision while delegating the official request-error waterfall exactly once', async () => {
  const { ctx, records, dispatch } = await environment()
  const next = vi.fn(async () => ({ kind: 'retry' }))
  const action = await dispatch('agent/request-error', { agent: { id: 'session-a' }, turn: 1, step: 2, provider: 'test', failure: { code: 'RATE_LIMIT' } }, next)
  expect(action).toEqual({ kind: 'retry' }); expect(next).toHaveBeenCalledOnce()
  expect(records().at(-1)).toMatchObject({ event: 'request.retry-decision', fields: { sessionId: 'session-a', turn: 1, step: 2, retry: true } })
})

it('correlates metadata with canonical Session Log sequence and time without recording its payloads', async () => {
  const { ctx, records } = await environment()
  ctx.provide('sessions', {} as never)
  await new Promise(resolve => setTimeout(resolve, 0))
  const session = { header: { id: 'session-a' } } as never
  ctx.emit('session/event', session, { type: 'assistant/message', seq: 17, time: 12345,
    data: { turn: 2, step: 3, message: { content: 'private model output' }, stream: [{ text: 'private delta' }] } } as never)
  ctx.emit('session/event', session, { type: 'tool/call', seq: 18, time: 12346,
    data: { turn: 2, step: 3, callId: 'call-a', name: 'bash', arguments: 'private arguments' } } as never)
  const events = records().filter(record => record.source === 'host.session')
  expect(events).toHaveLength(2)
  expect(events[0]).toMatchObject({ event: 'assistant/message', fields: {
    sessionId: 'session-a', sessionEventType: 'assistant/message', sessionSequence: 17, sessionTime: 12345, streamRecords: 1,
  } })
  expect(events[1]).toMatchObject({ event: 'tool/call', fields: { sessionSequence: 18, callId: 'call-a', tool: 'bash' } })
  expect(JSON.stringify(events)).not.toContain('private')
})

it('records lightweight plugin state transitions directly from fiber entry without inventory scans', async () => {
  const { ctx, records } = await environment()
  ctx.emit('internal/status', { state: 2, entry: { id: 'plugin-a', options: { name: 'example-module' } } } as never, 1 as never)
  expect(records().at(-1)).toMatchObject({
    source: 'host.plugins',
    event: 'plugin.state',
    fields: { pluginId: 'plugin-a', module: 'example-module', previous: 1, state: 2 },
  })
})

it('summarizes a running turn\'s failed requests once and keeps the error that ended it, without prompts', async () => {
  const { ctx, records, dispatch } = await environment(false)
  ctx.provide('sessions', {} as never)
  await new Promise(resolve => setTimeout(resolve, 0))
  const session = { header: { id: 'a' } } as never
  ctx.emit('session/event', session, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as never)
  for (let i = 0; i < 5; i++) await dispatch('agent/request-error', { agent: { id: 'a' }, turn: 1, step: 1, provider: 'test', failure: { code: 'NETWORK', message: 'socket hang up' } }, async () => ({ kind: 'retry' }))
  const request = { provider: 'test', model: 'example', sessionId: 'a', messages: [{ role: 'user', content: 'private prompt' }] }
  const failed = dispatch('llm/stream', request, async function* () { throw new Error('socket hang up') })
  await expect(failed.next()).rejects.toThrow('socket hang up')
  expect(records()).toEqual([])
  // Auxiliary requests are not part of the turn's summary, so their failures stay in the standard log.
  const title = dispatch('llm/stream', { ...request, purpose: 'session-title' }, async function* () { throw new Error('title failed') })
  await expect(title.next()).rejects.toThrow('title failed')
  ctx.emit('agent/error', { agent: { id: 'a' }, turn: 1, step: 1, error: new Error('Provider failed: Authorization: Bearer private-value') } as never)
  ctx.emit('session/event', session, { type: 'turn/end', seq: 9, time: 9, data: { turn: 1, reason: { kind: 'error', error: { code: 'NETWORK', message: 'socket hang up', status: 503 } } } } as never)
  expect(records().map(record => `${record.source} ${record.event}`)).toEqual(['host.llm request.failed', 'host.agent agent.failed', 'host.health turn.summary'])
  expect(records()[0]).toMatchObject({ level: 'error', fields: { purpose: 'session-title' }, error: { message: 'title failed' } })
  expect(records()[1]).toMatchObject({ level: 'error', fields: { sessionId: 'a', turn: 1 }, error: { message: 'Provider failed: Authorization: Bearer ****' } })
  expect(records()[2]).toMatchObject({ level: 'error', message: 'Turn failed: NETWORK', fields: { sessionId: 'a', turn: 1, outcome: 'error', modelFailures: 5, failureCode: 'NETWORK', failureStatus: 503 } })
  expect(JSON.stringify(records())).not.toContain('private')
})

it('records an MCP outage once with its last error, the end of retries and the recovery, and forgets removed servers', async () => {
  const { ctx, records } = await environment(false)
  let stopped = false
  const snapshots: ((servers: { name: string }[] | undefined) => void)[] = []
  ctx.provide('mcpManager', {
    list: () => [{ name: 'early', status: { state: 'failed', reason: 'gave-up', lastError: 'spawn npx ENOENT' } }],
    async *watch(signal: AbortSignal) {
      signal.addEventListener('abort', () => { stopped = true; snapshots.splice(0).forEach(resolve => resolve(undefined)) }, { once: true })
      while (!signal.aborted) {
        const servers = await new Promise<{ name: string }[] | undefined>(resolve => { snapshots.push(resolve) })
        if (servers === undefined) return
        yield servers
      }
    },
  } as never)
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  await tick()
  const status = (value: object, server = 'github') => ctx.emit('mcp-manager/status', server, value as never)
  for (let attempt = 1; attempt < 10; attempt++) {
    status({ state: 'reconnecting', attempt, maxAttempts: 10, nextRetryAtMs: 0, lastError: 'connect ECONNREFUSED 127.0.0.1:8931; Authorization: Bearer private-value' })
  }
  status({ state: 'failed', reason: 'gave-up', lastError: 'connect ECONNREFUSED 127.0.0.1:8931' }); status({ state: 'failed', reason: 'gave-up' })
  status({ state: 'connected', toolCount: 4, connectedAt: 0 }); status({ state: 'connected', toolCount: 4, connectedAt: 0 })
  expect(records().map(record => `${record.fields.server} ${record.event}`)).toEqual(['early mcp.gave-up', 'github mcp.failed', 'github mcp.gave-up', 'github mcp.recovered'])
  expect(records()[1]).toMatchObject({ source: 'host.health', level: 'warn', message: 'MCP server github: connection failed; retrying',
    fields: { state: 'reconnecting', attempt: 1, maxAttempts: 10, lastError: 'connect ECONNREFUSED 127.0.0.1:8931; Authorization: Bearer ****' } })
  expect(records()[3]).toMatchObject({ level: 'info', fields: { state: 'connected', toolCount: 4 } })
  expect(JSON.stringify(records())).not.toContain('private-value')
  // A server removed during an outage starts clean when one is added again under its name.
  status({ state: 'waiting-credentials', lastError: 'OAuth sign-in required' }, 'linear')
  snapshots.shift()!([{ name: 'github' }])
  await tick()
  status({ state: 'connected', toolCount: 1, connectedAt: 0 }, 'linear')
  expect(records().filter(record => record.fields.server === 'linear').map(record => record.event)).toEqual(['mcp.failed'])
  await ctx.fiber.dispose()
  expect(stopped).toBe(true)
})

it('records an MCP server that waits for OAuth authorization once, with why, and its recovery', async () => {
  const { ctx, records } = await environment(false)
  ctx.provide('mcpManager', { list: () => [], async *watch() {} } as never)
  await new Promise(resolve => setTimeout(resolve, 0))
  const status = (value: object) => ctx.emit('mcp-manager/status', 'notion', value as never)
  status({ state: 'waiting-authorization', reason: 'expired', lastError: 'refresh token expired; access_token=private-value' })
  status({ state: 'waiting-authorization', reason: 'expired', lastError: 'refresh token expired' })
  status({ state: 'connecting', attempt: 0 })
  status({ state: 'connected', toolCount: 7, connectedAt: 0 })
  expect(records().map(record => record.event)).toEqual(['mcp.failed', 'mcp.recovered'])
  expect(records()[0]).toMatchObject({ source: 'host.health', level: 'warn', message: 'MCP server notion: waiting for authorization (expired)',
    fields: { server: 'notion', state: 'waiting-authorization', reason: 'expired' } })
  expect(JSON.stringify(records())).not.toContain('private-value')
  expect(records()[1]).toMatchObject({ level: 'info', fields: { server: 'notion', state: 'connected', toolCount: 7 } })
})
