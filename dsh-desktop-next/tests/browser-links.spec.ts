import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { DesktopLanHttpsRuntime } from '../src/lan-https-runtime.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'next-browser-links-'))
  const runtime = new NextDesktopRuntime({ home, root: home, executable: process.execPath, addresses: () => [],
    certificate: async () => { throw new Error('No native certificate access in this test') },
    onFailure() {}, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
  })
  cleanup.push(async () => { await runtime.close(); rmSync(home, { force: true, recursive: true }) })
  const phase = vi.spyOn(runtime.backend, 'state', 'get').mockReturnValue({ phase: 'ready' })
  runtime.auth = { url: 'http://127.0.0.1:1234/?token=browser-login', cookie: 'session=private-cookie', token: 'native-capability', injections: [] }
  runtime.preferences.browserAccess = true
  runtime.preferences.networkExposure = 'lan'
  runtime.lan = new DesktopLanHttpsRuntime({ addresses: ['192.168.1.20', '10.0.0.20'] })
  vi.spyOn(runtime.lan, 'snapshot').mockReturnValue({ state: 'ready', addresses: ['192.168.1.20', '10.0.0.20'], actualPort: 5678, caFingerprint: null, errorCode: null })
  return { runtime, phase }
}

it('issues a distinct login URL for each LAN address while keeping general state credential-free', () => {
  const { runtime } = fixture()
  const links = runtime.browserLinks()
  expect(links).toEqual({ localUrl: 'http://127.0.0.1:1234/?token=browser-login', lanUrls: [
    'https://192.168.1.20:5678/?token=browser-login', 'https://10.0.0.20:5678/?token=browser-login',
  ] })
  for (const url of [links.localUrl!, ...links.lanUrls]) expect(runtime.resolveBrowserLink(url)).toBe(url)
  expect(runtime.browserLink(true)).toBe(links.lanUrls[0])
  for (const invalid of [undefined, '', 'https://untrusted.test/?token=browser-login', links.lanUrls[1] + '&extra=true']) {
    expect(() => runtime.resolveBrowserLink(invalid)).toThrow('unavailable')
  }
  expect(JSON.stringify(runtime.state())).not.toMatch(/browser-login|private-cookie|native-capability/)
})

it('rejects stale, disabled, unready and safe-mode login links', () => {
  const { runtime, phase } = fixture()
  const old = runtime.browserLinks()
  runtime.auth!.url = 'http://127.0.0.1:1234/?token=rotated-login'
  expect(() => runtime.resolveBrowserLink(old.localUrl)).toThrow('unavailable')
  runtime.preferences.networkExposure = 'loopback'
  expect(runtime.browserLinks().lanUrls).toEqual([])
  expect(() => runtime.resolveBrowserLink(old.lanUrls[1])).toThrow('unavailable')
  const hidden = { localUrl: null, lanUrls: [] }
  runtime.preferences.browserAccess = false
  expect(runtime.browserLinks()).toEqual(hidden)
  runtime.preferences.browserAccess = true
  runtime.safeMode = true
  expect(runtime.browserLinks()).toEqual(hidden)
  runtime.safeMode = false
  phase.mockReturnValue({ phase: 'starting' })
  expect(runtime.browserLinks()).toEqual(hidden)
})
