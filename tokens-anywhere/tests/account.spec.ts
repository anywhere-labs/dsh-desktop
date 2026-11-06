import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import {
  ANYWHERE_API_KEY_REF, ANYWHERE_ROUTE_IDS, TOKENS_ANYWHERE_ORIGIN, anywhereRoutes, beijingDates, commonThinkingLevel,
  offeredAnywhereModels, planAnywhereModels, stableJson, summarizeAnywhereUsage, tokensAnywhereOrigin,
} from '../src/account.ts'
import {
  formatCount, formatMoney, formatMoneyShort, formatTokenLimit, formatUsd, formatYuanOf, moneyFormat, usageTicks,
} from '../src/client/shared.ts'
import {
  AnywhereAccount, LoopbackCallback, openProfileConfiguration, type CallbackResult, type LocalFiles,
} from '../src/host/account.ts'
import { AnywhereShell } from '../src/host/shell.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** One GET against a loopback listener, with the Host header a browser would send unless overridden. */
function get(url: string, host?: string): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = httpRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, agent: false,
      headers: host === undefined ? {} : { host } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, ...(res.headers.location ? { location: res.headers.location } : {}), body }) })
    })
    req.on('error', reject)
    req.end()
  })
}

const priced = [
  { model: 'claude-sonnet-5-5', provider: 'anthropic', maxOutputTokens: 64000 },
  { model: 'claude-haiku-4-5', provider: 'anthropic', maxOutputTokens: 8192 },
  { model: 'deepseek-v4-pro', provider: 'deepseek', maxOutputTokens: 128000 },
  { model: 'gpt-6-sol', provider: 'openai', maxOutputTokens: 128000 },
  { model: 'gemini-3.5-flash', provider: 'gemini', maxOutputTokens: 65536 },
]
const profiles = {
  'claude-sonnet-5-5': { displayName: 'Claude Sonnet 5.5', contextWindow: 1_000_000, capabilities: ['reasoning', 'vision', 'tools'] },
  'gpt-6-sol': { displayName: 'GPT-6 Sol', contextWindow: 400_000, capabilities: ['tools'] },
}
const CHAT_IDS = ['gpt-6-sol', 'deepseek-v4-pro', 'mystery-model']
const ANTHROPIC_IDS = ['claude-sonnet-5-5', 'claude-haiku-4-5', 'deepseek-v4-pro']
const GEMINI_IDS = ['gemini-3.5-flash']

function catalog(chat = CHAT_IDS) {
  return planAnywhereModels({ chat, anthropic: ANTHROPIC_IDS, gemini: GEMINI_IDS, priced, profiles })
}

describe('models', () => {
  it('groups what the key can call by family, each vendor on a route of its own', () => {
    const models = catalog()
    expect(models.map(model => [model.family, model.id])).toEqual([
      ['deepseek', 'deepseek-v4-pro'],
      ['claude', 'claude-haiku-4-5'], ['claude', 'claude-sonnet-5-5'],
      ['gpt', 'gpt-6-sol'],
      ['gemini', 'gemini-3.5-flash'],
      ['other', 'mystery-model'],
    ])
    const byId = new Map(models.map(model => [model.id, model]))
    expect(byId.get('deepseek-v4-pro')?.route).toBe(ANYWHERE_ROUTE_IDS.deepseek)
    expect(byId.get('claude-sonnet-5-5')).toMatchObject({ route: ANYWHERE_ROUTE_IDS.claude, name: 'Claude Sonnet 5.5', contextWindow: 1_000_000, maxTokens: 64000, vision: true })
    expect(byId.get('gpt-6-sol')?.route).toBe(ANYWHERE_ROUTE_IDS.gpt)
    expect(byId.get('gemini-3.5-flash')?.route).toBe(ANYWHERE_ROUTE_IDS.gemini)
    expect(byId.get('mystery-model')).toMatchObject({ route: ANYWHERE_ROUTE_IDS.other, thinking: [] })
    // Listed where its family has no route, as nothing can call it that way.
    const stray = planAnywhereModels({ chat: ['claude-stray'], anthropic: [], gemini: [], priced: [], profiles: {} })
    expect(stray[0]).toMatchObject({ family: 'claude', enabled: false })
    expect(stray[0]?.route).toBeUndefined()
  })

  it('offers each model its own thinking levels, off first where it can be turned off', () => {
    const byId = new Map(catalog().map(model => [model.id, model]))
    expect(byId.get('deepseek-v4-pro')?.thinking).toEqual(['off', 'high', 'max'])
    expect(byId.get('claude-sonnet-5-5')?.thinking).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(byId.get('claude-haiku-4-5')?.thinking).toEqual(['off', 'low', 'medium', 'high'])
    expect(byId.get('gpt-6-sol')?.thinking).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('applies the user\'s switches and names, and leaves switched-off models out of the routes', () => {
    const models = planAnywhereModels({
      chat: CHAT_IDS, anthropic: ANTHROPIC_IDS, gemini: [], priced, profiles, overrides: { hidden: ['gpt-6-sol'], names: { 'deepseek-v4-pro': 'DS Pro' } },
    })
    const byId = new Map(models.map(model => [model.id, model]))
    expect(byId.get('gpt-6-sol')?.enabled).toBe(false)
    expect(byId.get('deepseek-v4-pro')).toMatchObject({ enabled: true, name: 'DS Pro', defaultName: 'deepseek-v4-pro' })
    const routes = anywhereRoutes(models, 'https://tokens.example/')
    expect(routes[ANYWHERE_ROUTE_IDS.deepseek]?.models.map(model => [model.id, model.name])).toEqual([['deepseek-v4-pro', 'DS Pro']])
    expect(routes[ANYWHERE_ROUTE_IDS.gpt]).toBeUndefined()
    expect(routes[ANYWHERE_ROUTE_IDS.other]?.models.map(model => model.id)).toEqual(['mystery-model'])
    const familyOff = planAnywhereModels({
      chat: CHAT_IDS, anthropic: ANTHROPIC_IDS, gemini: [], priced, profiles, overrides: { hidden: [], names: {}, hiddenFamilies: ['claude'] },
    })
    expect(familyOff.filter(model => model.family === 'claude').map(model => model.enabled)).toEqual([false, false])
    expect(anywhereRoutes(familyOff, 'https://tokens.example/')[ANYWHERE_ROUTE_IDS.claude]).toBeUndefined()
  })

  it('writes a Gemini route with the levels of pi-ai\'s catalog, thinking by default', () => {
    const models = planAnywhereModels({
      chat: [], anthropic: [], gemini: ['gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-4-argon'], priced, profiles,
    })
    expect(Object.fromEntries(models.map(model => [model.id, model.thinking]))).toEqual({
      'gemini-2.5-flash': ['off', 'minimal', 'low', 'medium', 'high'],
      'gemini-3.1-pro-preview': ['low', 'medium', 'high'],
      'gemini-3.5-flash': ['minimal', 'low', 'medium', 'high'],
      // Not in the catalog: the levels every catalogued Gemini 3 offers.
      'gemini-4-argon': ['low', 'medium', 'high'],
    })
    const route = anywhereRoutes(models, 'https://tokens.example/')[ANYWHERE_ROUTE_IDS.gemini]
    expect(route).toMatchObject({ api: 'google-generative-ai', baseURL: 'https://tokens.example/v1beta', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high' })
    const byId = new Map(route?.models.map(model => [model.id, model]))
    expect(byId.get('gemini-2.5-flash')?.reasoningEfforts).toEqual({ off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' })
    expect(byId.get('gemini-3.5-flash')?.reasoningEfforts).toEqual({ minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' })
    expect(byId.get('gemini-3.5-flash')?.compat).toBeUndefined()
  })

  it('writes Chat Completions routes per vendor and an Anthropic route, all thinking by default', () => {
    const routes = anywhereRoutes(catalog(['gpt-6-sol', 'deepseek-v4-pro']), 'https://tokens.example/')
    expect(routes[ANYWHERE_ROUTE_IDS.deepseek]).toMatchObject({
      displayName: 'Tokens Anywhere · DeepSeek', api: 'openai-completions', baseURL: 'https://tokens.example/v1', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high',
    })
    expect(routes[ANYWHERE_ROUTE_IDS.gpt]).toMatchObject({
      displayName: 'Tokens Anywhere · GPT', api: 'openai-completions', baseURL: 'https://tokens.example/v1', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high',
    })
    expect(routes[ANYWHERE_ROUTE_IDS.claude]).toMatchObject({
      api: 'anthropic-messages', baseURL: 'https://tokens.example', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high',
    })
    const chat = new Map([...routes[ANYWHERE_ROUTE_IDS.deepseek]?.models ?? [], ...routes[ANYWHERE_ROUTE_IDS.gpt]?.models ?? []].map(model => [model.id, model]))
    expect(chat.get('deepseek-v4-pro')).toMatchObject({
      reasoningEfforts: { off: null, high: 'high', max: 'max' },
      compat: { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
    })
    expect(chat.get('gpt-6-sol')?.reasoningEfforts).toMatchObject({ off: 'none', high: 'high', xhigh: 'xhigh', max: 'max' })
    const claude = new Map(routes[ANYWHERE_ROUTE_IDS.claude]?.models.map(model => [model.id, model]))
    expect(claude.get('claude-sonnet-5-5')).toMatchObject({
      input: ['text', 'image'], compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    })
  })

  it('declares no route default that some model on the route lacks', () => {
    const routes = anywhereRoutes(catalog(), 'https://tokens.example')
    // The unknown model does not think, so nothing is common to every model on the route.
    expect(routes[ANYWHERE_ROUTE_IDS.other]?.reasoning).toBeUndefined()
    expect(new Map(routes[ANYWHERE_ROUTE_IDS.other]?.models.map(model => [model.id, model])).get('mystery-model')?.reasoningEfforts).toBe(false)
    expect(commonThinkingLevel([])).toBeUndefined()
    expect(commonThinkingLevel([{ reasoningEfforts: { high: 'high', max: 'max' } }, { reasoningEfforts: { off: null, high: 'high' } }])).toBe('high')
  })

  it('says what routes offer, however they were edited', () => {
    expect(offeredAnywhereModels({
      a: { models: [
        { id: 'plain', name: '', input: ['text'] },
        { id: 'thinks', name: 'Thinks', input: ['text'], reasoningEfforts: { max: 'max', off: null, low: 'low' } },
        { id: 'never', name: 'Never', input: ['text'], reasoningEfforts: false },
      ] },
    })).toEqual([
      { route: 'a', id: 'plain', name: 'plain', thinking: [] },
      { route: 'a', id: 'thinks', name: 'Thinks', thinking: ['off', 'low', 'max'] },
      { route: 'a', id: 'never', name: 'Never', thinking: [] },
    ])
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }))
  })
})

describe('usage', () => {
  it('counts Beijing days, whatever the local clock says', () => {
    // 16:30 UTC on Nov 1 is already Nov 2 in Beijing.
    expect(beijingDates(3, new Date('2026-11-01T16:30:00Z'))).toEqual({ from: '2026-10-31', to: '2026-11-02', dates: ['2026-10-31', '2026-11-01', '2026-11-02'] })
    expect(beijingDates(1, new Date('2026-11-01T15:59:00Z')).to).toBe('2026-11-01')
  })

  it('fills days without use and adds amounts exactly', () => {
    const row = (date: string, model: string | null, amount: string, requests: number) => ({
      date, model, requests, inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWrite5mTokens: 1, cacheWrite1hTokens: 0, amountCharged: amount,
    })
    const usage = summarizeAnywhereUsage({ days: 7, dates: ['2026-10-31', '2026-11-01', '2026-11-02'], rows: [
      row('2026-11-01', 'deepseek-v4-pro', '0.100000', 1),
      row('2026-11-01', 'claude-sonnet-5-5', '0.200000', 1),
      // Tokens Anywhere bills in millionths of a dollar: a short reply costs less than a cent.
      row('2026-11-02', 'claude-sonnet-5-5', '1.000250', 2),
      row('2026-10-01', 'old-model', '9.000000', 9),
    ] })
    expect(usage).toMatchObject({ days: 7, from: '2026-10-31', to: '2026-11-02' })
    expect(usage.totals).toEqual({ requests: 4, inputTokens: 30, outputTokens: 15, cacheTokens: 9, amount: '1.300250' })
    expect(usage.daily.map(day => [day.date, day.amount, day.requests])).toEqual([['2026-10-31', '0.000000', 0], ['2026-11-01', '0.300000', 2], ['2026-11-02', '1.000250', 2]])
    // Each day's spend per model, for the stacked chart.
    expect(usage.daily.map(day => day.byModel)).toEqual([{}, { 'deepseek-v4-pro': '0.100000', 'claude-sonnet-5-5': '0.200000' }, { 'claude-sonnet-5-5': '1.000250' }])
    expect(usage.models.map(model => [model.model, model.amount])).toEqual([['claude-sonnet-5-5', '1.200250'], ['deepseek-v4-pro', '0.100000']])
  })

  it('sums up one model alone, and rows without a model under no name', () => {
    const row = (date: string, model: string | null, amount: string) => ({
      date, model, requests: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, amountCharged: amount,
    })
    const read = { days: 7 as const, dates: ['2026-11-01', '2026-11-02'], rows: [
      row('2026-11-01', 'deepseek-v4-pro', '0.100000'),
      row('2026-11-01', 'claude-sonnet-5-5', '0.200000'),
      row('2026-11-02', null, '0.400000'),
    ] }
    const one = summarizeAnywhereUsage(read, 'claude-sonnet-5-5')
    expect(one.totals).toMatchObject({ requests: 1, inputTokens: 10, amount: '0.200000' })
    expect(one.daily.map(day => [day.date, day.amount])).toEqual([['2026-11-01', '0.200000'], ['2026-11-02', '0.000000']])
    expect(one.models.map(model => model.model)).toEqual(['claude-sonnet-5-5'])
    expect(summarizeAnywhereUsage(read, '').totals.amount).toBe('0.400000')
    expect(summarizeAnywhereUsage(read, 'not-used').totals.requests).toBe(0)
    expect(summarizeAnywhereUsage(read).totals.amount).toBe('0.700000')
  })

  it('writes money as the Tokens Anywhere console does', () => {
    expect(formatUsd('12.345600', 'en-US')).toBe('$12.3456')
    expect(formatUsd('19.500000', 'zh-CN')).toBe('$19.50')
    expect(formatUsd('0.000250', 'en-US')).toBe('$0.00025')
    expect(formatUsd('1234.000000', 'en-US')).toBe('$1,234.00')
    expect(formatYuanOf('10.000000', 7.1, 'zh-CN')).toBe('¥71')
    expect(formatYuanOf('1.000000', 7.12345, 'zh-CN')).toBe('¥7.12')
    expect(formatYuanOf('200.000000', 7.1, 'zh-CN')).toBe('¥1,420')
    // Yuan for a Chinese reader whose account shows them, at a rate; the dollars stay beside them.
    const yuan = moneyFormat({ localCurrency: true, cnyRate: 7.1 }, 'zh')
    expect(formatMoney('10.000000', yuan)).toBe('¥71（$10.00）')
    expect(formatMoneyShort('10.000000', yuan)).toBe('¥71')
    // English has no currency of its own; a preference turned off or a missing rate leaves dollars alone too.
    for (const dollars of [
      moneyFormat({ localCurrency: true, cnyRate: 7.1 }, 'en'),
      moneyFormat({ localCurrency: false, cnyRate: 7.1 }, 'zh'),
      moneyFormat({ localCurrency: true }, 'zh'),
      moneyFormat(undefined, 'zh'),
    ]) {
      expect(formatMoney('10.000000', dollars)).toBe('$10.00')
      expect(formatMoneyShort('10.000000', dollars)).toBe('$10.00')
    }
  })

  it('formats counts and limits for reading', () => {
    expect(formatCount(1284, 'zh')).toBe('1,284')
    expect(formatCount(12900, 'en')).toBe('12.9K')
    expect(formatTokenLimit(1_000_000)).toBe('1M')
    expect(formatTokenLimit(64000)).toBe('64K')
  })

  it('picks clean axis ticks at any scale', () => {
    expect(usageTicks(0)).toEqual([0])
    expect(usageTicks(10)).toEqual([0, 5, 10])
    // The axis never steps below a cent or a fen.
    expect(usageTicks(0.0053)).toEqual([0, 0.01])
    expect(usageTicks(0.2874)).toEqual([0, 0.1, 0.2, 0.3])
    expect(usageTicks(137)).toEqual([0, 50, 100, 150])
  })
})

it('sends tokens and the key only to HTTPS or to Tokens Anywhere on this computer', () => {
  expect(tokensAnywhereOrigin(undefined)).toBe(TOKENS_ANYWHERE_ORIGIN)
  expect(tokensAnywhereOrigin('  ')).toBe(TOKENS_ANYWHERE_ORIGIN)
  expect(tokensAnywhereOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  expect(tokensAnywhereOrigin('http://127.0.0.1:5173/console/')).toBe('http://127.0.0.1:5173')
  expect(tokensAnywhereOrigin('https://staging.tokens.example/')).toBe('https://staging.tokens.example')
  for (const refused of ['http://tokens.example', 'http://192.168.1.2:5173', 'ftp://localhost', 'https://user:pass@tokens.example', 'not a url']) {
    expect(tokensAnywhereOrigin(refused)).toBe(TOKENS_ANYWHERE_ORIGIN)
  }
})

describe('loopback callback', () => {
  it('takes one callback for its own state on 127.0.0.1, answers once the code is redeemed, then stops listening', async () => {
    const results: CallbackResult[] = []
    let settle: () => void = () => {}
    const callback = new LoopbackCallback('https://tokens.example/oauth/done/', (result) => {
      results.push(result)
      return new Promise((resolve) => { settle = resolve })
    })
    await callback.listen()
    const port = new URL(callback.redirectUri).port
    const target = `${callback.redirectUri}?code=abc&state=${callback.state}&iss=https%3A%2F%2Ftokens.example`
    expect((await get(target, `localhost:${port}`)).status).toBe(403)
    expect((await get(`${callback.redirectUri}?code=abc&state=wrong`)).status).toBe(400)
    expect((await get(`http://127.0.0.1:${port}/other?code=abc&state=${callback.state}`)).status).toBe(404)
    expect(results).toEqual([])
    const answered = vi.fn()
    const first = get(target).then((reply) => { answered(); return reply })
    await vi.waitFor(() => { expect(results).toEqual([{ code: 'abc', iss: 'https://tokens.example' }]) })
    expect(answered).not.toHaveBeenCalled()
    settle()
    const reply = await first
    expect(reply.status).toBe(302)
    expect(reply.location).toBe('https://tokens.example/oauth/done/')
    expect(reply.body).toBe('')
    await expect(get(target)).rejects.toThrow()
    expect(results).toHaveLength(1)
    callback.close()
  })

  it('reports a refused authorization', async () => {
    const results: CallbackResult[] = []
    const callback = new LoopbackCallback('https://tokens.example/oauth/done/', async (result) => { results.push(result) })
    await callback.listen()
    const reply = await get(`${callback.redirectUri}?error=access_denied&state=${callback.state}`)
    expect(reply.status).toBe(302)
    expect(results).toEqual([{ error: 'access_denied', iss: null }])
    callback.close()
  })

  it('makes a verifier and challenge RFC 7636 accepts', () => {
    const callback = new LoopbackCallback('https://tokens.example/oauth/done/', async () => {})
    expect(callback.verifier).toMatch(/^[\w-]{43,128}$/)
    expect(callback.challenge).toBe(createHash('sha256').update(callback.verifier).digest('base64url'))
    expect(callback.state.length).toBeGreaterThanOrEqual(32)
  })
})

describe('Desktop sign-in window and keychain', () => {
  function desktop() {
    const closed = new Set<() => void>()
    const links = new Set<() => void>()
    return {
      closed, links,
      openLogin: vi.fn(), closeLogin: vi.fn(),
      seal: vi.fn(async (value: string): Promise<string | undefined> => `sealed:${value}`),
      open: vi.fn(async (value: string): Promise<string | undefined> => value.replace(/^sealed:/, '')),
      onLoginClosed: (listener: () => void) => { closed.add(listener); return () => { closed.delete(listener) } },
      onLinkOpened: (listener: () => void) => { links.add(listener); return () => { links.delete(listener) } },
    }
  }

  it('uses DSH Next\'s window and keychain while they are there, and seals nothing without them', async () => {
    const closed = vi.fn()
    const requested = vi.fn()
    const shell = new AnywhereShell(closed, requested)
    await expect(shell.seal('ta_rt_secret')).resolves.toBeUndefined()
    shell.openLogin('https://tokens.example/', 'http://127.0.0.1:43123/oauth/callback')
    const service = desktop()
    const release = shell.attach(service)
    await expect(shell.seal('ta_rt_secret')).resolves.toBe('sealed:ta_rt_secret')
    shell.openLogin('https://tokens.example/oauth/authorize/', 'http://127.0.0.1:43123/oauth/callback')
    shell.closeLogin(true)
    expect(service.openLogin).toHaveBeenCalledExactlyOnceWith('https://tokens.example/oauth/authorize/', 'http://127.0.0.1:43123/oauth/callback')
    expect(service.closeLogin).toHaveBeenCalledExactlyOnceWith(true)
    for (const listener of service.closed) listener()
    for (const listener of service.links) listener()
    expect(closed).toHaveBeenCalledOnce()
    expect(requested).toHaveBeenCalledOnce()
    release()
    expect(service.closed.size + service.links.size).toBe(0)
    await expect(shell.seal('later')).resolves.toBeUndefined()
    shell.dispose()
  })

  it('gives a Desktop that loads after the plugin a moment to open the stored token', async () => {
    vi.useFakeTimers()
    try {
      const shell = new AnywhereShell(() => {}, () => {})
      const opening = shell.open('sealed:ta_rt_1')
      shell.attach(desktop())
      await expect(opening).resolves.toBe('ta_rt_1')
      const alone = new AnywhereShell(() => {}, () => {})
      const waiting = alone.open('sealed:ta_rt_2')
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(waiting).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** In-memory stand-ins for the Host services the account writes. */
function services() {
  const refs = new Map<string, string>()
  const records = new Map<string, { kind: 'grant'; payload: unknown }>()
  let providers: Record<string, unknown> = {}
  const credentials = {
    resolve: async (ref: string) => refs.has(ref) ? { value: refs.get(ref)!, source: 'file' } : undefined,
    set: vi.fn(async (ref: string, value: string) => { refs.set(ref, value) }),
    unset: vi.fn(async (ref: string) => { refs.delete(ref) }),
    readRecord: async (key: string) => records.get(key) as never,
    modifyRecord: vi.fn(async (key: string, mutate: (current: unknown) => Promise<{ kind: 'grant'; payload: unknown } | undefined>) => {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key) as never
    }),
    deleteRecord: vi.fn(async (key: string) => { records.delete(key) }),
  }
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', value: { providers }, user: { providers } }],
    mutate: vi.fn(async (_ns: string, ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[]) => {
      const next = structuredClone(providers)
      for (const op of ops) {
        const parents = op.path.slice(1, -1)
        const parent = parents.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, next)
        if (op.op === 'set') parent[op.path.at(-1)!] = op.value
        else delete parent[op.path.at(-1)!]
      }
      providers = next
    }),
  }
  const shell = {
    openLogin: vi.fn(), closeLogin: vi.fn(),
    seal: vi.fn(async (value: string): Promise<string | undefined> => `sealed:${value}`),
    open: vi.fn(async (value: string): Promise<string | undefined> => value.replace(/^sealed:/, '')),
    dispose: vi.fn(),
  }
  return { credentials, settings, shell, refs, records, get providers() { return providers }, get record() { return records.get(credentialKey('tokens-anywhere', 'account') as string)?.payload as Record<string, unknown> | undefined } }
}

const ORIGIN = 'http://tokens.test'
const KEY = 'sk-secret-value-1'

/** A Tokens Anywhere that checks what DSH sends the way the server does. */
function fakeTokens() {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const server = {
    challenge: '', redirectUri: '', refreshed: 0, refreshError: undefined as string | undefined,
    access: new Set<string>(), refresh: new Set<string>(), revoked: [] as string[], keySecret: KEY,
    models: { chat: ['deepseek-v4-pro', 'gpt-6-sol'], anthropic: ['claude-sonnet-5-5', 'deepseek-v4-pro'] } as { chat: string[]; anthropic: string[]; gemini?: string[] },
    usageQueries: [] as URLSearchParams[], calls: [] as string[],
  }
  let counter = 0
  const pair = () => {
    counter++
    server.access.add(`ta_at_${counter}`)
    server.refresh.add(`ta_rt_${counter}`)
    return json({ access_token: `ta_at_${counter}`, refresh_token: `ta_rt_${counter}`, token_type: 'Bearer', expires_in: 3600, scope: 'user' })
  }
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname
    server.calls.push(`${init?.method ?? 'GET'} ${path}`)
    expect(url.origin).toBe(ORIGIN)
    const headers = new Headers(init?.headers)
    if (path === '/api/v1/oauth/token') {
      expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('client_id')).toBe('dsh')
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
        if (form.get('code') !== 'the-code' || challenge !== server.challenge || form.get('redirect_uri') !== server.redirectUri) {
          return json({ error: 'invalid_grant', error_description: 'bad code' }, 400)
        }
        return pair()
      }
      if (server.refreshError !== undefined) return json({ error: server.refreshError }, 400)
      if (!server.refresh.delete(form.get('refresh_token') ?? '')) return json({ error: 'invalid_grant' }, 400)
      server.refreshed++
      return pair()
    }
    if (path === '/api/v1/oauth/revoke') {
      server.revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '')
      return new Response(null, { status: 200 })
    }
    if (path === '/v1/models') {
      expect(headers.get('authorization')?.replace(/^Bearer /, '') ?? headers.get('x-api-key') ?? headers.get('x-goog-api-key')).toBe(server.keySecret)
      const listed = headers.has('x-goog-api-key') ? server.models.gemini ?? [] : headers.has('x-api-key') ? server.models.anthropic : server.models.chat
      return json({ data: listed.map(id => ({ id })) })
    }
    if (path === '/api/v1/pricing') return json({ groups: [{ name: 'default', models: priced }], profiles })
    if (path === '/api/v1/exchange-rates') return json({ date: '2026-11-06', rates: { CNY: 7.1, JPY: 152 } })
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!server.access.has(bearer)) return json({ error: { code: 'unauthenticated' } }, 401)
    if (path === '/api/v1/me') return json({ id: '7', displayName: 'Ada', email: 'ada@example.com', loginName: '' })
    if (path === '/api/v1/balance') return json({ balance: '20.000000', held: '0.500000', available: '19.500000', bonus: '0.000000', topupPayRate: 10000 })
    if (path === '/api/v1/me/preferences') return json({ localCurrency: true })
    if (path === '/api/v1/keys/42/rotate') {
      server.keySecret = `sk-rotated-${String(++counter)}`
      return json({ key: { id: '42', prefix: server.keySecret.slice(0, 11) }, secret: server.keySecret })
    }
    if (path === '/api/v1/keys/managed') {
      expect(JSON.parse(String(init?.body))).toEqual({ app: 'dsh-next' })
      return json({ key: { id: '42', prefix: `${server.keySecret.slice(0, 11)}` }, secret: server.keySecret })
    }
    if (path === '/api/v1/usage/daily') {
      server.usageQueries.push(url.searchParams)
      return json({ items: [{ date: url.searchParams.get('to'), model: 'deepseek-v4-pro', requests: 3, inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, amountCharged: '0.000250' }] })
    }
    throw new Error(`unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return server
}

function newAccount(fake: ReturnType<typeof services>, local?: LocalFiles) {
  return new AnywhereAccount(fake.credentials as never, fake.settings as never, fake.shell as never, ORIGIN, local)
}

/** The plugin's two switches for DSH's local files, saved as the configuration editor would. */
function localFiles(initial = { storeKey: true, writeModels: true }) {
  const state = { ...initial }
  const files: LocalFiles = {
    storeKey: () => state.storeKey, writeModels: () => state.writeModels, writable: true,
    save: async (change) => { Object.assign(state, change) },
  }
  return { state, files }
}

/** Run the browser part of a sign-in: the authorize URL opens, and Tokens Anywhere redirects back with a code. */
async function signIn(account: AnywhereAccount, server: ReturnType<typeof fakeTokens>, query = 'code=the-code&iss=http%3A%2F%2Ftokens.test') {
  const { authorizeUrl } = await account.begin()
  const page = new URL(authorizeUrl)
  server.challenge = page.searchParams.get('code_challenge') ?? ''
  server.redirectUri = page.searchParams.get('redirect_uri') ?? ''
  const reply = await get(`${server.redirectUri}?${query}&state=${page.searchParams.get('state')}`)
  return { page, reply }
}

describe('Anywhere account', () => {
  it('signs in per spec, keeps the refresh token sealed, sets the models up thinking, and undoes it all on sign-out', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      const { page, reply } = await signIn(account, server)
      // The authorize request is the registered public client's, with PKCE and no secret.
      expect(`${page.origin}${page.pathname}`).toBe(`${ORIGIN}/oauth/authorize/`)
      expect(Object.fromEntries(page.searchParams)).toMatchObject({ response_type: 'code', client_id: 'dsh', code_challenge_method: 'S256', scope: 'user' })
      expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
      expect(fake.shell.openLogin).toHaveBeenCalledWith(page.href, server.redirectUri)
      // The browser is sent on to the done page, once everything is set up.
      expect(reply).toMatchObject({ status: 302, location: `${ORIGIN}/oauth/done/` })
      expect((await account.snapshot()).attempt?.phase).toBe('succeeded')
      expect(fake.shell.closeLogin).toHaveBeenCalledWith(true)

      expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(KEY)
      expect(Object.keys(fake.providers).sort()).toEqual(['tokens-anywhere-claude', 'tokens-anywhere-deepseek', 'tokens-anywhere-gpt'])
      // Thinking is on by default: each route names a level.
      expect(fake.providers['tokens-anywhere-deepseek']).toMatchObject({ reasoning: 'high', api: 'openai-completions', baseURL: `${ORIGIN}/v1` })

      // Only the sealed form of the refresh token is stored, and the page never gets a secret.
      expect(fake.shell.seal).toHaveBeenCalledWith('ta_rt_1')
      expect(fake.record).toMatchObject({ version: 3, origin: ORIGIN, sealedRefreshToken: 'sealed:ta_rt_1', key: { id: '42' } })
      expect(JSON.stringify(fake.record)).not.toMatch(new RegExp(`"ta_rt_1"|ta_at_|${KEY}`))
      await vi.waitFor(async () => { expect((await account.snapshot()).balance?.available).toBe('19.500000') })
      // With the balance comes how the account shows money: its preference and the day's yuan rate.
      await vi.waitFor(async () => { expect((await account.snapshot()).money).toEqual({ localCurrency: true, cnyRate: 7.1 }) })
      const snapshot = await account.snapshot()
      expect(snapshot.account).toMatchObject({ displayName: 'Ada', email: 'ada@example.com', keyPrefix: KEY.slice(0, 11) })
      expect(snapshot.models?.map(model => model.id)).toContain('claude-sonnet-5-5')
      expect(JSON.stringify(snapshot)).not.toMatch(new RegExp(`ta_at_|ta_rt_|${KEY}`))

      await account.signOut()
      expect(server.revoked).toEqual(['ta_rt_1'])
      expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
      expect(fake.providers).toEqual({})
      expect(fake.record).toBeUndefined()
      expect((await account.snapshot()).account).toBeUndefined()
    } finally {
      account.dispose()
    }
  })

  it('refuses a response from another Tokens Anywhere without redeeming anything', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server, 'code=the-code&iss=https%3A%2F%2Fevil.example')
      expect((await account.snapshot()).attempt).toMatchObject({ phase: 'failed', error: { code: 'rejected' } })
      expect(server.calls).toEqual([])
      expect(fake.credentials.set).not.toHaveBeenCalled()
    } finally {
      account.dispose()
    }
  })

  it('says so when the user cancels at Tokens Anywhere, and keeps nothing', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server, 'error=access_denied')
      expect((await account.snapshot()).attempt).toMatchObject({ phase: 'cancelled', error: { code: 'denied' } })
      expect(fake.shell.closeLogin).toHaveBeenCalledWith(false)
      expect(server.calls).toEqual([])
    } finally {
      account.dispose()
    }
  })

  it('cancels a waiting sign-in when its window closes, and shows the window again when asked', async () => {
    fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      const first = await account.begin()
      const again = await account.begin()
      expect(again.id).toBe(first.id)
      expect(fake.shell.openLogin).toHaveBeenCalledTimes(2)
      account.windowClosed()
      expect((await account.snapshot()).attempt?.phase).toBe('cancelled')
      const next = await account.begin()
      expect(next.id).not.toBe(first.id)
    } finally {
      account.dispose()
    }
  })

  it('starts a sign-in from the link only when there is no working account', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      account.linkOpened()
      await vi.waitFor(() => { expect(fake.shell.openLogin).toHaveBeenCalledOnce() })
      await signIn(account, server)
      expect((await account.snapshot()).account).toBeDefined()
      fake.shell.openLogin.mockClear()
      account.linkOpened()
      await account.snapshot()
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(fake.shell.openLogin).not.toHaveBeenCalled()
    } finally {
      account.dispose()
    }
  })

  it('reports a refused code and revokes a grant it could not finish setting up', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server, 'code=wrong-code')
      expect((await account.snapshot()).attempt).toMatchObject({ phase: 'failed', error: { code: 'session-ended', detail: 'bad code' } })
      expect(fake.credentials.set).not.toHaveBeenCalled()
      expect(fake.settings.mutate).not.toHaveBeenCalled()

      // No model to offer: the grant goes, with nothing left behind.
      server.models = { chat: [], anthropic: [] }
      await signIn(account, server)
      expect((await account.snapshot()).attempt).toMatchObject({ phase: 'failed', error: { code: 'no-models' } })
      await vi.waitFor(() => { expect(server.revoked).toEqual(['ta_rt_1']) })
      expect(fake.credentials.set).not.toHaveBeenCalled()
      expect(fake.record).toBeUndefined()
      expect(fake.providers).toEqual({})
    } finally {
      account.dispose()
    }
  })

  it('rotates the refresh token as one at a time, resealing it each time', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server)
      await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
      // Tokens Anywhere refuses the access token: concurrent calls share one refresh.
      server.access.clear()
      const results = await Promise.all([
        account.usage(new URLSearchParams({ days: '7' })),
        account.usage(new URLSearchParams({ days: '30' })),
      ])
      expect(server.refreshed).toBe(1)
      expect(fake.record).toMatchObject({ sealedRefreshToken: 'sealed:ta_rt_2' })
      expect(results[0].days).toBe(7)
      expect(results[0].dates).toHaveLength(7)
      expect(summarizeAnywhereUsage(results[0]).totals).toMatchObject({ requests: 3, amount: '0.000250' })
      expect(results[1].days).toBe(30)
      expect(server.usageQueries[0]?.has('keyId')).toBe(false)
      expect(server.usageQueries[0]?.get('groupBy')).toBe('model')
    } finally {
      account.dispose()
    }
  })

  it('signs itself out when the grant has ended, and tells the user why', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server)
      await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
      server.access.clear()
      server.refreshError = 'invalid_grant'
      await expect(account.usage(new URLSearchParams())).rejects.toMatchObject({ code: 'session-ended' })
      await vi.waitFor(() => { expect(fake.record).toBeUndefined() })
      expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
      expect(fake.providers).toEqual({})
      const snapshot = await account.snapshot()
      expect(snapshot.account).toBeUndefined()
      expect(snapshot.notice).toEqual({ code: 'session-ended' })
    } finally {
      account.dispose()
    }
  })

  it('stays signed in through a network failure', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server)
      await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
      server.access.clear()
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
      await expect(account.usage(new URLSearchParams())).rejects.toMatchObject({ code: 'network' })
      expect(fake.record).toBeDefined()
      expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(KEY)
      expect(fake.providers).not.toEqual({})
    } finally {
      account.dispose()
    }
  })

  it('picks a stored account up on start, following a key rotated elsewhere', async () => {
    const server = fakeTokens()
    const fake = services()
    const first = newAccount(fake)
    await signIn(first, server)
    await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
    first.dispose()
    fake.settings.mutate.mockClear()

    server.keySecret = 'sk-secret-rotated'
    server.models = { chat: ['deepseek-v4-pro'], anthropic: [] }
    const second = newAccount(fake)
    try {
      await second.start()
      expect(fake.shell.open).toHaveBeenCalledWith('sealed:ta_rt_1')
      await vi.waitFor(() => { expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe('sk-secret-rotated') })
    } finally {
      second.dispose()
    }
  })

  it('has the balance ready after start, before any page asks for it', async () => {
    const server = fakeTokens()
    const fake = services()
    const first = newAccount(fake)
    await signIn(first, server)
    await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
    first.dispose()

    server.calls.length = 0
    const second = newAccount(fake)
    try {
      await second.start()
      await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
      await vi.waitFor(async () => { expect((await second.snapshot()).balance?.available).toBe('19.500000') })
      // The key check and the balance share one refresh.
      expect(server.refreshed).toBe(1)
    } finally {
      second.dispose()
    }
  })

  it('waits for the stored refresh token before deciding the session has ended', async () => {
    const server = fakeTokens()
    const fake = services()
    const first = newAccount(fake)
    await signIn(first, server)
    await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
    first.dispose()

    // The OS credential store may be waiting for the user while the page already asks.
    let open = (): void => {}
    fake.shell.open.mockImplementationOnce((value: string) => new Promise<string | undefined>((resolve) => {
      open = () => { resolve(value.replace(/^sealed:/, '')) }
    }))
    const second = newAccount(fake)
    try {
      const started = second.start()
      await vi.waitFor(() => { expect(fake.shell.open).toHaveBeenCalledTimes(1) })
      expect((await second.snapshot()).account?.sessionEnded).toBeUndefined()
      open()
      await started
      await vi.waitFor(async () => { expect((await second.snapshot()).balance?.available).toBe('19.500000') })
      expect((await second.snapshot()).account?.sessionEnded).toBeUndefined()
      expect(server.refreshed).toBe(1)
    } finally {
      second.dispose()
    }
  })

  it('keeps the models working without a usable refresh token, and asks for a new sign-in', async () => {
    const server = fakeTokens()
    const fake = services()
    const first = newAccount(fake)
    await signIn(first, server)
    await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
    first.dispose()

    fake.shell.open.mockResolvedValue(undefined)
    const second = newAccount(fake)
    try {
      await second.start()
      const snapshot = await second.snapshot()
      expect(snapshot.account?.sessionEnded).toBe(true)
      expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(KEY)
      expect(fake.providers).not.toEqual({})
      await expect(second.usage(new URLSearchParams())).rejects.toMatchObject({ code: 'session-ended' })
    } finally {
      second.dispose()
    }
  })

  it('keeps the refresh token in memory where the OS store is unavailable, and says so', async () => {
    const server = fakeTokens()
    const fake = services()
    fake.shell.seal.mockResolvedValue(undefined)
    const account = newAccount(fake)
    try {
      await signIn(account, server)
      expect(fake.record).not.toHaveProperty('sealedRefreshToken')
      expect(JSON.stringify(fake.record)).not.toContain('ta_rt_')
      const snapshot = await account.snapshot()
      expect(snapshot.account?.memoryOnly).toBe(true)
      await vi.waitFor(() => { expect(server.calls).toContain('GET /api/v1/balance') })
      server.access.clear()
      await account.usage(new URLSearchParams())
      expect(server.refreshed).toBe(1)
    } finally {
      account.dispose()
    }
  })

  it('writes a Gemini route for what the key lists as Gemini, and removes it on sign-out', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      server.models = { chat: ['deepseek-v4-pro'], anthropic: ['claude-sonnet-5-5'], gemini: ['gemini-3.5-flash'] }
      await signIn(account, server)
      expect(fake.providers['tokens-anywhere-gemini']).toMatchObject({ api: 'google-generative-ai', baseURL: `${ORIGIN}/v1beta`, apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high' })
      const snapshot = await account.snapshot()
      expect(snapshot.models?.find(model => model.id === 'gemini-3.5-flash')).toMatchObject({ route: 'tokens-anywhere-gemini', enabled: true })
      expect(snapshot.offered).toContainEqual({ route: 'tokens-anywhere-gemini', id: 'gemini-3.5-flash', name: 'gemini-3.5-flash', thinking: ['minimal', 'low', 'medium', 'high'] })
      await account.signOut()
      expect(fake.providers).toEqual({})
    } finally {
      account.dispose()
    }
  })

  it('writes neither settings nor credentials when a sync finds the same list', async () => {
    const server = fakeTokens()
    const fake = services()
    const account = newAccount(fake)
    try {
      await signIn(account, server)
      fake.settings.mutate.mockClear()
      fake.credentials.modifyRecord.mockClear()
      await account.sync()
      expect(fake.settings.mutate).not.toHaveBeenCalled()
      expect(fake.credentials.modifyRecord).not.toHaveBeenCalled()

      // A model Tokens Anywhere adds is written, once.
      server.models = { ...server.models, chat: [...server.models.chat, 'mystery-model'] }
      await account.sync()
      expect(fake.settings.mutate).toHaveBeenCalledTimes(1)
      expect(fake.credentials.modifyRecord).toHaveBeenCalledTimes(1)
    } finally {
      account.dispose()
    }
  })

  describe('model switches and names', () => {
    /** The Chat Completions models: DeepSeek's route, then GPT's. */
    const chatModels = (fake: ReturnType<typeof services>) => ['tokens-anywhere-deepseek', 'tokens-anywhere-gpt']
      .flatMap(route => (fake.providers[route] as { models: { id: string; name: string }[] } | undefined)?.models ?? [])

    it('applies them to the routes and keeps them for the next sign-in', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await account.changeModel({ id: 'deepseek-v4-pro', name: '  Pro  ' })
        expect(chatModels(fake).find(model => model.id === 'deepseek-v4-pro')?.name).toBe('Pro')

        await account.changeModel({ id: 'deepseek-v4-pro', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['gpt-6-sol'])
        const snapshot = await account.snapshot()
        expect(snapshot.models?.find(model => model.id === 'deepseek-v4-pro')).toMatchObject({ enabled: false, name: 'Pro', defaultName: 'deepseek-v4-pro' })
        expect(snapshot.offered?.map(model => model.id)).not.toContain('deepseek-v4-pro')

        // Reading the list again is no edit: the routes still follow it, with the switches.
        await account.sync()
        expect(await account.snapshot()).toMatchObject({ custom: false, customEdited: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['gpt-6-sol'])

        await expect(account.changeModel({ id: 'no-such-model', enabled: false })).rejects.toMatchObject({ code: 'unknown-model' })

        await account.resetModels()
        expect((await account.snapshot()).models?.find(model => model.id === 'deepseek-v4-pro')).toMatchObject({ enabled: true, name: 'deepseek-v4-pro' })
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro', 'gpt-6-sol'])

        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        await account.signOut()
        await signIn(account, server)
        expect((await account.snapshot()).models?.find(model => model.id === 'gpt-6-sol')?.enabled).toBe(false)
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro'])
      } finally {
        account.dispose()
      }
    })

    it('switches a whole family, and keeps models added to it later off', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      const enabled = async () => Object.fromEntries(((await account.snapshot()).models ?? []).map(model => [model.id, model.enabled]))
      const claudeModels = () => (fake.providers['tokens-anywhere-claude'] as { models: { id: string }[] } | undefined)?.models.map(model => model.id)
      try {
        await signIn(account, server)
        await account.changeModel({ family: 'claude', enabled: false })
        expect(claudeModels()).toBeUndefined()
        expect(await enabled()).toMatchObject({ 'claude-sonnet-5-5': false, 'deepseek-v4-pro': true, 'gpt-6-sol': true })

        // A model Tokens Anywhere adds to a family that is off stays off.
        server.models = { ...server.models, anthropic: ['claude-sonnet-5-5', 'claude-haiku-4-5', 'deepseek-v4-pro'] }
        await account.sync()
        expect(await enabled()).toMatchObject({ 'claude-sonnet-5-5': false, 'claude-haiku-4-5': false })
        expect(claudeModels()).toBeUndefined()

        // One model of it back on leaves the rest of the family off.
        await account.changeModel({ id: 'claude-haiku-4-5', enabled: true })
        expect(await enabled()).toMatchObject({ 'claude-sonnet-5-5': false, 'claude-haiku-4-5': true })
        expect(claudeModels()).toEqual(['claude-haiku-4-5'])

        await account.changeModel({ family: 'claude', enabled: true })
        expect(claudeModels()).toEqual(['claude-haiku-4-5', 'claude-sonnet-5-5'])

        await account.changeModel({ family: 'claude', enabled: false })
        await account.changeModel({ family: 'gpt', enabled: false })
        await expect(account.changeModel({ family: 'grok', enabled: false })).rejects.toMatchObject({ code: 'unknown-model' })
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro'])
      } finally {
        account.dispose()
      }
    })

    it('lets every model go off: the routes go, and the account stays signed in', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        server.models = { chat: ['deepseek-v4-pro', 'gpt-6-sol'], anthropic: [] }
        await signIn(account, server)
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        await account.changeModel({ id: 'deepseek-v4-pro', enabled: false })
        expect(fake.providers).toEqual({})
        expect(await account.snapshot()).toMatchObject({ account: { email: expect.any(String) }, offered: [] })

        // Reading the list again, or signing in again, keeps them off and is no failure.
        await account.sync()
        expect(fake.providers).toEqual({})
        await account.signOut()
        await signIn(account, server)
        expect((await account.snapshot()).attempt).toMatchObject({ phase: 'succeeded' })
        expect(fake.providers).toEqual({})

        await account.changeModel({ id: 'gpt-6-sol', enabled: true })
        expect(chatModels(fake).map(model => model.id)).toEqual(['gpt-6-sol'])
      } finally {
        account.dispose()
      }
    })

    it('leave custom routes alone until custom configuration is off', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await account.setCustom({ enabled: true })
        await fake.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'tokens-anywhere-deepseek', 'models'], value: [{ id: 'hand-made', name: 'Hand made' }] }])
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['hand-made', 'gpt-6-sol'])

        await account.setCustom({ enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro'])
      } finally {
        account.dispose()
      }
    })

    it('never overwrite an edit made in Settings → Models: it turns custom configuration on', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await fake.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'tokens-anywhere-deepseek', 'models'], value: [{ id: 'hand-made', name: 'Hand made' }] }])
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['hand-made', 'gpt-6-sol'])
        expect((await account.snapshot()).custom).toBe(true)
      } finally {
        account.dispose()
      }
    })
  })

  describe('custom configuration', () => {
    /** What the official model editor does on save: one write to a route's models. */
    const officialSave = (fake: ReturnType<typeof services>, route: string, models: unknown[]) =>
      fake.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', route, 'models'], value: models }])
    const chatRoute = (fake: ReturnType<typeof services>) => fake.providers['tokens-anywhere-deepseek'] as { reasoning?: string; models: { id: string; name: string }[] }

    it('follows Tokens Anywhere until it is on, then leaves the routes alone until it is off', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        expect((await account.snapshot()).custom).toBe(false)
        server.models = { chat: ['deepseek-v4-pro'], anthropic: ['claude-sonnet-5-5'] }
        await account.sync()
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['deepseek-v4-pro'])

        await account.setCustom({ enabled: true })
        let snapshot = await account.snapshot()
        expect(snapshot).toMatchObject({ custom: true, customEdited: false })

        await officialSave(fake, 'tokens-anywhere-deepseek', [{ id: 'deepseek-v4-pro', name: 'Mine', reasoningEfforts: { high: 'high' } }, { id: 'extra', name: 'Extra', reasoningEfforts: { high: 'high' } }])
        await account.setCustom({ enabled: true })
        server.models = { chat: ['deepseek-v4-pro', 'gpt-6-sol'], anthropic: ['claude-sonnet-5-5'] }
        await account.sync()
        expect(chatRoute(fake).models.map(model => model.name)).toEqual(['Mine', 'Extra'])
        snapshot = await account.snapshot()
        expect(snapshot).toMatchObject({ custom: true, customEdited: true })
        expect(snapshot.offered?.filter(model => model.route === 'tokens-anywhere-deepseek').map(model => model.id)).toEqual(['deepseek-v4-pro', 'extra'])
        // The list is still read, for the official reset and for going back.
        expect(snapshot.models?.map(model => model.id)).toContain('gpt-6-sol')

        await account.setCustom({ enabled: false })
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['deepseek-v4-pro'])
        expect((fake.providers['tokens-anywhere-gpt'] as { models: { id: string }[] }).models.map(model => model.id)).toEqual(['gpt-6-sol'])
        snapshot = await account.snapshot()
        expect(snapshot).toMatchObject({ custom: false, customEdited: false })
      } finally {
        account.dispose()
      }
    })

    it('keeps edited routes working: the route default follows them', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await account.setCustom({ enabled: true })

        // A model that does not think would fail its requests under a route default of high.
        await officialSave(fake, 'tokens-anywhere-deepseek', [{ id: 'deepseek-v4-pro', name: 'Pro', reasoningEfforts: { low: 'low', max: 'max' } }, { id: 'plain', name: 'Plain' }])
        await account.setCustom({ enabled: true })
        expect(chatRoute(fake).reasoning).toBeUndefined()
      } finally {
        account.dispose()
      }
    })

    it('never overwrites an edit made in Settings → Models: it turns custom configuration on', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        // Reading the list again is no edit.
        await account.sync()
        expect((await account.snapshot()).custom).toBe(false)

        await officialSave(fake, 'tokens-anywhere-deepseek', [{ id: 'hand-made', name: 'Hand made' }])
        await account.sync()
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['hand-made'])
        expect((await account.snapshot()).custom).toBe(true)
      } finally {
        account.dispose()
      }
    })

    it('needs the list to go back, and sign-out forgets it all', async () => {
      const server = fakeTokens()
      const fake = services()
      const first = newAccount(fake)
      await signIn(first, server)
      await first.setCustom({ enabled: true })
      await officialSave(fake, 'tokens-anywhere-deepseek', [{ id: 'hand-made', name: 'Hand made' }])
      first.dispose()

      // Nothing was read yet in this run, so there is no list to go back to.
      const second = newAccount(fake)
      try {
        await expect(second.setCustom({ enabled: false })).rejects.toMatchObject({ code: 'no-catalog' })
        expect((await second.snapshot()).custom).toBe(true)
        await second.start()
        await second.sync()
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['hand-made'])

        await second.signOut()
        expect(fake.providers).toEqual({})
        await signIn(second, server)
        expect((await second.snapshot()).custom).toBe(false)
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['deepseek-v4-pro'])
      } finally {
        second.dispose()
      }
    })
  })

  describe('local files', () => {
    it('takes the models out but keeps the key, then the key too, and brings both back', async () => {
      const server = fakeTokens()
      const fake = services()
      const { state, files } = localFiles()
      const account = newAccount(fake, files)
      try {
        await signIn(account, server)
        await account.setLocal({ writeModels: false })
        expect(state).toEqual({ storeKey: true, writeModels: false })
        expect(fake.providers).toEqual({})
        expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(KEY)
        expect((await account.snapshot()).local).toEqual({ storeKey: true, writeModels: false, writable: true, revealFiles: false })

        await account.setLocal({ storeKey: false })
        expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
        // A sync still reads the list, with the key Tokens Anywhere hands out, and writes nothing.
        await account.sync()
        expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
        expect(fake.providers).toEqual({})
        expect((await account.snapshot()).models?.map(model => model.id)).toContain('gpt-6-sol')
        await expect(account.copyKey()).resolves.toEqual({ secret: KEY })

        // The models need the key: switching them on keeps it again.
        await account.setLocal({ writeModels: true })
        expect(state).toEqual({ storeKey: true, writeModels: true })
        expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(KEY)
        expect(Object.keys(fake.providers).sort()).toEqual(['tokens-anywhere-claude', 'tokens-anywhere-deepseek', 'tokens-anywhere-gpt'])
      } finally {
        account.dispose()
      }
    })

    it('signs in without writing either file while both are off', async () => {
      const server = fakeTokens()
      const fake = services()
      const { files } = localFiles({ storeKey: false, writeModels: false })
      const account = newAccount(fake, files)
      try {
        await signIn(account, server)
        expect((await account.snapshot()).attempt?.phase).toBe('succeeded')
        expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
        expect(fake.providers).toEqual({})
      } finally {
        account.dispose()
      }
    })

    it('copies the key and rotates it; the routes read the new one from the credentials document', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await expect(account.copyKey()).resolves.toEqual({ secret: KEY })
        await account.rotateKey()
        expect(server.keySecret).not.toBe(KEY)
        expect(fake.refs.get(ANYWHERE_API_KEY_REF)).toBe(server.keySecret)
        expect((await account.snapshot()).account?.keyPrefix).toBe(server.keySecret.slice(0, 11))
        await expect(account.copyKey()).resolves.toEqual({ secret: server.keySecret })
        expect(fake.providers['tokens-anywhere-deepseek']).toMatchObject({ apiKeyEnv: ANYWHERE_API_KEY_REF })
      } finally {
        account.dispose()
      }
    })
  })
})

describe('Open configuration file', () => {
  it('runs the official settings controller, as the Settings dialog does', async () => {
    const controller = { openSettingsDocument: vi.fn(async (_signal: AbortSignal) => ({ opened: true as const })) }
    await openProfileConfiguration({ get: (name: string) => name === 'settingsController' ? controller : undefined } as unknown as Context)
    expect(controller.openSettingsDocument).toHaveBeenCalledOnce()
    expect(controller.openSettingsDocument.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  it('fails plainly without the controller or when no editor opens the document', async () => {
    await expect(openProfileConfiguration({ get: () => undefined } as unknown as Context)).rejects.toMatchObject({ code: 'failed' })
    const refused = { openSettingsDocument: vi.fn(async (_signal: AbortSignal) => { throw new Error('no text editor') }) }
    await expect(openProfileConfiguration({ get: () => refused } as unknown as Context)).rejects.toMatchObject({ code: 'failed' })
  })
})
