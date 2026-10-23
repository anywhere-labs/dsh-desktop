/** Exercise Desktop continuation in the actual official frontend and Loader, in a temporary home. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { DesktopHostProcess } from '../lib/host-process.js'
import { NextProfiles } from '../lib/profiles.js'
import { authenticateWebHost, serveWebDocument } from '../lib/web-document.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
const home = mkdtempSync(join(tmpdir(), 'dsh-official-onboarding-'))
const profiles = new NextProfiles(home)
profiles.ensure('desktop')
profiles.setFeatures('desktop', { market: false, remoteControl: false })
// Exercise both fresh official progress and an already completed official flow.
// Desktop eligibility must not depend on either condition.
const officialPending = process.argv.includes('--official-pending')
writeFileSync(join(profiles.directory('desktop'), 'cordis.patch.yml'), JSON.stringify([
  { id: 'ui-settings-account', config: { step: officialPending ? 'welcome' : 'done', completion: officialPending ? null : 'skipped' } },
]), { mode: 0o600 })
const host = new DesktopHostProcess(process.execPath, root, profiles.directory('desktop'), undefined,
  { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, undefined, undefined, undefined, join(root, 'lib/host.js'))
const screenshots = join(root, '.desktop-next/verification')
mkdirSync(screenshots, { recursive: true })
let browser, page
let accountPending = false, rejectDismiss = true, rejectSave = false, rejectRead = true, confirmLan = false
const standaloneCommands = [], errors = [], lanConfirmations = []
const selection = { mode: 'compatibility', macosMaterial: 'off', windowsMaterial: 'off', openBrowser: false,
  networkExposure: 'loopback', market: 'community-market', aaEnabled: false,
  notifications: { enabled: true, notifyOnTurnCompletion: true, notifyOnTurnFailure: true, notifyOnJobCompletion: false, notifyOnJobFailure: false } }
try {
  const ready = await host.start()
  const origin = new URL(ready.url).origin
  const cookie = await authenticateWebHost(ready.url), separator = cookie.indexOf('=')
  const document = await (await serveWebDocument(new Request('dsh-app://app/'), webRoot)).text()
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_NEXT_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_NEXT_TEST_BROWSER_CHANNEL } : {}) })
  const context = await browser.newContext({ viewport: { width: 1040, height: 720 }, locale: 'zh-CN', colorScheme: 'dark' })
  await context.grantPermissions(['local-network-access'], { origin })
  await context.addCookies([{ url: origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }])
  await context.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: document }))
  await context.exposeFunction('__boot', async () => ({ injections: await host.collectInjections(), streamBaseUrl: origin }))
  await context.exposeFunction('__bootFailed', message => { errors.push(message) })
  await context.exposeFunction('__readSetup', () => {
    if (rejectRead) { rejectRead = false; throw new Error('Fixture: setup state unavailable') }
    return { required: false, accountPending, edition: 'next', profile: 'desktop', computerUse: false,
      input: { ...selection, appVersion: '2.0.14-beta.1', platform: 'darwin', profileName: 'desktop' } }
  })
  await context.exposeFunction('__dismissAccount', profile => {
    assert.equal(profile, 'desktop')
    if (rejectDismiss) { rejectDismiss = false; throw new Error('Fixture: account choice save failed') }
    accountPending = false
  })
  await context.exposeFunction('__standaloneState', () => ({
    selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [], features: { market: true, remoteControl: false },
    preferences: { browserAccess: false, networkExposure: 'loopback' }, phase: 'starting', busy: false, failure: '', safeMode: false, onboarding: true, onboardingComputerUse: false, logs: '',
  }))
  await context.exposeFunction('__standaloneCommand', command => {
    if (command?.type === 'confirm-lan') {
      lanConfirmations.push(confirmLan)
      return confirmLan
    }
    if (rejectSave) { rejectSave = false; throw new Error('Fixture: could not save Profile') }
    standaloneCommands.push(command)
    if (command?.type === 'onboarding-complete') accountPending = true
  })
  await context.exposeFunction('__standalonePermission', (_action, permission) => ({
    permission, status: 'granted', canRequest: false, canOpenSettings: true,
  }))
  await context.addInitScript(() => {
    globalThis.dshDesktop = { protocolVersion: 1 }
    globalThis.dshDesktopBoot = { ready: () => globalThis.__boot(), failed: message => globalThis.__bootFailed(message) }
    globalThis.dshDesktopSetup = { read: () => globalThis.__readSetup(), finish: () => { throw new Error('Setup is unavailable') }, dismissAccount: profile => globalThis.__dismissAccount(profile) }
    window.desktopNext = {
      state: () => globalThis.__standaloneState(),
      command: value => globalThis.__standaloneCommand(value),
      permissions: {
        query: permission => globalThis.__standalonePermission('query', permission),
        request: permission => globalThis.__standalonePermission('request', permission),
        openSettings: permission => globalThis.__standalonePermission('openSettings', permission),
      },
    }
  })
  page = await context.newPage(); page.setDefaultTimeout(20_000)
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await page.route('http://next-onboarding.test/**', async route => {
    const response = await serveWebDocument(new Request(route.request().url()), join(root, 'lib/native-ui'), false)
    response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; base-uri 'none'")
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  const shell = page.locator('.next-onboarding')
  const surface = page.locator('[data-desktop-onboarding="desktop-extension"]')
  const captureAccount = async name => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})))
    })
    await page.screenshot({ path: join(screenshots, name) })
  }
  const navigate = async (name, delta) => {
    const current = Number(await shell.locator('[data-page]').getAttribute('data-page'))
    await shell.getByRole('button', { name }).click()
    await shell.locator(`[data-page="${current + delta}"]`).waitFor()
  }
  const next = () => navigate(/^(下一步|Continue)$/, 1)
  const finish = () => shell.getByRole('button', { name: /^(完成并开始|Finish and start)$/ }).click()
  const skip = () => shell.getByRole('button', { name: /^(跳过|Skip)$/ }).click()
  const back = () => navigate(/^(上一步|Back)$/, -1)
  const openShell = async () => {
    await page.goto('http://next-onboarding.test/?locale=zh&platform=darwin&frame=true#onboarding')
    await shell.locator('[data-page="0"]').waitFor()
  }
  await openShell()
  assert.notEqual(await shell.evaluate(element => getComputedStyle(element).getPropertyValue('--spacing').trim()), '')
  assert.match(await shell.locator('h1').innerText(), /DSH Desktop Beta/)
  await page.screenshot({ path: join(screenshots, 'onboarding-official-welcome.png') })
  await next()
  const backBounds = await shell.getByRole('button', { name: /^(上一步|Back)$/ }).boundingBox()
  const progressBounds = await shell.locator('.next-onboarding-progress').boundingBox()
  const mainBounds = await shell.locator('main').boundingBox()
  assert.ok(progressBounds.y >= 36 && progressBounds.y + progressBounds.height <= mainBounds.y, 'Progress belongs above the content, clear of traffic lights')
  assert.ok(backBounds.y >= mainBounds.y + mainBounds.height, 'Back navigation belongs below the content')
  for (const element of await shell.locator('.next-onboarding-choice, [role="radio"]').all()) {
    assert.equal(await element.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region')), 'no-drag', 'Choice cards and radio controls must subtract the drag region')
  }
  assert.equal(await shell.locator('.next-onboarding-choice-group .next-onboarding-choice').count(), 2)
  assert.equal(await shell.getByRole('switch').isChecked(), true)
  await shell.getByRole('switch').uncheck()
  assert.equal(await shell.getByRole('radio', { name: 'dsh-community-market', exact: true }).isDisabled(), true)
  assert.equal(await shell.getByRole('radio', { name: 'dsh-market', exact: true }).isDisabled(), true)
  assert.equal(await shell.getByRole('radio', { name: '自定义插件市场', exact: true }).isDisabled(), false)
  await shell.getByText('自定义插件市场', { exact: true }).click()
  assert.equal(await shell.getByRole('radio', { name: '自定义插件市场', exact: true }).isChecked(), true)
  await shell.getByRole('switch').check()
  await shell.getByText('dsh-market', { exact: true }).click()
  assert.equal(await shell.getByRole('radio', { name: 'dsh-market', exact: true }).isChecked(), true)
  assert.equal(await shell.getByRole('radio', { name: '自定义插件市场', exact: true }).isChecked(), true)
  assert.equal(await shell.getByRole('radio', { name: 'dsh-community-market', exact: true }).isChecked(), false)
  await shell.getByText('自定义插件市场', { exact: true }).click()
  assert.equal(await shell.getByRole('radio', { name: '自定义插件市场', exact: true }).isChecked(), false)
  assert.equal(await shell.getByRole('radio', { name: 'dsh-market', exact: true }).isChecked(), true)
  await page.screenshot({ path: join(screenshots, 'onboarding-official-market-macos.png') })
  await next()
  await shell.getByRole('switch').check()
  assert.equal(await shell.getByRole('switch').evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region')), 'no-drag')
  assert.equal(await shell.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true)
  await back()
  assert.equal(await shell.getByRole('radio', { name: 'dsh-market', exact: true }).isChecked(), true)
  await next()
  assert.equal(await shell.getByRole('switch').isChecked(), true)
  await next()
  await shell.getByRole('switch').check()
  const standalonePermissionsButton = shell.getByRole('button', { name: /^(权限设置|Permission settings)$/ })
  assert.equal(await standalonePermissionsButton.evaluate(node => getComputedStyle(node).borderRadius), '8px')
  await standalonePermissionsButton.click()
  const permissions = page.getByRole('dialog', { name: /^(系统权限|System permissions)$/ })
  await permissions.waitFor()
  assert.equal(await permissions.evaluate(node => getComputedStyle(node).borderRadius), '28px')
  assert.equal(await permissions.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(44, 44, 46)')
  assert.equal(await permissions.getByRole('button', { name: /^(关闭|Close)$/ }).evaluate(node => getComputedStyle(node).outlineStyle), 'none')
  await permissions.getByRole('button', { name: /^(关闭|Close)$/ }).click()
  await permissions.waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(screenshots, 'onboarding-official-computer-use.png') })
  await next()
  assert.equal(await shell.getByRole('radio', { name: '仅这台电脑', exact: true }).isChecked(), true)
  assert.equal(await shell.getByRole('radio', { name: '仅这台电脑', exact: true }).isDisabled(), true)
  assert.equal(await shell.getByRole('radio', { name: '局域网', exact: true }).isDisabled(), true)
  assert.deepEqual(await shell.locator('.next-onboarding-choice').evaluateAll(nodes => nodes.map(node => ({
    selected: node.getAttribute('data-selected'),
    disabled: node.getAttribute('data-disabled'),
  }))), [{ selected: 'false', disabled: 'true' }, { selected: 'false', disabled: 'true' }])
  await shell.getByRole('switch').check()
  assert.equal(await shell.getByRole('radio', { name: '仅这台电脑', exact: true }).isDisabled(), false)
  assert.equal(await shell.getByRole('radio', { name: '局域网', exact: true }).isDisabled(), false)
  await shell.getByText('局域网', { exact: true }).click()
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  assert.deepEqual(lanConfirmations, [false])
  assert.equal(await shell.getByRole('radio', { name: '仅这台电脑', exact: true }).isChecked(), true)
  confirmLan = true
  await shell.getByText('局域网', { exact: true }).click()
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  assert.deepEqual(lanConfirmations, [false, true])
  await shell.getByRole('radio', { name: '局域网', exact: true, checked: true }).waitFor()
  await page.screenshot({ path: join(screenshots, 'onboarding-official-browser-access.png') })
  await next()
  assert.match(await shell.locator('.next-onboarding-recovery').innerText(), /桌面设置最底部/)
  rejectSave = true
  await finish()
  await shell.getByRole('alert').filter({ hasText: 'could not save Profile' }).waitFor()
  await finish()
  assert.equal(standaloneCommands.length, 1)
  assert.deepEqual(standaloneCommands[0], {
    type: 'onboarding-complete',
    profile: 'desktop',
    browserAccess: true,
    networkExposure: 'lan',
    computerUse: true,
    features: { market: false, dshMarket: true, remoteControl: true },
  })
  // After standalone setup finishes, the main window opens and runs the account continuation.
  await page.goto(origin); await surface.waitFor()
  await surface.getByRole('alert').filter({ hasText: 'setup state unavailable' }).waitFor()
  await surface.getByRole('button', { name: /^(重试|Retry)$/ }).first().click()
  await surface.getByRole('heading', { name: '桌面设置已完成' }).waitFor()
  assert.equal(await page.locator('#root').evaluate(element => element.inert), true)
  await captureAccount('onboarding-official-account-choice.png')
  await surface.getByRole('button', { name: '登录 DeepSeek' }).click()
  await surface.getByRole('alert').filter({ hasText: 'account choice save failed' }).waitFor()
  await surface.getByRole('button', { name: '重试', exact: true }).click()
  await surface.getByRole('button', { name: '登录 DeepSeek' }).click()
  const login = page.getByRole('dialog', { name: '开始使用', exact: true })
  await login.waitFor()
  await surface.waitFor({ state: 'hidden' })
  assert.equal(await surface.count(), 0)
  await captureAccount('onboarding-official-account-login.png')
  await login.getByRole('button', { name: '添加 API Key', exact: true }).click()
  await login.waitFor({ state: 'hidden' })
  await page.getByRole('dialog').filter({ hasText: 'API Key' }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: /^(插件|Plugins)$/ }).waitFor()
  assert.equal(await surface.count(), 0)
  accountPending = true
  await page.reload()
  await surface.getByRole('button', { name: '暂时跳过', exact: true }).click()
  await surface.waitFor({ state: 'hidden' })
  await page.getByRole('status').filter({ hasText: '正在加载设置' }).waitFor({ state: 'hidden' })
  assert.equal(accountPending, false)
  assert.equal(await page.locator('#root').evaluate(element => element.inert), false)
  await openShell(); await next()
  await page.setViewportSize({ width: 680, height: 560 })
  const headingBounds = await shell.locator('h1').boundingBox()
  const footerBounds = await shell.locator('footer').boundingBox()
  assert.ok(headingBounds.y >= 0 && footerBounds.y + footerBounds.height <= 560)
  assert.equal(await shell.locator('h1').evaluate(heading => heading === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'onboarding-official-next-small.png') })
  await next(); await shell.getByRole('switch').check(); await skip()
  assert.deepEqual(standaloneCommands.at(-1), { type: 'onboarding-skip', profile: 'desktop' })
  assert.deepEqual(errors, [])
  console.log(`Next onboarding passed in standalone pre-Host shell and official account continuation: independent native eligibility, official progress ${officialPending ? 'unfinished' : 'completed'}, state-read and save retries, six pages, artwork, back navigation, choices, skip, completion, inert cleanup, and no repeat.`)
} catch (error) {
  console.error(errors)
  if (page) { console.error(await page.locator('body').innerText()); await page.screenshot({ path: join(screenshots, 'onboarding-failure.png') }).catch(() => {}) }
  throw error
} finally {
  await browser?.close()
  await host.stop()
  rmSync(home, { recursive: true, force: true })
}
