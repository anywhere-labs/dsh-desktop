/** Real shell-owned Host/recovery/network lifecycle, without Electron windows or user data. */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as requestHttp } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextDesktopRuntime } from '../lib/desktop-runtime.js'
import { forwardWebRequest } from '../lib/web-document.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'dsh-next-native-runtime-'))
let failures = 0
const runtime = new NextDesktopRuntime({ root, home, executable: process.execPath, addresses: () => [],
  certificate: async () => { throw new Error('This test must not request system key storage or expose a LAN listener') },
  onFailure: () => failures++, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
})
async function upgrade(origin, headers = {}, keep = false) {
  return new Promise((resolve, reject) => {
    const request = requestHttp(new URL('/api/remote.mux', origin), { headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': Buffer.alloc(16, 1).toString('base64'), ...headers,
    } })
    request.setTimeout(5000, () => request.destroy(new Error('WebSocket gate test timed out')))
    request.on('response', response => { response.resume(); resolve(response.statusCode) })
    request.on('upgrade', (response, socket) => { socket.on('error', () => {}); if (keep) { socket.resume(); resolve(socket) } else { socket.destroy(); resolve(response.statusCode) } })
    request.on('error', reject)
    request.end()
  })
}
try {
  runtime.initialize()
  runtime.safeMode = true
  assert.throws(() => runtime.terminalTarget(), /not ready/, 'A pending safe runtime must never fall back to the original Profile')
  runtime.safeMode = false
  assert.equal(runtime.selected, 'desktop', 'Fresh installations must select the Desktop Profile')
  runtime.profiles.ensure('desktop')
  runtime.profiles.setFeatures('desktop', { market: false, remoteControl: false })
  await runtime.start()
  assert.equal(runtime.state().phase, 'ready')
  assert.ok(runtime.state().checkpoint)
  const first = runtime.auth
  const response = await fetch(new URL(first.url).origin)
  assert.equal(response.status, 403, 'Desktop-only access denies ordinary browsers even on loopback')
  await response.body?.cancel()
  const cookieBypass = await fetch(new URL(first.url).origin, { headers: { cookie: first.cookie } })
  assert.equal(cookieBypass.status, 403, 'A browser cookie alone must not bypass disabled browser access')
  await cookieBypass.body?.cancel()
  const nativeRequest = new Request('dsh-app://app/api/no-such-route', { headers: { 'x-dsh-desktop-renderer': first.token } })
  const native = await forwardWebRequest(nativeRequest, first.url, first.cookie, first.token)
  assert.notEqual(native.status, 403, 'Authenticated Desktop forwarding passes the native gate')
  await native.body?.cancel()
  assert.equal(await upgrade(new URL(first.url).origin, { cookie: first.cookie }), 403, 'Disabled browser access also fences WebSocket upgrades')
  assert.equal(await upgrade(new URL(first.url).origin, { cookie: first.cookie, 'x-dsh-desktop-renderer': first.token }), 101, 'The native capability and cookie permit the real Gateway stream')
  assert.throws(() => runtime.browserLink(), /unavailable/)
  assert.deepEqual(runtime.browserLinks(), { localUrl: null, lanUrls: [] })
  const nativeStream = await upgrade(new URL(first.url).origin, { cookie: first.cookie, 'x-dsh-desktop-renderer': first.token }, true)
  await runtime.applyPreferences({ ...runtime.preferences, browserAccess: true })
  assert.equal(runtime.auth, first, 'Browser toggles retain the existing Host and its capability')
  const unauthenticated = await fetch(new URL(first.url).origin)
  assert.equal(unauthenticated.status, 401, 'A fresh browser cannot open the bare URL without a token or session cookie')
  await unauthenticated.body?.cancel()
  const links = runtime.browserLinks()
  assert.equal(links.localUrl, runtime.browserLink())
  assert.ok(new URL(links.localUrl).searchParams.get('token'))
  const login = await fetch(runtime.resolveBrowserLink(links.localUrl), { redirect: 'manual' })
  assert.equal(login.status, 303, 'Enabled browser access exchanges the login token through the real Host')
  // dsh 0.1.7 redirects the token exchange to the directory-relative `./` so a mounted
  // Host keeps its prefix (`packages/client/connection/src/browser-auth.ts:256`).
  assert.equal(login.headers.get('location'), './')
  const browserCookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(browserCookie)
  await login.body?.cancel()
  const authenticated = await fetch(new URL(first.url).origin, { headers: { cookie: browserCookie } })
  assert.equal(authenticated.status, 200, 'The issued cookie authenticates the clean URL after the redirect')
  await authenticated.body?.cancel()
  const browserStream = await upgrade(new URL(first.url).origin, { cookie: first.cookie }, true)
  const browserClosed = new Promise(resolve => browserStream.once('close', resolve))
  await runtime.applyPreferences({ ...runtime.preferences, browserAccess: false, networkExposure: 'loopback' })
  let closeTimer
  try { await Promise.race([browserClosed, new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('Browser stream was not revoked')), 5000) })]) }
  finally { clearTimeout(closeTimer); browserStream.destroy() }
  assert.equal(nativeStream.destroyed, false, 'Withdrawing browser access must retain the native stream')
  const denied = await fetch(new URL(first.url).origin, { headers: { cookie: first.cookie } })
  assert.equal(denied.status, 403)
  await denied.body?.cancel()
  assert.equal(await upgrade(new URL(first.url).origin, { cookie: first.cookie }), 403)
  assert.equal(runtime.state().browserUrl, null)
  assert.deepEqual(runtime.browserLinks(), { localUrl: null, lanUrls: [] })
  assert.throws(() => runtime.resolveBrowserLink(links.localUrl), /unavailable/)
  await runtime.applyPreferences({ ...runtime.preferences, browserAccess: true })
  assert.equal(runtime.auth, first)
  nativeStream.destroy()
  await runtime.restart()
  assert.notEqual(runtime.auth.token, first.token, 'An actual Host restart rotates the native capability')
  assert.equal(new URL(runtime.state().browserUrl).search, '')
  assert.equal(JSON.stringify(runtime.state()).includes(runtime.auth.token), false)
  assert.equal(JSON.stringify(runtime.state()).includes(new URL(runtime.auth.url).search), false)
  // A slow certificate bootstrap leaves a live Host with its captured boot
  // policy. A change made during startup must reach that Host after readiness.
  let certificateStarted
  let releaseCertificate
  const preparingCertificate = new Promise(resolve => { certificateStarted = resolve })
  const certificateGate = new Promise(resolve => { releaseCertificate = resolve })
  runtime.options.certificate = async () => { certificateStarted(); await certificateGate; throw new Error('Fixture certificate unavailable') }
  const starting = runtime.restart(() => runtime.writePreferences({ ...runtime.preferences, browserAccess: true, networkExposure: 'lan' }))
  await preparingCertificate
  let changedDuringStart = false
  const changeDuringStart = runtime.applyPreferences({ ...runtime.preferences, browserAccess: false, networkExposure: 'loopback' }).then(() => { changedDuringStart = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changedDuringStart, false, 'Changes made during startup wait for the captured Host policy')
  releaseCertificate()
  await Promise.all([starting, changeDuringStart])
  const afterStartup = await fetch(new URL(runtime.auth.url).origin, { headers: { cookie: runtime.auth.cookie } })
  assert.equal(afterStartup.status, 403, 'The running Host receives the preference saved while it was starting')
  await afterStartup.body?.cancel()
  const dir = runtime.profiles.directory('desktop')
  await runtime.backend.stop()
  writeFileSync(join(dir, 'package.json'), '{ broken manifest')
  await assert.rejects(runtime.start())
  assert.equal(runtime.state().phase, 'error')
  assert.ok(failures)
  await runtime.restart(() => { runtime.safeMode = true })
  assert.equal(runtime.state().phase, 'ready')
  assert.equal(runtime.state().safeMode, true)
  const safeHome = readdirSync(runtime.recovery.directory).find(name => name.startsWith('safe-runtime-'))
  assert.ok(safeHome)
  assert.ok(existsSync(join(runtime.recovery.directory, safeHome, 'profiles', 'desktop', 'package.json')),
    'Safe mode must use the same desktop Profile name in its isolated home')
  const safeTarget = runtime.terminalTarget()
  assert.deepEqual(safeTarget, { homeDir: join(runtime.recovery.directory, safeHome),
    profileDir: join(runtime.recovery.directory, safeHome, 'profiles', 'desktop'), profileName: 'desktop', mode: 'safe' })
  assert.deepEqual(runtime.terminalTarget(true), { homeDir: home, profileDir: dir, profileName: 'desktop', mode: 'recovery' })
  assert.equal(runtime.state().browserUrl, null)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{ broken manifest')
  assert.throws(() => runtime.browserLink(), /unavailable/)
  await runtime.restart(async () => { await runtime.profiles.recover('desktop'); runtime.safeMode = false })
  assert.equal(runtime.state().phase, 'ready')
  assert.equal(runtime.state().safeMode, false)
  assert.deepEqual(runtime.terminalTarget(), { homeDir: home, profileDir: dir, profileName: 'desktop', mode: 'normal' })
  assert.equal(existsSync(safeTarget.homeDir), false)
  assert.deepEqual(runtime.state().features, { remoteControl: false, market: false })
  // Broken global patches require their separate repair, never a silent reset.
  await runtime.backend.stop()
  writeFileSync(join(home, 'cordis.patch.yml'), '[broken: yaml')
  await assert.rejects(runtime.start())
  await runtime.restart(() => { runtime.recovery.repairGlobalPatch() })
  assert.equal(runtime.state().phase, 'ready')
  const auth = runtime.auth
  await runtime.close()
  await assert.rejects(fetch(new URL(auth.url).origin))
  console.log('Next Desktop runtime passed: native-only HTTP/WebSocket gate, hot browser enable/disable with existing browser-stream revocation and native-stream preservation, per-Host credentials, corrupt-manifest recovery, isolated safe mode, separate global repair, and full process shutdown.')
} finally {
  await runtime.close()
  rmSync(home, { recursive: true, force: true })
}
