import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { NATIVE_ACCESS_HEADER } from '../src/desktop-contract.ts'
import { classifyPlatformLoginRequest, forwardPlatformLoginCallback } from '../src/platform-login-window.ts'

const HOST = 'http://127.0.0.1:43123'
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
  ['data:image/png;base64,AA==', 'image', 'allow'],
  ['data:text/html,hi', 'mainFrame', 'cancel'],
  ['file:///C:/Windows/System32/calc.exe', 'mainFrame', 'cancel'],
  ['not a url', 'mainFrame', 'cancel'],
])('classifies %s (%s) as %s', (url, type, decision) => {
  expect(classifyPlatformLoginRequest(url, type, HOST)).toBe(decision)
})

it('never treats a callback as the Host one while the Host is down', () => {
  expect(classifyPlatformLoginRequest(`${HOST}/oauth/callback?code=c&state=s`, 'mainFrame', undefined)).toBe('cancel')
})

async function host(status: number): Promise<{ url: string; seen: { url?: string; headers?: IncomingHttpHeaders } }> {
  const seen: { url?: string; headers?: IncomingHttpHeaders } = {}
  const server = createServer((request, response) => {
    seen.url = request.url
    seen.headers = request.headers
    response.writeHead(status, status === 302 ? { location: 'https://platform.deepseek.com/dsh/authorized' } : {}).end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?token=fixture`, seen }
}

it('replays the callback to the Host as the native renderer without following the completion redirect', async () => {
  const fixture = await host(302)
  const origin = new URL(fixture.url).origin
  const status = await forwardPlatformLoginCallback(`${origin}/oauth/callback?code=c&state=s#frag`,
    { url: fixture.url, cookie: 'dsh=session', token: 'native-token' })
  expect(status).toBe(302)
  expect(fixture.seen.url).toBe('/oauth/callback?code=c&state=s')
  expect(fixture.seen.headers?.[NATIVE_ACCESS_HEADER]).toBe('native-token')
  expect(fixture.seen.headers?.cookie).toBe('dsh=session')
})

it('reports a failed exchange status', async () => {
  const fixture = await host(204)
  const origin = new URL(fixture.url).origin
  expect(await forwardPlatformLoginCallback(`${origin}/oauth/callback?code=c&state=s`,
    { url: fixture.url, cookie: 'dsh=session', token: 'native-token' })).toBe(204)
})

it.each([
  ['http://127.0.0.1:1/oauth/callback?code=c&state=s', 'another origin'],
  [`${HOST}/api/account`, 'another route'],
])('refuses to replay %s (%s)', async (callback) => {
  let called = false
  await expect(forwardPlatformLoginCallback(callback, { url: `${HOST}/`, cookie: 'c', token: 't' },
    () => { called = true; return Promise.resolve(new Response(null)) })).rejects.toThrow('Not a Host sign-in callback')
  expect(called).toBe(false)
})
