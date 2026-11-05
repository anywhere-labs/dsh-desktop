/**
 * Settings-card probe: drives a RUNNING dsh web instance and locks the shape of
 * the action-rail settings card — the one surface where a switch could lie about
 * the Host's document.
 *
 *   node scripts/settings-card-probe.mjs "http://127.0.0.1:3250/?token=…" [out-dir] [patch-file]
 *
 * What it pins (each one is a defect that actually shipped and was fixed):
 *  1. a tick flips the checkbox within 100ms, both directions;
 *  2. the visual, the row Config and the persisted profile patch agree within a
 *     short window, and survive a reload;
 *  3. a fast double click (80ms apart) nets ZERO — the control's own answer is
 *     the target, so no click may be lost while the previous one renders;
 *  4. 16 switches toggled 55ms apart all land: one atomic mutation per window
 *     instead of a burst the Host can lose inside its persist cycle;
 *  5. zero uncaught page errors throughout.
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/settings-card-probe.mjs <web-url-with-token> [out-dir] [patch-file]')
  process.exit(1)
}
const outDir = process.argv[3] === undefined || process.argv[3] === '' ? '/tmp/settings-card-probe' : process.argv[3]
const patchFile = process.argv[4] === undefined || process.argv[4] === '' ? '' : process.argv[4]
mkdirSync(outDir, { recursive: true })

function loadPlaywright() {
  const checkout = process.env.DSH_CHECKOUT === undefined || process.env.DSH_CHECKOUT === '' ? '/Users/kanna/project/deepseek-harness' : process.env.DSH_CHECKOUT
  for (const name of readdirSync(join(checkout, 'node_modules', '.pnpm'))) {
    if (name.indexOf('playwright@') !== 0) continue
    const candidate = join(checkout, 'node_modules', '.pnpm', name, 'node_modules', 'playwright', 'package.json')
    if (existsSync(candidate)) { try { return createRequire(candidate)('playwright') } catch (error) { void error } }
  }
  throw new Error('playwright not found')
}

const failures = []
const log = (message) => console.log('[card] ' + message)
const check = (ok, message) => {
  if (ok) { log('ok   ' + message); return true }
  log('FAIL ' + message)
  failures.push(message)
  return false
}
const settle = (ms) => page.waitForTimeout(ms === undefined ? 900 : ms)

const { chromium } = loadPlaywright()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 })
const pageErrors = []
page.on('pageerror', (error) => { pageErrors.push(String(error.message)); log('PAGEERROR ' + String(error.message).slice(0, 240)) })

async function clickText(text, wait) {
  for (const locator of [page.getByRole('button', { name: text, exact: true }), page.getByText(text, { exact: true })]) {
    try {
      const target = locator.first()
      if (await target.count() === 0) continue
      await target.click({ timeout: 6000 })
      await settle(wait === undefined ? 1200 : wait)
      return true
    } catch (error) { void error }
  }
  return false
}

async function ensurePanel() {
  if (await page.locator('.dig-root:visible').count() > 0) return true
  const entry = () => page.locator('[data-sidebar-right-guide-entry="dsh-ide-git:panel"]').first()
  if (await entry().count() === 0) {
    await clickText('稍后配置', 900)
    if (await entry().count() === 0) await clickText('打开右侧边栏', 2500)
  }
  if (await entry().count() === 0) return false
  await entry().click({ timeout: 8000 })
  await settle(5000)
  return await page.locator('.dig-root:visible').count() > 0
}

async function openCard() {
  await page.locator('.dig-root:visible .dig-rail-settings').first().click({ timeout: 6000 })
  await settle(2500)
  /* The card's sections are collapsible and ship COLLAPSED, so the switches this
     probe drives are not in the DOM until their section is unfolded. Open every
     fold head before any assertion runs (also re-opens after each reload). */
  const heads = page.locator('[data-plugin-config] .dig-foldHead')
  const headCount = await heads.count()
  for (let index = 0; index < headCount; index++) {
    try { await heads.nth(index).click({ timeout: 4000 }); await settle(300) } catch (error) { void error }
  }
  return page.locator('[data-plugin-config] .dig-settings').count()
}

const visuals = () => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('[data-plugin-config] input[type=checkbox]')].map((box) => [box.id.replace('dig-rail-', ''), box.checked]),
))
const status = () => page.evaluate(() => {
  const card = document.querySelector('[data-plugin-config] .dig-settings')
  return card === null ? null : card.getAttribute('data-settings-status')
})
const box = (id) => page.locator('[data-plugin-config] input#dig-rail-' + id).first()
/* The persisted row Config: an absent key means the Host default, which is shown. */
const patchValues = () => {
  if (patchFile === '') return null
  try {
    const text = readFileSync(patchFile, 'utf8')
    const values = {}
    for (const match of text.matchAll(/rail([A-Z][A-Za-z]*):\s*(true|false)/g)) values[match[1].charAt(0).toLowerCase() + match[1].slice(1)] = match[2] === 'true'
    return values
  } catch (error) { return null }
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(7000)
  await clickText('继续')
  await clickText('稍后配置')
  await clickText('新建会话')
  await settle(1800)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  await editor.click({ timeout: 8000 })
  await page.keyboard.type('设置卡探针')
  await page.getByRole('button', { name: '发送消息', exact: true }).first().click({ timeout: 8000 })
  await settle(9000)
  check(await ensurePanel(), 'the Git panel opened')
  check(await openCard() > 0, 'the settings card registered on the plugin page')
  check(await status() === 'ready', 'the card reads a ready row Config (got ' + String(await status()) + ')')

  const ids = Object.keys(await visuals())
  check(ids.length >= 12, 'one switch per rail action (' + ids.length + ')')
  const target = ids.indexOf('stash') >= 0 ? 'stash' : ids[0]

  /* 1 — a tick flips within 100ms, both directions. */
  const start = (await visuals())[target]
  /* Every assertion below is relative to where the switch started, so the probe
     passes whatever the instance's stored value happens to be. */
  await box(target).click({ timeout: 6000 })
  await settle(100)
  check((await visuals())[target] === !start, 'untick flips the checkbox within 100ms')
  await settle(2500)
  const off = patchValues()
  if (off !== null) check(off[target] === !start, 'the unticked field reached the profile patch')
  await box(target).click({ timeout: 6000 })
  await settle(100)
  check((await visuals())[target] === start, 're-tick flips the checkbox within 100ms')
  await settle(2500)
  const on = patchValues()
  if (on !== null) check(on[target] === start, 'the re-ticked field reached the profile patch')
  await page.locator('[data-plugin-config]').first().screenshot({ path: join(outDir, 'card.png') })

  /* 2 — the reload keeps it, so the write landed in the Host, not just the DOM. */
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(9000)
  await ensurePanel()
  await openCard()
  check((await visuals())[target] === start, 'the value survived a reload')
  const afterReload = patchValues()
  if (afterReload !== null) check(afterReload[target] === start, 'the patch still agrees after the reload')

  /* 3 — a fast double click nets zero. */
  const beforeDouble = (await visuals())[target]
  await box(target).click({ timeout: 6000 })
  await settle(80)
  await box(target).click({ timeout: 6000 })
  await settle(3000)
  check((await visuals())[target] === beforeDouble, 'a double click 80ms apart nets zero')
  const afterDouble = patchValues()
  if (afterDouble !== null) check(afterDouble[target] === beforeDouble, 'the patch agrees after the double click')

  /* 4 — sixteen switches 55ms apart all land. */
  const beforeBurst = await visuals()
  for (const id of ids) {
    await box(id).click({ timeout: 6000 }).catch(() => {})
    await settle(55)
  }
  await settle(5000)
  const afterBurst = await visuals()
  const burstPatch = patchValues()
  const visualWrong = ids.filter((id) => afterBurst[id] !== !beforeBurst[id])
  check(visualWrong.length === 0, 'every switch flipped in a 55ms burst (' + (visualWrong.length === 0 ? 'all ' + ids.length : visualWrong.join(',')) + ')')
  if (burstPatch !== null) {
    const hostWrong = ids.filter((id) => (burstPatch[id] === undefined ? true : burstPatch[id]) !== !beforeBurst[id])
    check(hostWrong.length === 0, 'every bursted field reached the row Config (' + (hostWrong.length === 0 ? 'all ' + ids.length : hostWrong.join(',')) + ')')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(9000)
  await ensurePanel()
  await openCard()
  const persisted = await visuals()
  const lost = ids.filter((id) => persisted[id] !== !beforeBurst[id])
  check(lost.length === 0, 'the burst survived a reload (' + (lost.length === 0 ? 'all ' + ids.length : lost.join(',')) + ')')

  check(pageErrors.length === 0, 'no uncaught page errors')
} catch (error) {
  log('FAILED: ' + String(error.message).slice(0, 400))
  failures.push(String(error.message).slice(0, 200))
} finally {
  if (failures.length > 0) log('RESULT: ' + failures.length + ' failure(s)')
  else log('RESULT: the settings card keeps visual, row Config and patch in step')
  await browser.close()
  if (failures.length > 0) process.exitCode = 1
}
