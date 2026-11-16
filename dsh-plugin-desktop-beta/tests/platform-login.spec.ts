import { expect, it } from 'vitest'
import { watchPlatformLogin, type PlatformLoginAccount, type PlatformLoginRequest } from '../src/host/platform-login.ts'

type Attempt = { id: string; phase: string; authorizeUrl?: string } | null

function account(states: Attempt[]): PlatformLoginAccount & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  return {
    signals,
    async *watch(signal) {
      signals.push(signal)
      for (const attempt of states) yield { attempt }
    },
  }
}

async function requests(states: Attempt[]): Promise<PlatformLoginRequest[]> {
  const seen: PlatformLoginRequest[] = []
  await watchPlatformLogin(account(states), request => seen.push(request), new AbortController().signal)
  return seen
}

const URL_A = 'https://platform.deepseek.com/dsh/authorize?state=a'

it('opens the authorization page once per attempt, only after the Host has the URL', async () => {
  expect(await requests([
    null,
    { id: 'a', phase: 'initializing' },
    { id: 'a', phase: 'waiting-browser', authorizeUrl: URL_A },
    { id: 'a', phase: 'waiting-browser', authorizeUrl: URL_A },
    { id: 'a', phase: 'exchanging', authorizeUrl: URL_A },
    { id: 'a', phase: 'committing' },
    { id: 'a', phase: 'succeeded' },
    { id: 'a', phase: 'succeeded' },
  ])).toEqual([{ action: 'open', url: URL_A }, { action: 'close', focus: false }])
})

it('opens a retried attempt again after closing the cancelled one', async () => {
  const urlB = 'https://platform.deepseek.com/dsh/authorize?state=b'
  expect(await requests([
    { id: 'a', phase: 'waiting-browser', authorizeUrl: URL_A },
    { id: 'a', phase: 'cancelled' },
    { id: 'b', phase: 'waiting-browser', authorizeUrl: urlB },
  ])).toEqual([{ action: 'open', url: URL_A }, { action: 'close', focus: false }, { action: 'open', url: urlB }])
})

it.each(['failed', 'expired'])('returns focus to the app once when an attempt is %s', async (phase) => {
  expect(await requests([
    { id: 'a', phase: 'waiting-browser', authorizeUrl: URL_A },
    { id: 'a', phase },
    { id: 'a', phase },
  ])).toEqual([{ action: 'open', url: URL_A }, { action: 'close', focus: true }])
})

it('passes its lifetime to the account stream', async () => {
  const source = account([])
  const lifetime = new AbortController()
  await watchPlatformLogin(source, () => {}, lifetime.signal)
  expect(source.signals).toEqual([lifetime.signal])
})


it('opens and closes login using rc.2 snapshot and credentials-changed envelopes', async () => {
  const seen: PlatformLoginRequest[] = []
  const source: PlatformLoginAccount = { async *watch() {
    yield { type: 'snapshot', state: { attempt: null } }
    yield { type: 'snapshot', state: { attempt: { id: 'rc2', phase: 'waiting-browser', authorizeUrl: URL_A } } }
    yield { type: 'credentials-changed', state: { attempt: { id: 'rc2', phase: 'succeeded' } } }
  } }
  await watchPlatformLogin(source, value => seen.push(value), new AbortController().signal)
  expect(seen).toEqual([{ action: 'open', url: URL_A }, { action: 'close', focus: false }])
})
