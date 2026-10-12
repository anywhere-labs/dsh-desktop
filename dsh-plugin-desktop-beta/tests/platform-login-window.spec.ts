import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { DESKTOP_RENDERER_ACCESS_HEADER } from '../src/desktop-browser-access.ts'
import {
  classifyPlatformLoginRequest,
  forwardPlatformLoginCallback,
  platformLoginUrl,
} from '../src/platform-login-window.ts'

const HOST = 'http://127.0.0.1:43123'
const HEADER = { name: DESKTOP_RENDERER_ACCESS_HEADER, value: 'renderer-token' }
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

it.each([
  [`${HOST}/oauth/callback?code=c&state=s`, 'mainFrame', 'callback'],
  [`${HOST}/oauth/callback?code=c&state=s`, 'subFrame', 'cancel'],
  [`${HOST}/oauth/callback?code=c&state=s`, 'xhr', 'cancel'],
  [`${HOST}/api/account`, 'mainFrame', 'cancel'],
  [`${HOST}/api/account`, 'xhr', 'cancel'],
  ['http://localhost:43123/oauth/callback?code=c&state=s', 'mainFrame', 'cancel'],
  ['http://127.0.0.1:9222/json', 'xhr', 'cancel'],
  ['https://127.0.0.2/', 'image', 'cancel'],
  ['https://[::1]/', 'mainFrame', 'cancel'],
  ['https://platform.deepseek.com/dsh/authorize?state=s', 'mainFrame', 'allow'],
  ['https://static.deepseek.com/app.js', 'script', 'allow'],
  ['https://user:pass@platform.deepseek.com/', 'mainFrame', 'cancel'],
  ['http://platform.deepseek.com/', 'mainFrame', 'cancel'],
  ['wss://platform.deepseek.com/socket', 'webSocket', 'allow'],
  ['wss://platform.deepseek.com/socket', 'mainFrame', 'cancel'],
  ['data:image/png;base64,AA==', 'image', 'allow'],
  ['data:text/html,hi', 'mainFrame', 'cancel'],
  ['file:///C:/Windows/System32/calc.exe', 'mainFrame', 'cancel'],
  ['not a url', 'mainFrame', 'cancel'],
])('classifies %s (%s) as %s', (url, type, decision) => {
  expect(classifyPlatformLoginRequest(url, type, HOST)).toBe(decision)
})

it('never treats a callback as the Host one while no shell is mounted', () => {
  expect(classifyPlatformLoginRequest(`${HOST}/oauth/callback?code=c&state=s`, 'mainFrame', undefined)).toBe('cancel')
})

async function host(status: number): Promise<{ origin: string; seen: { url?: string | undefined; headers?: IncomingHttpHeaders } }> {
  const seen: { url?: string | undefined; headers?: IncomingHttpHeaders } = {}
  const server = createServer((request, response) => {
    seen.url = request.url
    seen.headers = request.headers
    response.writeHead(status, status === 302 ? { location: 'https://platform.deepseek.com/dsh/authorized' } : {}).end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, seen }
}

it('replays the callback to the Host as the renderer without following the completion redirect', async () => {
  const fixture = await host(302)
  const status = await forwardPlatformLoginCallback(`${fixture.origin}/oauth/callback?code=c&state=s#frag`,
    { origin: fixture.origin, cookie: 'dsh=session', header: HEADER })
  expect(status).toBe(302)
  expect(fixture.seen.url).toBe('/oauth/callback?code=c&state=s')
  expect(fixture.seen.headers?.[DESKTOP_RENDERER_ACCESS_HEADER]).toBe('renderer-token')
  expect(fixture.seen.headers?.cookie).toBe('dsh=session')
})

it('reports a failed exchange status and omits an empty cookie', async () => {
  const fixture = await host(204)
  expect(await forwardPlatformLoginCallback(`${fixture.origin}/oauth/callback?code=c&state=s`,
    { origin: fixture.origin, cookie: '', header: HEADER })).toBe(204)
  expect(fixture.seen.headers?.cookie).toBeUndefined()
})

it.each([
  ['http://127.0.0.1:1/oauth/callback?code=c&state=s', 'another origin'],
  [`${HOST}/api/account`, 'another route'],
])('refuses to replay %s (%s)', async (callback) => {
  let called = false
  await expect(forwardPlatformLoginCallback(callback, { origin: HOST, cookie: 'c', header: HEADER },
    () => { called = true; return Promise.resolve(new Response(null)) })).rejects.toThrow('not a Host sign-in callback')
  expect(called).toBe(false)
})

it('carries the effective palette into the sign-in page', () => {
  expect(platformLoginUrl('https://platform.deepseek.com/dsh/authorize?state=s&theme=light', true))
    .toBe('https://platform.deepseek.com/dsh/authorize?state=s&theme=dark')
  expect(platformLoginUrl('https://platform.deepseek.com/dsh/authorize?state=s', false))
    .toBe('https://platform.deepseek.com/dsh/authorize?state=s&theme=light')
})
