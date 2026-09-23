/** Render the shipped native wizard headlessly: no Electron launch, Host, network or user data. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serveWebDocument } from '../lib/web-document.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const screenshots = join(root, '.desktop-next/verification')
mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({ headless: true,
  ...(process.env.DSH_NEXT_TEST_BROWSER_CHANNEL ? { channel: process.env.DSH_NEXT_TEST_BROWSER_CHANNEL } : {}),
})
const context = await browser.newContext({ viewport: { width: 1040, height: 720 }, locale: 'zh-CN', colorScheme: 'dark' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
let rejectSave = false
const commands = []
const permissionCalls = []
const grants = { screen: 'not-determined', accessibility: 'denied', microphone: 'granted' }
const state = {
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [], features: { market: true, remoteControl: false },
  preferences: {}, phase: 'starting', busy: false, failure: '', safeMode: false, onboarding: true, onboardingComputerUse: false, logs: '',
}
await page.exposeFunction('__state', () => structuredClone(state))
await page.exposeFunction('__command', command => {
  if (rejectSave) { rejectSave = false; throw new Error('Fixture: could not save Profile') }
  commands.push(command)
})
await page.exposeFunction('__permission', (action, permission) => {
  permissionCalls.push({ action, permission })
  if (action === 'request') grants[permission] = 'granted'
  return { permission, status: grants[permission], canRequest: grants[permission] === 'not-determined', canOpenSettings: true }
})
await page.addInitScript(() => { window.desktopNext = {
  state: () => window.__state(), command: value => window.__command(value),
  permissions: {
    query: permission => window.__permission('query', permission),
    request: permission => window.__permission('request', permission),
    openSettings: permission => window.__permission('openSettings', permission),
  },
} })
await page.route('http://next-onboarding.test/**', async route => {
  const response = await serveWebDocument(new Request(route.request().url()), join(root, 'lib/native-ui'), false)
  response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; base-uri 'none'")
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
})
const open = async (locale = 'zh') => {
  await page.goto('about:blank')
  await page.goto(`http://next-onboarding.test/?locale=${locale}&platform=darwin&frame=true#onboarding`)
  await page.locator('[data-page="0"]').waitFor()
}
const next = async number => {
  await page.getByRole('button', { name: /下一步|Continue/, exact: true }).click()
  await page.locator(`[data-page="${number}"]`).waitFor()
}
const capture = name => page.screenshot({ path: join(screenshots, `onboarding-${name}.png`), animations: 'disabled' })
try {
  await open()
  assert.equal(await page.getByRole('button', { name: '上一步', exact: true }).count(), 0)
  assert.equal(await page.locator('.next-onboarding-eyebrow, img').count(), 0)
  assert.equal(await page.locator('.next-onboarding-wordmark').innerText(), 'NEXT')
  assert.notEqual(await page.locator('.next-onboarding-whale').evaluate(mark => getComputedStyle(mark).maskImage), 'none')
  await capture('welcome')
  await next(1)
  const back = await page.getByRole('button', { name: '上一步', exact: true }).boundingBox()
  const skip = await page.getByRole('button', { name: '跳过全部', exact: true }).boundingBox()
  assert.ok(back.x < 100 && skip.x > 800 && Math.abs(back.y - skip.y) < 1)
  await page.getByRole('radio', { name: 'dsh-market', exact: true }).check()
  await capture('market')
  await next(2)
  await page.getByRole('switch', { name: '启用远程控制', exact: true }).check()
  assert.equal(await page.locator('.next-onboarding-copy [role="switch"]').count(), 1)
  assert.equal(await page.locator('.next-onboarding-panel [role="switch"]').count(), 0)
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.next-onboarding-devices img')]
    return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)
  })
  await capture('remote')
  await page.getByRole('button', { name: '上一步', exact: true }).click()
  await page.locator('[data-page="1"]').waitFor()
  assert.equal(await page.getByRole('radio', { name: 'dsh-market', exact: true }).getAttribute('aria-checked'), 'true')
  await next(2)
  assert.equal(await page.getByRole('switch', { name: '启用远程控制', exact: true }).getAttribute('aria-checked'), 'true')
  await next(3)
  const cuaSwitch = page.getByRole('switch', { name: '启用 Computer Use', exact: true })
  assert.equal(await cuaSwitch.getAttribute('aria-checked'), 'false')
  await cuaSwitch.check()
  const gear = page.getByRole('button', { name: '授权设置', exact: true })
  assert.ok((await gear.boundingBox()).x < (await cuaSwitch.boundingBox()).x)
  assert.deepEqual(permissionCalls, [])
  await capture('computer-use')
  await gear.click()
  const permissions = page.getByRole('dialog', { name: '系统权限', exact: true })
  await permissions.waitFor()
  const screen = permissions.getByRole('group', { name: '屏幕录制', exact: true })
  await screen.getByText('尚未授权', { exact: true }).waitFor()
  assert.equal(permissionCalls.length, 3)
  assert.ok(permissionCalls.every(call => call.action === 'query'))
  await capture('computer-use-permissions')
  await screen.getByRole('button', { name: '请求授权', exact: true }).click()
  await screen.getByText('已允许', { exact: true }).waitFor()
  await permissions.getByRole('group', { name: '辅助功能', exact: true }).getByRole('button', { name: '打开系统设置', exact: true }).click()
  assert.deepEqual(permissionCalls.filter(call => call.action !== 'query'), [
    { action: 'request', permission: 'screen' }, { action: 'openSettings', permission: 'accessibility' },
  ])
  await page.keyboard.press('Tab')
  assert.equal(await permissions.evaluate(dialog => dialog.contains(document.activeElement)), true,
    await page.evaluate(() => document.activeElement?.outerHTML))
  await page.keyboard.press('Escape')
  await permissions.waitFor({ state: 'hidden' })
  assert.equal(await gear.evaluate(button => document.activeElement === button), true)
  await page.getByRole('button', { name: '上一步', exact: true }).click()
  await page.locator('[data-page="2"]').waitFor()
  await next(3)
  assert.equal(await cuaSwitch.getAttribute('aria-checked'), 'true')
  await next(4)
  await capture('recovery')
  assert.deepEqual(commands, [])
  rejectSave = true
  await page.getByRole('button', { name: '完成并开始', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Fixture: could not save Profile' }).waitFor()
  await page.getByRole('button', { name: '完成并开始', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') === 'true')
  assert.deepEqual(commands, [{ type: 'onboarding-complete', profile: 'desktop', computerUse: true, features: { market: false, dshMarket: true, remoteControl: true } }])

  // Skip is available on every page and does not submit partially edited choices.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (let index = 0; index < 5; index++) {
    await open()
    for (let step = 1; step <= index; step++) await next(step)
    if (index === 1) await page.getByRole('radio', { name: '暂不开启', exact: true }).check()
    if (index === 2) await page.getByRole('switch', { name: '启用远程控制', exact: true }).check()
    if (index === 3) await cuaSwitch.check()
    assert.equal(await page.locator('.next-onboarding-slide').evaluate(element => getComputedStyle(element).animationName), 'none')
    await page.getByRole('button', { name: '跳过全部', exact: true }).click()
    assert.deepEqual(commands.at(-1), { type: 'onboarding-skip', profile: 'desktop' })
  }
  assert.equal(commands.length, 6)
  // Reopening setup preselects all of the current Profile's saved choices.
  state.features = { market: false, dshMarket: true, remoteControl: true }
  state.onboardingComputerUse = true
  await open()
  await next(1)
  assert.equal(await page.getByRole('radio', { name: 'dsh-market', exact: true }).getAttribute('aria-checked'), 'true')
  await next(2)
  assert.equal(await page.getByRole('switch', { name: '启用远程控制', exact: true }).getAttribute('aria-checked'), 'true')
  await next(3)
  assert.equal(await cuaSwitch.getAttribute('aria-checked'), 'true')

  // Small windows remain scrollable; light theme and English share the same flow.
  await page.setViewportSize({ width: 680, height: 560 })
  await page.emulateMedia({ colorScheme: 'light' })
  await open('en')
  for (let step = 1; step <= 4; step++) {
    await next(step)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const button = page.getByRole('button', { name: step === 4 ? 'Finish and start' : 'Continue', exact: true })
    await button.scrollIntoViewIfNeeded()
    assert.ok(await button.isVisible())
    if (step === 3) {
      await capture('computer-use-small-light')
      await page.getByRole('button', { name: 'Permissions', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'System permissions', exact: true })
      await dialog.getByRole('group', { name: 'Screen recording', exact: true }).getByText('Allowed', { exact: true }).waitFor()
      const bounds = await dialog.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 680 && bounds.y + bounds.height <= 560)
      await capture('computer-use-permissions-small-light')
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    }
  }
  await capture('recovery-small-light')
  // Returning to the first page also restores focus, without losing the current Profile.
  for (let step = 3; step >= 0; step--) {
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.locator(`[data-page="${step}"]`).waitFor()
    assert.equal(await page.locator('h1').evaluate(heading => document.activeElement === heading), true)
  }
  assert.deepEqual(errors, [])
  console.log('Next onboarding passed: five pages, Back and Skip all, retained choices, exclusive market selection, Computer Use opt-in and official permission dialog, explicit permission actions, completion and retry, reduced motion, keyboard focus, small-window scrolling and dark/light bilingual rendering. No Host, graphical app or OS permission prompt was started.')
} catch (error) {
  await capture('failure').catch(() => {})
  console.error(await page.locator('body').innerText())
  throw error
} finally { await browser.close() }
