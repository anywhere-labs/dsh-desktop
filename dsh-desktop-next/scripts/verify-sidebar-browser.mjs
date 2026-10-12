/** Real Electron guests against pages with anti-framing headers; Linux Xvfb only, never opens the user's desktop. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { DesktopBrowserGuests } from '../lib/browser-guests.js'

if (process.platform !== 'linux' || !process.env.DISPLAY) {
  console.error('Run this native Browser check on Linux under xvfb-run; portable checks do not start Electron.')
  app.exit(1)
} else { void verify() }

async function verify() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-browser-'))
  app.setPath('userData', home)
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html')
    if (request.url === '/embed') {
      response.end('<iframe src="/first"></iframe>')
      return
    }
    response.setHeader('content-security-policy', "default-src 'self'; frame-ancestors 'none'; script-src 'unsafe-inline'")
    response.setHeader('x-frame-options', 'DENY')
    response.end(`<title>${request.url}</title><p id="native-proof">Loaded native page</p><a href="/second">Second</a>`)
  })
  let window
  let code = 0
  const deadline = setTimeout(() => { console.error('Native Browser check timed out'); app.exit(1) }, 45_000)
  try {
    await app.whenReady()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    // The Host origin is withheld from guests; this fixture deliberately is not it.
    const guests = new DesktopBrowserGuests(() => [`http://127.0.0.1:${server.address().port + 1}`])
    window = new BrowserWindow({ show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true } })
    guests.bind(window)
    await window.webContents.session.cookies.set({ url: origin, name: 'app-secret', value: 'app-only' })
    await window.loadURL(`${origin}/embed`)
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('iframe').contentDocument?.querySelector('#native-proof')?.textContent ?? null"), null,
      'The fixture must actually refuse iframe embedding')

    const first = guests.acquire(window.webContents, '/workspace/one')
    const attached = new Promise(resolve => { window.webContents.once('did-attach-webview', (_event, guest) => resolve(guest)) })
    await mountGuest(window, first)
    const contents = await attached
    await wait(() => contents.getURL().startsWith('about:blank#'))
    assert.equal(contents.getLastWebPreferences().webSecurity, true)
    assert.equal(contents.getLastWebPreferences().sandbox, true)
    assert.equal(contents.getLastWebPreferences().nodeIntegration, false)
    assert.equal(contents.getLastWebPreferences().webviewTag, false)
    await window.webContents.executeJavaScript(`document.querySelector('webview').loadURL(${JSON.stringify(`${origin}/first`)})`)
    await wait(() => contents.getURL() === `${origin}/first` && !contents.isLoading())
    assert.equal(await contents.executeJavaScript("document.querySelector('#native-proof').textContent"), 'Loaded native page',
      'A guest loads a top-level page that refuses iframe embedding')
    assert.deepEqual(await contents.executeJavaScript('[typeof window.desktopNext, typeof window.dshDesktop, typeof require, typeof process]'),
      ['undefined', 'undefined', 'undefined', 'undefined'])
    assert.equal((await contents.session.cookies.get({ url: origin })).some(cookie => cookie.name === 'app-secret'), false,
      'Guest storage is partitioned away from the application session')

    // A real click carries user activation; without it Chromium replaces the current history
    // entry instead of pushing one, so Back below would have nothing to return to.
    await contents.executeJavaScript("document.querySelector('a').click()", true)
    await wait(() => contents.getURL() === `${origin}/second` && contents.navigationHistory.canGoBack())
    contents.navigationHistory.goBack()
    await wait(() => contents.getURL() === `${origin}/first` && contents.navigationHistory.canGoForward())

    // A second Workspace gets its own storage account; the same one is reused.
    const sameWorkspace = guests.acquire(window.webContents, '/workspace/one')
    const otherWorkspace = guests.acquire(window.webContents, '/workspace/two')
    assert.equal(sameWorkspace.partition, first.partition)
    assert.notEqual(otherWorkspace.partition, first.partition)

    // Only the issued lease and partition may attach; a forged pair is refused.
    const forged = await window.webContents.executeJavaScript(`new Promise(resolve => {
      const element = document.createElement('webview')
      element.setAttribute('partition', ${JSON.stringify(first.partition)})
      element.setAttribute('src', 'about:blank#forged-lease')
      element.addEventListener('dom-ready', () => resolve('attached'))
      document.body.append(element)
      setTimeout(() => resolve('refused'), 1500)
    })`)
    assert.equal(forged, 'refused', 'An unissued lease must never attach a guest')

    const destroyed = new Promise(resolve => { contents.once('destroyed', resolve) })
    await guests.release(window.webContents, first.lease)
    await destroyed
    assert.equal(contents.isDestroyed(), true)
    console.log('Native sidebar Browser passed: lease-gated attachment, forged leases refused, fixed guest preferences, partitioned storage, top-level load of an anti-framing page, native history and release teardown.')
  } catch (error) {
    code = 1; console.error(error)
  } finally {
    clearTimeout(deadline)
    window?.destroy()
    await new Promise(resolve => server.close(resolve))
    rmSync(home, { recursive: true, force: true })
    app.exit(code)
  }
}

/** Attach one approved guest exactly the way the official presentation builds its tag. */
async function mountGuest(window, reservation) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.createElement('webview')
    element.setAttribute('partition', ${JSON.stringify(reservation.partition)})
    element.setAttribute('allowpopups', '')
    element.setAttribute('src', 'about:blank#' + ${JSON.stringify(reservation.lease)})
    element.style.width = '400px'
    element.style.height = '300px'
    document.body.append(element)
  })()`)
}

async function wait(condition) {
  const end = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() >= end) throw new Error('Native Browser state did not settle')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
