/** Real Chromium -> Electron protocol -> native-only Host, run under Linux Xvfb in CI. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, protocol, session } from 'electron'
import { NextDesktopRuntime } from '../lib/desktop-runtime.js'
import { appRequestHeaders, forwardWebRequest } from '../lib/web-document.js'

if (process.platform !== 'linux' || !process.env.DISPLAY) {
  console.error('Run this native protocol check on Linux under xvfb-run; use check:next for portable headless checks.')
  app.exit(1)
} else {
  // Electron emits ready after evaluating its ESM entry; do not await it at module scope.
  void verify()
}

async function verify() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const home = mkdtempSync(join(tmpdir(), 'dsh-next-protocol-'))
  app.setPath('userData', home)
  protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
  } }])
  const runtime = new NextDesktopRuntime({ root, home, executable: process.execPath, addresses: () => [],
    certificate: async () => { throw new Error('Protocol checks must not expose a LAN listener') },
    onFailure() {}, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
  })
  let window
  let exitCode = 0
  const observed = []
  let stage = 'Electron ready'
  const deadline = setTimeout(() => { console.error(`Native protocol check timed out: ${stage}`); app.exit(1) }, 60_000)
  try {
    await app.whenReady()
    stage = 'Host startup'
    runtime.initialize()
    runtime.profiles.ensure('desktop')
    runtime.profiles.setFeatures('desktop', { market: true, remoteControl: false })
    await runtime.start()
    const { url, cookie, token } = runtime.auth
    const browser = await fetch(new URL(url).origin, { headers: { cookie } })
    assert.equal(browser.status, 403, 'The test must keep ordinary browser access disabled')
    await browser.body?.cancel()
    protocol.handle('dsh-app', async request => {
      if (new URL(request.url).pathname === '/') return new Response('<!doctype html><title>Next protocol fixture</title>', {
        headers: { 'content-type': 'text/html' },
      })
      const response = await forwardWebRequest(request, url, cookie, token)
      observed.push({ origin: request.headers.get('origin'), marked: request.headers.get('x-dsh-desktop-renderer') === token, status: response.status })
      return response
    })
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ requestHeaders: appRequestHeaders(details, window?.webContents, token) })
    })
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
    stage = 'renderer load'
    await window.loadURL('dsh-app://app/')
    const call = async (path, body) => {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const response = await fetch(${JSON.stringify(`/api/community-market/${path}`)}, {
          method: ${JSON.stringify(body === undefined ? 'GET' : 'POST')}, referrerPolicy: 'no-referrer',
          headers: { 'content-type': 'application/json' },
          ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
        });
        return { status: response.status, body: await response.text() };
      })()`)
      assert.equal(result.status, 200, result.body)
      return JSON.parse(result.body)
    }
    stage = 'native Market requests'
    const state = await call('state')
    const key = state.builtIns[0].key
    const added = await call('sources', { action: 'add-builtin', key })
    const sourceRecordId = added.sources.find(source => source.builtInProviderKey === key).sourceRecordId
    const selected = await call('sources', { action: 'select', sourceRecordId })
    assert.equal(selected.sources.find(source => source.sourceRecordId === sourceRecordId)?.enabled, true)
    const removed = await call('sources', { action: 'remove', sourceRecordId })
    assert.equal(removed.sources.some(source => source.sourceRecordId === sourceRecordId), false)
    assert.ok(observed.every(request => request.marked))
    console.log('Native protocol request metadata:', JSON.stringify(observed))

    // Same protocol, different origin; an opaque response must not cause a mutation.
    stage = 'foreign page rejection'
    await window.loadURL('dsh-app://shell/')
    const before = observed.length
    await window.webContents.executeJavaScript(`fetch('dsh-app://app/api/community-market/sources', {
      method: 'POST', mode: 'no-cors', referrerPolicy: 'no-referrer',
      body: ${JSON.stringify(JSON.stringify({ action: 'add-builtin', key }))},
    }).catch(() => {})`)
    assert.equal(observed.length, before + 1)
    assert.equal(observed.at(-1).marked, false)
    assert.equal(observed.at(-1).status, 403)
    await window.loadURL('dsh-app://app/')
    assert.equal((await call('state')).sources.some(source => source.builtInProviderKey === key), false)
    console.log('Next native protocol check passed: renderer source mutations, owned-frame markers and foreign-page rejection.')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    clearTimeout(deadline)
    window?.destroy()
    await runtime.close()
    rmSync(home, { recursive: true, force: true })
    app.exit(exitCode)
  }
}
