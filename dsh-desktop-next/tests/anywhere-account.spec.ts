import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import {
  ANYWHERE_API_KEY_REF, ANYWHERE_ROUTE_IDS, TOKENS_ANYWHERE_ORIGIN, anywhereRoutes, beijingDates, commonThinkingLevel,
  offeredAnywhereModels, pickAnywhereDefaultModel, planAnywhereModels, stableJson, summarizeAnywhereUsage, tokensAnywhereOrigin,
} from '../src/anywhere-account.ts'
import { classifyAnywhereLoginRequest, deliverAnywhereCallback, isAnywhereLoginLink, isLocalSignIn } from '../src/anywhere-login.ts'
import { formatCount, formatTokenLimit, formatYuan, preferredThinking, usageTicks } from '../src/client/anywhere-shared.ts'
import { AnywhereAccount, LoopbackCallback, type CallbackResult } from '../src/host/anywhere-account.ts'
import { AnywhereShell } from '../src/host/anywhere-shell.ts'

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
  it('groups what the key can call by family, each on the route of its protocol', () => {
    const models = catalog()
    expect(models.map(model => [model.family, model.id])).toEqual([
      ['deepseek', 'deepseek-v4-pro'],
      ['claude', 'claude-haiku-4-5'], ['claude', 'claude-sonnet-5-5'],
      ['gpt', 'gpt-6-sol'],
      ['gemini', 'gemini-3.5-flash'],
      ['other', 'mystery-model'],
    ])
    const byId = new Map(models.map(model => [model.id, model]))
    expect(byId.get('deepseek-v4-pro')?.route).toBe(ANYWHERE_ROUTE_IDS.chat)
    expect(byId.get('claude-sonnet-5-5')).toMatchObject({ route: ANYWHERE_ROUTE_IDS.claude, name: 'Claude Sonnet 5.5', contextWindow: 1_000_000, maxTokens: 64000, vision: true })
    expect(byId.get('gpt-6-sol')?.route).toBe(ANYWHERE_ROUTE_IDS.chat)
    expect(byId.get('gemini-3.5-flash')?.route).toBe(ANYWHERE_ROUTE_IDS.gemini)
    expect(byId.get('mystery-model')).toMatchObject({ route: ANYWHERE_ROUTE_IDS.chat, thinking: [] })
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
    expect(routes[ANYWHERE_ROUTE_IDS.chat]?.models.map(model => [model.id, model.name])).toEqual([['deepseek-v4-pro', 'DS Pro'], ['mystery-model', 'mystery-model']])
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

  it('writes Chat Completions and Anthropic routes that think by default', () => {
    const routes = anywhereRoutes(catalog(['gpt-6-sol', 'deepseek-v4-pro']), 'https://tokens.example/')
    expect(routes[ANYWHERE_ROUTE_IDS.chat]).toMatchObject({
      api: 'openai-completions', baseURL: 'https://tokens.example/v1', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high',
    })
    expect(routes[ANYWHERE_ROUTE_IDS.claude]).toMatchObject({
      api: 'anthropic-messages', baseURL: 'https://tokens.example', apiKeyEnv: ANYWHERE_API_KEY_REF, reasoning: 'high',
    })
    const chat = new Map(routes[ANYWHERE_ROUTE_IDS.chat]?.models.map(model => [model.id, model]))
    expect(chat.get('deepseek-v4-pro')).toMatchObject({
      reasoningEfforts: { off: null, high: 'high', max: 'max' },
      compat: { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
    })
    expect(chat.get('gpt-6-sol')?.reasoningEfforts).toMatchObject({ off: 'none', high: 'high', xhigh: 'xhigh', max: 'max' })
    const claude = new Map(routes[ANYWHERE_ROUTE_IDS.claude]?.models.map(model => [model.id, model]))
    expect(claude.get('claude-sonnet-5-5')).toMatchObject({
      input: ['text', 'image'], compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    })
    expect(pickAnywhereDefaultModel(routes)).toEqual({ provider: ANYWHERE_ROUTE_IDS.chat, model: 'deepseek-v4-pro', reasoningEffort: 'high' })
    expect(pickAnywhereDefaultModel({})).toBeUndefined()
    // DeepSeek V4.1 Flash comes first wherever the key can call it.
    expect(pickAnywhereDefaultModel(anywhereRoutes(catalog(['deepseek-v4-pro', 'deepseek-flash']), 'https://tokens.example/')))
      .toEqual({ provider: ANYWHERE_ROUTE_IDS.chat, model: 'deepseek-flash', reasoningEffort: 'high' })
  })

  it('declares no route default that some model on the route lacks, and the default model still thinks', () => {
    const routes = anywhereRoutes(catalog(), 'https://tokens.example')
    // The unknown model does not think, so nothing is common to every model on the route.
    expect(routes[ANYWHERE_ROUTE_IDS.chat]?.reasoning).toBeUndefined()
    expect(new Map(routes[ANYWHERE_ROUTE_IDS.chat]?.models.map(model => [model.id, model])).get('mystery-model')?.reasoningEfforts).toBe(false)
    expect(pickAnywhereDefaultModel(routes)).toEqual({ provider: ANYWHERE_ROUTE_IDS.chat, model: 'deepseek-v4-pro', reasoningEffort: 'high' })
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
      row('2026-11-01', 'deepseek-v4-pro', '0.1000', 1),
      row('2026-11-01', 'claude-sonnet-5-5', '0.2000', 1),
      row('2026-11-02', 'claude-sonnet-5-5', '1.0003', 2),
      row('2026-10-01', 'old-model', '9.0000', 9),
    ] })
    expect(usage).toMatchObject({ days: 7, from: '2026-10-31', to: '2026-11-02' })
    expect(usage.totals).toEqual({ requests: 4, inputTokens: 30, outputTokens: 15, cacheTokens: 9, amount: '1.3003' })
    expect(usage.daily.map(day => [day.date, day.amount, day.requests])).toEqual([['2026-10-31', '0.0000', 0], ['2026-11-01', '0.3000', 2], ['2026-11-02', '1.0003', 2]])
    // Each day's spend per model, for the stacked chart.
    expect(usage.daily.map(day => day.byModel)).toEqual([{}, { 'deepseek-v4-pro': '0.1000', 'claude-sonnet-5-5': '0.2000' }, { 'claude-sonnet-5-5': '1.0003' }])
    expect(usage.models.map(model => [model.model, model.amount])).toEqual([['claude-sonnet-5-5', '1.2003'], ['deepseek-v4-pro', '0.1000']])
  })

  it('sums up one model alone, and rows without a model under no name', () => {
    const row = (date: string, model: string | null, amount: string) => ({
      date, model, requests: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, amountCharged: amount,
    })
    const read = { days: 7 as const, dates: ['2026-11-01', '2026-11-02'], rows: [
      row('2026-11-01', 'deepseek-v4-pro', '0.1000'),
      row('2026-11-01', 'claude-sonnet-5-5', '0.2000'),
      row('2026-11-02', null, '0.4000'),
    ] }
    const one = summarizeAnywhereUsage(read, 'claude-sonnet-5-5')
    expect(one.totals).toMatchObject({ requests: 1, inputTokens: 10, amount: '0.2000' })
    expect(one.daily.map(day => [day.date, day.amount])).toEqual([['2026-11-01', '0.2000'], ['2026-11-02', '0.0000']])
    expect(one.models.map(model => model.model)).toEqual(['claude-sonnet-5-5'])
    expect(summarizeAnywhereUsage(read, '').totals.amount).toBe('0.4000')
    expect(summarizeAnywhereUsage(read, 'not-used').totals.requests).toBe(0)
    expect(summarizeAnywhereUsage(read).totals.amount).toBe('0.7000')
  })

  it('formats amounts, counts and limits for reading', () => {
    expect(formatYuan('12.3456', 'en')).toBe('¥12.35')
    expect(formatYuan('0.7000', 'zh')).toBe('¥0.70')
    expect(formatYuan('1234.0000', 'en')).toBe('¥1,234.00')
    expect(formatYuan('19.5', 'zh')).toBe('¥19.50')
    expect(formatYuan('0.9950', 'zh')).toBe('¥1.00')
    expect(formatYuan('0.0049', 'zh')).toBe('¥0.00')
    expect(formatYuan('-1.2345', 'en')).toBe('-¥1.23')
    expect(formatYuan('-0.0012', 'en')).toBe('¥0.00')
    expect(formatCount(1284, 'zh')).toBe('1,284')
    expect(formatCount(12900, 'en')).toBe('12.9K')
    expect(formatTokenLimit(1_000_000)).toBe('1M')
    expect(formatTokenLimit(64000)).toBe('64K')
  })

  it('picks clean axis ticks at any scale', () => {
    expect(usageTicks(0)).toEqual([0])
    expect(usageTicks(10)).toEqual([0, 5, 10])
    // Amounts show two decimals, so the axis never steps below a fen.
    expect(usageTicks(0.0053)).toEqual([0, 0.01])
    expect(usageTicks(0.2874)).toEqual([0, 0.1, 0.2, 0.3])
    expect(usageTicks(137)).toEqual([0, 50, 100, 150])
  })

  it('keeps thinking on when the default model changes', () => {
    expect(preferredThinking(['off', 'high', 'max'], 'max')).toBe('max')
    expect(preferredThinking(['off', 'high', 'max'], 'xhigh')).toBe('high')
    expect(preferredThinking(['off', 'high', 'max'], undefined)).toBe('high')
    expect(preferredThinking(['off', 'high', 'max'], 'off')).toBe('off')
    expect(preferredThinking(['low', 'max'], undefined)).toBe('max')
    expect(preferredThinking([], 'high')).toBeUndefined()
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

describe('sign-in window rules', () => {
  const CALLBACK = 'http://127.0.0.1:43123/oauth/callback'

  it.each([
    ['https://tokens-anywhere.com/oauth/authorize/?x=1', 'mainFrame', 'allow'],
    ['https://cdn.example/app.js', 'script', 'allow'],
    ['wss://tokens-anywhere.com/socket', 'webSocket', 'allow'],
    ['wss://tokens-anywhere.com/socket', 'mainFrame', 'cancel'],
    ['http://tokens-anywhere.com/', 'mainFrame', 'cancel'],
    [`${CALLBACK}?code=c&state=s&iss=https%3A%2F%2Ftokens-anywhere.com`, 'mainFrame', 'callback'],
    [`${CALLBACK}?code=c`, 'subFrame', 'cancel'],
    ['http://127.0.0.1:43123/other', 'mainFrame', 'cancel'],
    ['http://127.0.0.1:43124/oauth/callback', 'mainFrame', 'cancel'],
    ['http://localhost:8080/admin', 'xhr', 'cancel'],
    ['https://127.0.0.1:8443/', 'mainFrame', 'cancel'],
    ['https://user:pass@tokens-anywhere.com/', 'mainFrame', 'cancel'],
    ['file:///etc/passwd', 'mainFrame', 'cancel'],
    ['data:text/html,hello', 'mainFrame', 'cancel'],
    ['data:image/png;base64,AA', 'image', 'allow'],
  ])('%s as %s is %s', (url, type, decision) => {
    expect(classifyAnywhereLoginRequest(url, type, CALLBACK, false)).toBe(decision)
  })

  it('reaches loopback pages only for a Tokens Anywhere on this computer, and the callback is still intercepted', () => {
    expect(isLocalSignIn('http://localhost:5173/oauth/authorize/')).toBe(true)
    expect(isLocalSignIn('https://tokens-anywhere.com/oauth/authorize/')).toBe(false)
    expect(classifyAnywhereLoginRequest('http://127.0.0.1:5174/#/tokens-anywhere-oauth', 'mainFrame', CALLBACK, true)).toBe('allow')
    expect(classifyAnywhereLoginRequest('ws://localhost:5173/_next/webpack-hmr', 'webSocket', CALLBACK, true)).toBe('allow')
    expect(classifyAnywhereLoginRequest(`${CALLBACK}?code=c`, 'mainFrame', CALLBACK, true)).toBe('callback')
    expect(classifyAnywhereLoginRequest('http://192.168.1.2/', 'mainFrame', CALLBACK, true)).toBe('cancel')
  })

  it('delivers only the current attempt\'s callback, without following its redirect', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }))
    const url = `${CALLBACK}?code=c&state=s`
    await expect(deliverAnywhereCallback(url, CALLBACK, fetchImpl as never)).resolves.toBe(302)
    expect(String((fetchImpl.mock.calls as unknown as [URL, RequestInit][])[0]![0])).toBe(url)
    expect((fetchImpl.mock.calls as unknown as [URL, RequestInit][])[0]![1]).toMatchObject({ method: 'GET', redirect: 'manual' })
    await expect(deliverAnywhereCallback(url, undefined, fetchImpl as never)).rejects.toThrow('No Tokens Anywhere sign-in')
    await expect(deliverAnywhereCallback('http://127.0.0.1:43124/oauth/callback?code=c', CALLBACK, fetchImpl as never)).rejects.toThrow('Not the Tokens')
    await expect(deliverAnywhereCallback('https://evil.example/oauth/callback', CALLBACK, fetchImpl as never)).rejects.toThrow('Not the Tokens')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

it('treats only the bare sign-in link as a trigger', () => {
  expect(isAnywhereLoginLink('dsh://v1/tokens/login')).toBe(true)
  expect(isAnywhereLoginLink('dsh://v1/tokens/login/')).toBe(true)
  for (const refused of [
    'dsh://v1/tokens/login?code=attacker', 'dsh://v1/tokens/login#code=attacker', 'dsh://v1/tokens/login?state=s&token=t',
    'dsh://v1/tokens', 'dsh://open', 'https://tokens-anywhere.com/oauth/authorize/', '--dsh-recovery',
  ]) expect(isAnywhereLoginLink(refused)).toBe(false)
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

describe('shell bridge', () => {
  function connection() {
    const events = new EventEmitter()
    const sent: Record<string, unknown>[] = []
    return {
      sent, events,
      connected: true,
      on: (name: string, listener: (...args: unknown[]) => void) => { events.on(name, listener) },
      off: (name: string, listener: (...args: unknown[]) => void) => { events.off(name, listener) },
      send: (message: Record<string, unknown>, callback?: (error: Error | null) => void) => { sent.push(message); callback?.(null); return true },
    }
  }

  it('asks the shell to seal and open secrets, and treats no answer as unavailable', async () => {
    const link = connection()
    const closed = vi.fn()
    const requested = vi.fn()
    const shell = new AnywhereShell(link as never, closed, requested)
    const sealing = shell.seal('ta_rt_secret')
    expect(link.sent[0]).toMatchObject({ type: 'anywhere-secret', action: 'seal', value: 'ta_rt_secret' })
    link.events.emit('message', { type: 'anywhere-secret-result', requestId: link.sent[0]!.requestId, value: 'sealed' })
    await expect(sealing).resolves.toBe('sealed')
    const opening = shell.open('sealed')
    link.events.emit('message', { type: 'anywhere-secret-result', requestId: link.sent[1]!.requestId, error: 'Secure storage is unavailable' })
    await expect(opening).resolves.toBeUndefined()
    shell.openLogin('https://tokens.example/oauth/authorize/', 'http://127.0.0.1:43123/oauth/callback')
    shell.closeLogin(true)
    expect(link.sent.slice(2)).toEqual([
      { type: 'anywhere-login', action: 'open', url: 'https://tokens.example/oauth/authorize/', callback: 'http://127.0.0.1:43123/oauth/callback' },
      { type: 'anywhere-login', action: 'close', focus: true },
    ])
    link.events.emit('message', { type: 'anywhere-login-closed' })
    expect(closed).toHaveBeenCalledOnce()
    link.events.emit('message', { type: 'anywhere-login-requested' })
    expect(requested).toHaveBeenCalledOnce()
    shell.dispose()
    await expect(shell.seal('later')).resolves.toBeUndefined()
  })

  it('has nothing to seal with outside the shell', async () => {
    const shell = new AnywhereShell(undefined, () => {}, () => {})
    await expect(shell.seal('ta_rt_secret')).resolves.toBeUndefined()
    shell.openLogin('https://tokens.example/', 'http://127.0.0.1:43123/oauth/callback')
    shell.dispose()
  })
})

/** In-memory stand-ins for the Host services the account writes. */
function services() {
  const refs = new Map<string, string>()
  const records = new Map<string, { kind: 'grant'; payload: unknown }>()
  let providers: Record<string, unknown> = {}
  let selection: { provider: string; model: string; reasoningEffort?: string } = { provider: 'deepseek-official', model: 'deepseek-flash' }
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
  const defaults = {
    currentSelection: () => selection,
    saveSelection: vi.fn(async (next: typeof selection) => { selection = next }),
  }
  const shell = {
    openLogin: vi.fn(), closeLogin: vi.fn(),
    seal: vi.fn(async (value: string): Promise<string | undefined> => `sealed:${value}`),
    open: vi.fn(async (value: string): Promise<string | undefined> => value.replace(/^sealed:/, '')),
    dispose: vi.fn(),
  }
  return { credentials, settings, defaults, shell, refs, records, get providers() { return providers }, get record() { return records.get(credentialKey('anywhere-account', 'default') as string)?.payload as Record<string, unknown> | undefined } }
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
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!server.access.has(bearer)) return json({ error: { code: 'unauthenticated' } }, 401)
    if (path === '/api/v1/me') return json({ id: '7', displayName: 'Ada', email: 'ada@example.com', loginName: '' })
    if (path === '/api/v1/balance') return json({ balance: '20.0000', held: '0.5000', available: '19.5000' })
    if (path === '/api/v1/keys/managed') {
      expect(JSON.parse(String(init?.body))).toEqual({ app: 'dsh-next' })
      return json({ key: { id: '42', prefix: `${server.keySecret.slice(0, 11)}` }, secret: server.keySecret })
    }
    if (path === '/api/v1/usage/daily') {
      server.usageQueries.push(url.searchParams)
      return json({ items: [{ date: url.searchParams.get('to'), model: 'deepseek-v4-pro', requests: 3, inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, amountCharged: '0.1234' }] })
    }
    throw new Error(`unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return server
}

function newAccount(fake: ReturnType<typeof services>) {
  return new AnywhereAccount(fake.credentials as never, fake.settings as never, fake.defaults, fake.shell as never, ORIGIN)
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
      expect(Object.keys(fake.providers).sort()).toEqual(['tokens-anywhere', 'tokens-anywhere-claude'])
      // Thinking is on by default: the selection names a level and so does each route.
      expect(fake.defaults.saveSelection).toHaveBeenCalledWith({ provider: 'tokens-anywhere', model: 'deepseek-v4-pro', reasoningEffort: 'high' })
      expect(fake.providers['tokens-anywhere']).toMatchObject({ reasoning: 'high', api: 'openai-completions', baseURL: `${ORIGIN}/v1` })

      // Only the sealed form of the refresh token is stored, and the page never gets a secret.
      expect(fake.shell.seal).toHaveBeenCalledWith('ta_rt_1')
      expect(fake.record).toMatchObject({ version: 3, origin: ORIGIN, sealedRefreshToken: 'sealed:ta_rt_1', key: { id: '42' } })
      expect(JSON.stringify(fake.record)).not.toMatch(new RegExp(`"ta_rt_1"|ta_at_|${KEY}`))
      await vi.waitFor(async () => { expect((await account.snapshot()).balance?.available).toBe('19.5000') })
      const snapshot = await account.snapshot()
      expect(snapshot.account).toMatchObject({ displayName: 'Ada', email: 'ada@example.com', keyPrefix: KEY.slice(0, 11) })
      expect(snapshot.models?.map(model => model.id)).toContain('claude-sonnet-5-5')
      expect(snapshot.defaultModel).toEqual({ provider: 'tokens-anywhere', model: 'deepseek-v4-pro', reasoningEffort: 'high' })
      expect(JSON.stringify(snapshot)).not.toMatch(new RegExp(`ta_at_|ta_rt_|${KEY}`))

      await account.signOut()
      expect(server.revoked).toEqual(['ta_rt_1'])
      expect(fake.refs.has(ANYWHERE_API_KEY_REF)).toBe(false)
      expect(fake.providers).toEqual({})
      expect(fake.record).toBeUndefined()
      expect(fake.defaults.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
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
      expect(summarizeAnywhereUsage(results[0]).totals).toMatchObject({ requests: 3, amount: '0.1234' })
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
      expect(fake.defaults.currentSelection().provider).toBe('deepseek-official')
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
      await vi.waitFor(async () => { expect((await second.snapshot()).balance?.available).toBe('19.5000') })
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
      await vi.waitFor(async () => { expect((await second.snapshot()).balance?.available).toBe('19.5000') })
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
    const chatModels = (fake: ReturnType<typeof services>) => (fake.providers['tokens-anywhere'] as { models: { id: string; name: string }[] }).models

    it('applies them to the routes, moves a default that was switched off, and keeps them for the next sign-in', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        await account.changeModel({ id: 'deepseek-v4-pro', name: '  Pro  ' })
        expect(chatModels(fake).find(model => model.id === 'deepseek-v4-pro')?.name).toBe('Pro')

        await account.changeModel({ id: 'deepseek-v4-pro', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['gpt-6-sol'])
        expect(fake.defaults.currentSelection()).toEqual({ provider: 'tokens-anywhere-claude', model: 'claude-sonnet-5-5', reasoningEffort: 'high' })
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

    it('switches a whole family, keeps models added to it later off, and still keeps one model on', async () => {
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
        await expect(account.changeModel({ family: 'deepseek', enabled: false })).rejects.toMatchObject({ code: 'last-model' })
        await expect(account.changeModel({ family: 'grok', enabled: false })).rejects.toMatchObject({ code: 'unknown-model' })
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro'])
      } finally {
        account.dispose()
      }
    })

    it('keeps one model on, and sets aside switches the list has left with nothing on offer', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        server.models = { chat: ['deepseek-v4-pro', 'gpt-6-sol'], anthropic: [] }
        await signIn(account, server)
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        await expect(account.changeModel({ id: 'deepseek-v4-pro', enabled: false })).rejects.toMatchObject({ code: 'last-model' })
        expect(chatModels(fake).map(model => model.id)).toEqual(['deepseek-v4-pro'])

        server.models = { chat: ['gpt-6-sol'], anthropic: [] }
        await account.sync()
        expect(chatModels(fake).map(model => model.id)).toEqual(['gpt-6-sol'])
        expect(fake.defaults.currentSelection().model).toBe('gpt-6-sol')
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
        await fake.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'tokens-anywhere', 'models'], value: [{ id: 'hand-made', name: 'Hand made' }] }])
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['hand-made'])

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
        await fake.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'tokens-anywhere', 'models'], value: [{ id: 'hand-made', name: 'Hand made' }] }])
        await account.changeModel({ id: 'gpt-6-sol', enabled: false })
        expect(chatModels(fake).map(model => model.id)).toEqual(['hand-made'])
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
    const chatRoute = (fake: ReturnType<typeof services>) => fake.providers['tokens-anywhere'] as { reasoning?: string; models: { id: string; name: string }[] }

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

        await officialSave(fake, 'tokens-anywhere', [{ id: 'deepseek-v4-pro', name: 'Mine', reasoningEfforts: { high: 'high' } }, { id: 'extra', name: 'Extra', reasoningEfforts: { high: 'high' } }])
        await account.setCustom({ enabled: true })
        server.models = { chat: ['deepseek-v4-pro', 'gpt-6-sol'], anthropic: ['claude-sonnet-5-5'] }
        await account.sync()
        expect(chatRoute(fake).models.map(model => model.name)).toEqual(['Mine', 'Extra'])
        snapshot = await account.snapshot()
        expect(snapshot).toMatchObject({ custom: true, customEdited: true })
        expect(snapshot.offered?.filter(model => model.route === 'tokens-anywhere').map(model => model.id)).toEqual(['deepseek-v4-pro', 'extra'])
        // The list is still read, for the official reset and for going back.
        expect(snapshot.models?.map(model => model.id)).toContain('gpt-6-sol')

        await account.setCustom({ enabled: false })
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['deepseek-v4-pro', 'gpt-6-sol'])
        snapshot = await account.snapshot()
        expect(snapshot).toMatchObject({ custom: false, customEdited: false })
      } finally {
        account.dispose()
      }
    })

    it('keeps edited routes working: the route default and the default model follow them', async () => {
      const server = fakeTokens()
      const fake = services()
      const account = newAccount(fake)
      try {
        await signIn(account, server)
        expect(fake.defaults.currentSelection()).toEqual({ provider: 'tokens-anywhere', model: 'deepseek-v4-pro', reasoningEffort: 'high' })
        await account.setCustom({ enabled: true })

        // A model that does not think would fail its requests under a route default of high.
        await officialSave(fake, 'tokens-anywhere', [{ id: 'deepseek-v4-pro', name: 'Pro', reasoningEfforts: { low: 'low', max: 'max' } }, { id: 'plain', name: 'Plain' }])
        await account.setCustom({ enabled: true })
        expect(chatRoute(fake).reasoning).toBeUndefined()
        // The default keeps its model, at a level it still has.
        expect(fake.defaults.currentSelection()).toEqual({ provider: 'tokens-anywhere', model: 'deepseek-v4-pro', reasoningEffort: 'max' })

        // Its model gone, the default moves to the best one left, still thinking.
        await officialSave(fake, 'tokens-anywhere', [{ id: 'plain', name: 'Plain' }])
        await account.setCustom({ enabled: true })
        expect(fake.defaults.currentSelection()).toEqual({ provider: 'tokens-anywhere-claude', model: 'claude-sonnet-5-5', reasoningEffort: 'high' })

        await expect(account.setDefaultModel({ provider: 'tokens-anywhere', model: 'deepseek-v4-pro' })).rejects.toMatchObject({ code: 'unknown-model' })
        await expect(account.setDefaultModel({ provider: 'tokens-anywhere-claude', model: 'claude-sonnet-5-5', reasoningEffort: 'off' })).rejects.toMatchObject({ code: 'unsupported-thinking' })
        await account.setDefaultModel({ provider: 'tokens-anywhere-claude', model: 'claude-sonnet-5-5', reasoningEffort: 'max' })
        expect(fake.defaults.currentSelection().reasoningEffort).toBe('max')
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

        await officialSave(fake, 'tokens-anywhere', [{ id: 'hand-made', name: 'Hand made' }])
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
      await officialSave(fake, 'tokens-anywhere', [{ id: 'hand-made', name: 'Hand made' }])
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
        expect(chatRoute(fake).models.map(model => model.id)).toEqual(['deepseek-v4-pro', 'gpt-6-sol'])
      } finally {
        second.dispose()
      }
    })
  })
})
