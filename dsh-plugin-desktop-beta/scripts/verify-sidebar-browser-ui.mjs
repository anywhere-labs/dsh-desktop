/**
 * Drive the official 0.1.7 Electron browser carrier with a recorded guest bridge and a stub
 * `<webview>` tag; no external site, guest process or GUI is opened. Real guest isolation is
 * covered separately by `verify-sidebar-browser.mjs`, which runs actual Electron guests.
 */
import assert from 'node:assert/strict'

export async function browserFixture(context) {
  const leases = []
  const navigations = []
  await context.exposeFunction('__nextBrowserAcquire', workspace => {
    // One partition per workspace storage account, exactly as the main process issues them.
    const record = { lease: `lease-${leases.length + 1}`, partition: `partition-${workspace}`, workspace, released: false }
    leases.push(record)
    return { lease: record.lease, partition: record.partition }
  })
  await context.exposeFunction('__nextBrowserRelease', lease => {
    const record = leases.find(item => item.lease === lease)
    if (record !== undefined) record.released = true
    return null
  })
  await context.exposeFunction('__nextBrowserNavigated', (lease, url) => { navigations.push({ lease, url }); return null })
  await context.addInitScript(() => {
    const openListeners = new Map()
    globalThis.__nextBrowserBridge = {
      acquire: workspace => window.__nextBrowserAcquire(workspace),
      release: lease => window.__nextBrowserRelease(lease),
      onOpenRequested: (lease, listener) => {
        let listeners = openListeners.get(lease)
        if (listeners === undefined) { listeners = new Set(); openListeners.set(lease, listeners) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    // Test seam for the guest's window-open path, which the main process approves and forwards.
    globalThis.__nextBrowserOpenRequested = (lease, url) => {
      for (const listener of openListeners.get(lease) ?? []) listener(url)
    }
    const create = document.createElement.bind(document)
    document.createElement = (tag, options) => {
      if (String(tag).toLowerCase() !== 'webview') return create(tag, options)
      // Chromium outside Electron has no webview tag, so stand in for its navigation surface.
      const element = create('div')
      const lease = () => (element.getAttribute('src') ?? '').split('#')[1] ?? ''
      let entries = []
      let index = -1
      let loading = false
      const emit = (type, detail) => { element.dispatchEvent(Object.assign(new Event(type), detail)) }
      const settle = () => {
        loading = false
        emit('did-stop-loading')
        emit('did-navigate')
        emit('page-title-updated')
        void window.__nextBrowserNavigated(lease(), entries[index] ?? '')
      }
      Object.assign(element, {
        loadURL: url => {
          entries = [...entries.slice(0, index + 1), url]
          index++
          loading = true
          emit('did-start-loading')
          emit('did-start-navigation', { isMainFrame: true })
          setTimeout(settle, 0)
          return Promise.resolve()
        },
        getURL: () => entries[index] ?? '',
        getTitle: () => (entries[index] === undefined ? '' : new URL(entries[index]).host),
        canGoBack: () => index > 0,
        canGoForward: () => index < entries.length - 1,
        clearHistory: () => { entries = entries.slice(index, index + 1); index = entries.length - 1 },
        goBack: () => { if (index > 0) { index--; loading = true; setTimeout(settle, 0) } },
        goForward: () => { if (index < entries.length - 1) { index++; loading = true; setTimeout(settle, 0) } },
        reload: () => { loading = true; setTimeout(settle, 0) },
        isLoading: () => loading,
        // Seam for an in-document navigation the carrier observes without a new load.
        __inPage: url => { entries[index] = url; emit('did-navigate-in-page', { isMainFrame: true }) },
      })
      setTimeout(() => { if (element.isConnected) emit('dom-ready') }, 0)
      return element
    }
  })
  return { leases, navigations }
}

export async function verifySidebarBrowser(page, fixture, screenshots) {
  await page.getByRole('button', { name: /^(打开右侧边栏|Open right sidebar)$/ }).click()
  await page.locator('[data-sidebar-right-guide-entry="browser"]').click()
  const address = page.getByRole('textbox', { name: /^(输入 HTTP\(S\) 地址|Enter an HTTP\(S\) address)$/ })
  await address.fill('https://github.com/jie023/workbuddy-acp-bridge')
  await address.press('Enter')
  const webview = page.locator('[data-sidebar-browser-frame="webview"]')
  await webview.waitFor()
  assert.equal(await page.locator('[data-sidebar-browser-frame="iframe"]').count(), 0, 'Desktop must not load websites in the iframe fallback')
  await wait(() => fixture.navigations.at(-1)?.url === 'https://github.com/jie023/workbuddy-acp-bridge').catch(async error => {
    console.error('Browser fixture:', fixture.leases, fixture.navigations.slice(-8))
    console.error(await webview.evaluate(element => element.outerHTML.slice(0, 400)))
    throw error
  })
  const held = fixture.leases.at(-1)
  assert.equal(fixture.leases.filter(item => !item.released).length, 1, 'One page holds exactly one guest lease')
  // The lease and its approved partition reach the tag, which is what the main process checks.
  assert.equal(await webview.getAttribute('src'), `about:blank#${held.lease}`)
  assert.equal(await webview.getAttribute('partition'), held.partition)
  assert.equal(await webview.getAttribute('allowpopups'), '')
  await address.fill('https://github.com/next')
  await address.press('Enter')
  await wait(() => fixture.navigations.at(-1)?.url === 'https://github.com/next')
  const back = page.getByRole('button', { name: /^(后退|Back)$/ })
  const forward = page.getByRole('button', { name: /^(前进|Forward)$/ })
  await back.click()
  await wait(() => fixture.navigations.at(-1)?.url.endsWith('/workbuddy-acp-bridge'))
  await forward.click()
  await wait(() => fixture.navigations.at(-1)?.url.endsWith('/next'))
  // An address the carrier observes rather than requests still reaches the toolbar.
  await webview.evaluate(element => { element.__inPage('https://github.com/observed-navigation') })
  await page.waitForFunction(() => document.querySelector('input[aria-label="输入 HTTP(S) 地址"]')?.value.endsWith('/observed-navigation'))
  await page.screenshot({ path: `${screenshots}/sidebar-native-browser.png`, animations: 'disabled' })
  // A retained Sidebar body keeps its guest across ordinary layout changes.
  await page.evaluate(() => window.__nextTestOpenSettings('general'))
  await page.getByRole('dialog', { name: /^(设置|Settings)$/ }).waitFor()
  await page.getByRole('dialog', { name: /^(设置|Settings)$/ }).press('Escape')
  await page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ }).click()
  await page.getByRole('button', { name: /^(打开右侧边栏|Open right sidebar)$/ }).click()
  assert.equal(fixture.leases.filter(item => !item.released).length, 1, 'Hiding the Sidebar must not drop the guest')
  assert.equal(await address.inputValue(), 'https://github.com/observed-navigation', 'Layout updates must retain the actual native address')
  // A guest's approved link opens a source tab instead of navigating the current page.
  await page.evaluate(lease => { window.__nextBrowserOpenRequested(lease, 'https://github.com/opened-from-guest') }, held.lease)
  await page.getByRole('tab', { name: /opened-from-guest|github\.com/ }).last().waitFor()
  // Switching away hides the body, and returning keeps the same occurrence/history.
  await page.locator('[data-dockkit-add-tab]').click()
  await page.locator('[data-sidebar-right-guide-entry="browser"]').click()
  await address.fill('https://github.com/second-tab')
  await address.press('Enter')
  await wait(() => fixture.navigations.at(-1)?.url === 'https://github.com/second-tab')
  const second = fixture.leases.at(-1)
  assert.notEqual(second.lease, held.lease, 'Each tab occurrence owns its own guest lease')
  assert.equal(second.partition, held.partition, 'Tabs in one Workspace share its storage account')
  const openTabs = page.locator('[data-dockkit-tab][aria-selected="true"] [data-dockkit-tab-close]')
  while (await openTabs.count() > 0) await openTabs.click()
  await wait(() => fixture.leases.every(item => item.released), 'Closing every tab releases every guest lease')
  const collapse = page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ })
  if (await collapse.isVisible()) await collapse.click()
  await page.setViewportSize({ width: 1280, height: 840 })
  return held.lease
}

export async function verifyWebBrowserFallback(page) {
  await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
  const workspace = page.getByRole('button', { name: /^(选择工作区|Select workspace)$/ })
  if (await workspace.isVisible()) await workspace.click()
  await page.getByRole('button', { name: /^(打开右侧边栏|Open right sidebar)$/ }).click()
  await page.locator('[data-sidebar-right-guide-entry="browser"]').click()
  await page.route('https://sidebar-browser.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Web iframe fixture</p>' }))
  const address = page.getByRole('textbox', { name: /^(输入 HTTP\(S\) 地址|Enter an HTTP\(S\) address)$/ })
  await address.fill('https://sidebar-browser.test/')
  await address.press('Enter')
  await page.frameLocator('[data-sidebar-browser-frame="iframe"]').getByText('Web iframe fixture').waitFor()
  assert.equal(await page.locator('[data-sidebar-browser-frame="webview"]').count(), 0)
  assert.ok(await page.locator('[data-sidebar-browser-frame="iframe"]').getAttribute('sandbox'))
}

async function wait(condition, message = 'Native Browser UI state did not settle') {
  const end = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() >= end) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
