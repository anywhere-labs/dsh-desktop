/** Exercise the session strip in the actual official frontend and Loader, in a temporary home, against a scripted model. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { DesktopHostProcess } from '../lib/host-process.js'
import { NextProfiles } from '../lib/profiles.js'
import { authenticateWebHost, serveWebDocument } from '../lib/web-document.js'

const REPLY = '模拟回复'
/** An OpenAI-compatible endpoint that answers every request with one short reply. */
const model = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model', owned_by: 'test' }] }))
      return
    }
    let stream = false
    try { stream = JSON.parse(body).stream === true } catch { /* not JSON */ }
    if (!stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = value => { response.write(`data: ${JSON.stringify(value)}\n\n`) }
    send({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: null }] })
    send({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    response.end('data: [DONE]\n\n')
  })
})
await new Promise(resolve => { model.listen(0, '127.0.0.1', resolve) })
const modelPort = model.address().port

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
const home = mkdtempSync(join(tmpdir(), 'dsh-session-tabs-'))
const profiles = new NextProfiles(home)
profiles.ensure('desktop')
profiles.setFeatures('desktop', { market: false, remoteControl: false })
writeFileSync(join(profiles.directory('desktop'), 'cordis.patch.yml'), JSON.stringify([
  { id: 'ui-settings-account', config: { step: 'done', completion: 'skipped' } },
  { id: 'llm-pi-ai', config: { providers: { mock: {
    apiKeyEnv: 'DSH_SESSION_TABS_MOCK_KEY', api: 'openai-completions', baseURL: `http://127.0.0.1:${String(modelPort)}/v1`, models: [{ id: 'mock' }],
  } } } },
  { id: 'agent-default-model', config: { provider: 'mock', model: 'mock' } },
]), { mode: 0o600 })
const host = new DesktopHostProcess(process.execPath, root, profiles.directory('desktop'), undefined,
  { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_SESSION_TABS_MOCK_KEY: 'test' }, undefined, undefined, undefined, join(root, 'lib/host.js'))
const screenshots = join(root, '.desktop-next/verification')
mkdirSync(screenshots, { recursive: true })
const windows = process.argv.includes('--windows')
let browser, page
const errors = []
try {
  const ready = await host.start()
  const origin = new URL(ready.url).origin
  const cookie = await authenticateWebHost(ready.url), separator = cookie.indexOf('=')
  const document = await (await serveWebDocument(new Request('dsh-app://app/'), webRoot)).text()
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_NEXT_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_NEXT_TEST_BROWSER_CHANNEL } : {}) })
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, locale: 'zh-CN', colorScheme: 'light' })
  await context.grantPermissions(['local-network-access'], { origin })
  await context.addCookies([{ url: origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }])
  await context.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: document }))
  await context.exposeFunction('__boot', async () => ({ injections: await host.collectInjections(), streamBaseUrl: origin }))
  await context.exposeFunction('__bootFailed', message => { errors.push(message) })
  await context.addInitScript(windowsCaption => {
    globalThis.dshDesktop = { protocolVersion: 1 }
    globalThis.dshDesktopBoot = { ready: () => globalThis.__boot(), failed: message => globalThis.__bootFailed(message) }
    globalThis.dshDesktopSetup = { read: () => ({ required: false, accountPending: false, edition: 'next', profile: 'desktop', computerUse: false, input: {} }), dismissAccount: () => {} }
    // The Windows preload marks the caption row before the client mounts; this stands in for it.
    if (windowsCaption) {
      const mark = () => { document.documentElement.dataset.windowsTitlebar = ''; document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px') }
      if (document.documentElement) mark()
      else document.addEventListener('readystatechange', mark, { once: true })
    }
  }, windows)
  // A key probe registered before any app listener, so a failure says whether a shortcut arrived and who took it.
  await context.addInitScript(() => {
    globalThis.__keys = []
    window.addEventListener('keydown', event => {
      if (!event.altKey) return
      const record = { code: event.code, alt: event.altKey, shift: event.shiftKey, target: `${event.target?.tagName}.${event.target?.className}`,
        dialogs: document.querySelectorAll('[role=dialog][aria-modal=true],[role=alertdialog]').length }
      globalThis.__keys.push(record)
      // Read once dispatch is over: a microtask would run before the app's own listeners.
      setTimeout(() => { record.prevented = event.defaultPrevented }, 0)
    }, true)
  })
  page = await context.newPage(); page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  page.on('console', message => { if (message.type() === 'error' && /session-tabs|dshNextTabs|single slot/i.test(message.text())) errors.push(message.text()) })
  await page.goto(origin)
  const strip = page.locator('[data-next-session-tabs]')
  const tabs = strip.locator('[role=tab]')
  const tabCount = () => page.evaluate(() => document.querySelectorAll('[data-next-session-tabs] [role=tab]').length)
  const waitTabs = n => page.waitForFunction(count => document.querySelectorAll('[data-next-session-tabs] [role=tab]').length === count, n)
  /**
   * Send one message in the visible Session and wait for the scripted reply, then for the Host to stop listing the
   * Session as blank (its tab takes the projected title). Until then New Session reuses that very Session: upstream
   * navigation opens the first reusable blank of the Workspace, so a New Session right after sending would be a no-op.
   */
  const converse = async text => {
    const composer = page.locator('[contenteditable=true], textarea').last()
    await composer.click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await page.getByText(REPLY).last().waitFor()
    await page.waitForFunction(() => {
      const label = document.querySelector('[data-next-session-tabs] [role=tab][aria-selected=true] .dshNextTabLabel')
      return label !== null && label.textContent !== '新会话'
    })
  }
  await page.getByRole('button', { name: /^(插件|Plugins)$/ }).waitFor()
  await strip.waitFor()
  assert.equal(await strip.getAttribute('data-seat'), windows ? 'titlebar' : 'header')
  // The blank Session shown at boot has a tab, titled as the sidebar calls it.
  await waitTabs(1)
  assert.match(await tabs.first().innerText(), /新会话/)
  // Three real Sessions: the first in place, two more through the button and Alt+Shift+N.
  await converse('第一个会话')
  await strip.getByRole('button', { name: '新建会话标签' }).click()
  await waitTabs(2)
  await converse('第二个会话')
  await page.keyboard.press('Alt+Shift+N')
  await waitTabs(3)
  await converse('第三个会话')
  assert.equal(await tabCount(), 3)
  assert.equal(await strip.locator('[role=tab][aria-selected=true]').count(), 1)
  await page.screenshot({ path: join(screenshots, `session-tabs-${windows ? 'titlebar' : 'header'}.png`) })
  // Alt+Shift+1 jumps to the first tab, Alt+Shift+→ steps to the next.
  const ids = await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')))
  const [firstId, secondId, lastId] = ids
  await page.locator('body').click({ position: { x: 640, y: 600 } })
  await page.keyboard.press('Alt+Shift+1')
  await strip.locator(`[data-tab-id="${firstId}"][aria-selected=true]`).waitFor()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await strip.locator(`[data-tab-id="${secondId}"][aria-selected=true]`).waitFor()
  // Pin through the menu: the tab moves into the pinned group, a divider follows it.
  const menu = page.locator('[data-next-session-tabs-menu]')
  await strip.locator(`[data-tab-id="${lastId}"]`).click({ button: 'right' })
  await menu.waitFor()
  await menu.getByRole('menuitem', { name: '固定标签' }).click()
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await tabs.nth(0).getAttribute('data-tab-id'), lastId)
  assert.equal(await tabs.nth(0).getAttribute('data-pinned'), 'true')
  assert.equal(await strip.locator('.dshNextTabsDivider').count(), 1)
  // Drag the second unpinned tab before the first unpinned one.
  await strip.locator(`[data-tab-id="${secondId}"]`).dragTo(strip.locator(`[data-tab-id="${firstId}"]`), { targetPosition: { x: 4, y: 8 } })
  assert.deepEqual(await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id'))), [lastId, secondId, firstId])
  // Rename with F2: the Session's own title changes and survives the list refresh.
  await strip.locator(`[data-tab-id="${firstId}"]`).focus()
  await page.keyboard.press('F2')
  const input = strip.locator('.dshNextTabInput')
  await input.waitFor()
  await input.fill('标签改名验证')
  await page.keyboard.press('Enter')
  await strip.locator(`[data-tab-id="${firstId}"] .dshNextTabLabel`, { hasText: '标签改名验证' }).waitFor()
  await page.getByText('标签改名验证').first().waitFor()
  // Close with Alt+Shift+W, reopen with Alt+Shift+T.
  await strip.locator(`[data-tab-id="${firstId}"]`).click()
  await strip.locator(`[data-tab-id="${firstId}"][aria-selected=true]`).waitFor()
  await page.locator('body').click({ position: { x: 640, y: 600 } })
  await page.keyboard.press('Alt+Shift+W')
  await waitTabs(2)
  assert.equal(await strip.locator(`[data-tab-id="${firstId}"]`).count(), 0)
  await page.keyboard.press('Alt+Shift+T')
  await strip.locator(`[data-tab-id="${firstId}"][aria-selected=true]`).waitFor()
  // Close others spares the pinned tab.
  await strip.locator(`[data-tab-id="${firstId}"]`).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '关闭其他标签' }).click()
  await waitTabs(2)
  assert.equal(await strip.locator(`[data-tab-id="${lastId}"]`).count(), 1)
  // A reload returns to the same strip.
  const remembered = await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')))
  await page.reload()
  await strip.waitFor()
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-next-session-tabs] [role=tab]')].map(node => node.getAttribute('data-tab-id'))) === JSON.stringify(expected), remembered)
  if (windows) {
    // A height preset rewrites the caption height the preload set.
    await strip.locator(`[data-tab-id="${firstId}"]`).click({ button: 'right' })
    await menu.waitFor()
    await menu.getByRole('menuitemradio', { name: '宽松' }).click()
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height').trim() === '44px')
    // Swapping moves the strip below the header and restores the native caption.
    await strip.getByRole('button', { name: '切换标签栏位置' }).click()
    await page.locator('[data-next-session-tabs][data-seat=header]').waitFor()
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height').trim() === '40px')
    await page.screenshot({ path: join(screenshots, 'session-tabs-header-from-titlebar.png') })
  }
  // While dsh-multi-session runs, its stylesheet is in <head>: this strip steps aside.
  await page.evaluate(() => { const style = document.createElement('style'); style.dataset.dshMultiSession = ''; document.head.append(style) })
  await page.locator('[data-next-session-tabs]').waitFor({ state: 'detached' })
  await page.evaluate(() => { document.querySelector('style[data-dsh-multi-session]')?.remove() })
  await page.locator('[data-next-session-tabs]').waitFor()
  assert.deepEqual(errors, [])
  console.log(`Session tabs passed in the official frontend (${windows ? 'Windows title bar' : 'below the header'}) against a scripted model: a tab for the boot Session titled as new, three real Sessions through the button and Alt+Shift+N, Alt+Shift+1 and Alt+Shift+→, pin through the menu, drag to reorder, F2 rename of the Session title, Alt+Shift+W and Alt+Shift+T, close others sparing the pinned tab, reload restore${windows ? ', caption height preset and placement swap' : ''}, and yielding to dsh-multi-session.`)
} catch (error) {
  console.error(errors)
  if (page) {
    await page.screenshot({ path: join(screenshots, 'session-tabs-failure.png') }).catch(() => {})
    console.error('modal-like nodes:', await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal]')]
      .map(node => `${node.tagName} role=${node.getAttribute('role')} modal=${node.getAttribute('aria-modal')} visible=${String(node.checkVisibility?.() ?? 'n/a')} ${node.outerHTML.slice(0, 160)}`)).catch(() => []))
    console.error('active element:', await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.className}`).catch(() => ''))
    console.error('alt keys:', JSON.stringify(await page.evaluate(() => globalThis.__keys).catch(() => [])))
  }
  throw error
} finally {
  await browser?.close()
  await host.stop()
  model.close()
  rmSync(home, { recursive: true, force: true })
}
