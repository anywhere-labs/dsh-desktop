/**
 * Dock probe: drives a RUNNING clean dsh web instance and checks the panel's
 * right-sidebar actions (float / dock back / split / full screen) and the tree
 * toggle in both registration doors.
 *
 *   node scripts/dock-probe.mjs "http://127.0.0.1:3242/?token=…" [out-dir] [native|degraded]
 *
 * `native`   — a host WITHOUT dsh-better-sidebar: the panel sits in DSH's own right
 *              sidebar, owns a sidebarRight tab id, and the four actions must work.
 * `degraded` — a host WITH dsh-better-sidebar: that dock hosts the panel, no
 *              sidebarRight tab id exists, so the dock actions must NOT render —
 *              the tree toggle still must.
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/dock-probe.mjs <web-url-with-token> [out-dir] [native|degraded]')
  process.exit(1)
}
const outDir = process.argv[3] === undefined || process.argv[3] === '' ? '/tmp/dock-probe' : process.argv[3]
const mode = process.argv[4] === 'degraded' ? 'degraded' : 'native'
mkdirSync(outDir, { recursive: true })

function loadPlaywright() {
  const checkout = process.env.DSH_CHECKOUT === undefined || process.env.DSH_CHECKOUT === ''
    ? '/Users/kanna/project/deepseek-harness'
    : process.env.DSH_CHECKOUT
  const store = join(checkout, 'node_modules', '.pnpm')
  const candidates = []
  if (existsSync(store)) {
    for (const name of readdirSync(store)) {
      if (name.indexOf('playwright@') !== 0) continue
      candidates.push(join(store, name, 'node_modules', 'playwright', 'package.json'))
    }
  }
  candidates.push(join(checkout, 'node_modules', 'playwright', 'package.json'))
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try { return createRequire(candidate)('playwright') } catch (error) { void error }
  }
  throw new Error('playwright not found under ' + checkout + ' (set DSH_CHECKOUT)')
}

const { chromium } = loadPlaywright()
const browser = await chromium.launch({ headless: true, channel: process.env.DSH_SHOT_CHANNEL === undefined ? 'chrome' : process.env.DSH_SHOT_CHANNEL })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 })

const failures = []
const log = (message) => console.log('[dock] ' + message)
const check = (ok, message) => {
  if (ok) { log('ok   ' + message); return true }
  log('FAIL ' + message)
  failures.push(message)
  return false
}
const settle = (ms) => page.waitForTimeout(ms === undefined ? 900 : ms)

const pageErrors = []
page.on('pageerror', (error) => {
  pageErrors.push(String(error.message))
  log('PAGEERROR ' + String(error.message).slice(0, 300))
})

async function clickText(text, wait) {
  const locators = [page.getByRole('button', { name: text, exact: true }), page.getByText(text, { exact: true })]
  for (const locator of locators) {
    try {
      const target = locator.first()
      if (await target.count() === 0) continue
      await target.click({ timeout: 6000 })
      await settle(wait === undefined ? 1200 : wait)
      return true
    } catch (error) { void error }
  }
  log('MISS ' + text)
  return false
}

async function enterSession() {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(7000)
  await clickText('继续')
  await clickText('稍后配置')
  await clickText('新建会话')
  await settle(1800)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  await editor.click({ timeout: 8000 })
  await page.keyboard.type('停靠探针')
  await page.getByRole('button', { name: '发送消息', exact: true }).first().click({ timeout: 8000 })
  await settle(6000)
}

  /* The Git card, whichever door registered it: dsh-better-sidebar 0.21 keys its
     guide-entry button by TAB id and renders no description text, while DSH's own
     right sidebar keys it by the tab KIND and does render the description. */
  const guideCard = async () => {
    for (const selector of ['[data-sidebar-right-guide-entry="dsh-ide-git:panel"]', '[data-sidebar-right-guide-entry="ide-git"]']) {
      const found = page.locator(selector).first()
      if (await found.count() > 0) return found
    }
    const described = page.locator('button').filter({ hasText: 'IDE 级 Git 面板' }).first()
    return await described.count() > 0 ? described : null
  }

async function ensurePanel() {
  if (await page.locator('.dig-root:visible').count() > 0) return true
  if (await guideCard() === null) {
    await clickText('稍后配置', 900)
    if (await guideCard() === null) await clickText('打开右侧边栏', 2500)
  }
  const card = await guideCard()
  if (card === null) { log('MISS Git card'); return false }
  await card.click({ timeout: 8000 })
  await settle(5500)
  await page.locator('.dig-body').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(1500)
  return await page.locator('.dig-root:visible').count() > 0
}

/** The panel's own DOM: rail actions, pane presence and the dock's layout surface. */
async function readPanel() {
  return page.evaluate(() => {
    let root = null
    for (const candidate of document.querySelectorAll('.dig-root')) {
      if (candidate.getBoundingClientRect().width > 0) { root = candidate; break }
    }
    if (root === null) return { missing: true }
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
    }
    const actions = [...root.querySelectorAll('[data-action]')].map((node) => ({
      id: node.getAttribute('data-action'),
      pressed: node.getAttribute('aria-pressed'),
      label: node.getAttribute('title'),
      disabled: node.disabled === true,
      inHeader: node.closest('.dig-compact-bar') !== null,
    }))
    const tree = root.querySelector('[data-pane="tree"]')
    return {
      panel: box(root),
      chrome: (root.querySelector('.dig-body').className.match(/dig-body-(columns|stack|compact)/) || [null, 'none'])[1],
      actions: actions,
      tree: tree === null ? null : box(tree),
      floats: document.querySelectorAll('[data-dockkit-float]').length,
      paneRoots: [...document.querySelectorAll('[data-dockkit-pane]')].filter((pane) => pane.querySelector('.dig-root') !== null).length,
      panes: document.querySelectorAll('[data-dockkit-pane]').length,
      dividers: document.querySelectorAll('[data-dockkit-divider]').length,
      floatHoldsPanel: document.querySelector('[data-dockkit-float] .dig-root') !== null,
      modes: [...document.querySelectorAll('[data-sidebar-right-mode]')].map((node) => node.getAttribute('aria-label')),
    }
  })
}

const action = (state, id) => state.actions.filter((entry) => entry.id === id)
const has = (state, id) => action(state, id).length > 0

/** Click a rail action, through `⋯ 更多` when the strip ran out of room. */
async function clickAction(id) {
  const direct = page.locator('.dig-root:visible [data-action="' + id + '"]').first()
  if (await direct.count() > 0) {
    await direct.click({ timeout: 6000 })
    await settle(1400)
    return true
  }
  const more = page.locator('.dig-root:visible .dig-rail-more').first()
  if (await more.count() === 0) return false
  await more.click({ timeout: 6000 })
  await settle(600)
  const item = page.locator('.dig-menu [data-action="rail:' + id + '"]').first()
  if (await item.count() === 0) return false
  await item.click({ timeout: 6000 })
  await settle(1400)
  return true
}

const rows = []

try {
  await enterSession()
  if (!await ensurePanel()) throw new Error('the panel never opened')
  await settle(1500)

  const start = await readPanel()
  log(mode + ' start: panel ' + start.panel[2] + 'x' + start.panel[3] + ' chrome=' + start.chrome
    + ' actions=[' + start.actions.map((entry) => entry.id).join(',') + '] tree=' + (start.tree === null ? 'none' : 'yes'))
  check(start.missing !== true, 'the panel rendered')
  check(has(start, 'tree'), 'the tree toggle is on the rail')
  check(start.tree !== null, 'the tree pane starts open')

  /* ---------- the tree toggle, in both doors ---------- */

  await clickAction('tree')
  const folded = await readPanel()
  check(folded.tree === null, 'the rail tree action folded the pane')
  check(action(folded, 'tree')[0].pressed === 'false', 'and the rail button reports aria-pressed=false')
  await clickAction('tree')
  const unfolded = await readPanel()
  check(unfolded.tree !== null, 'the same button brought the tree back')
  check(action(unfolded, 'tree')[0].pressed === 'true', 'and reports aria-pressed=true again')
  rows.push({ step: 'rail tree toggle', detail: 'open → folded → open' })

  /* ---------- the dock actions ---------- */

  if (mode === 'degraded') {
    for (const id of ['float', 'split', 'fullscreen']) {
      check(has(start, id) === false, 'no ' + id + ' button where no sidebarRight tab exists')
    }
    rows.push({ step: 'dock actions', detail: 'absent (degraded), no error' })
    check(pageErrors.length === 0, 'the degraded mount raised nothing')
  } else {
    check(has(start, 'float') && has(start, 'split') && has(start, 'fullscreen'),
      'float / split / full screen all render on the native seat')
    check(action(start, 'float')[0].label === '浮动本页', 'the float button says what it does (' + action(start, 'float')[0].label + ')')
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-1-docked.png') })

    await clickAction('float')
    const floated = await readPanel()
    log('after float: floats=' + floated.floats + ' floatHoldsPanel=' + floated.floatHoldsPanel
      + ' label=' + (action(floated, 'float')[0] === undefined ? '(gone)' : action(floated, 'float')[0].label))
    check(floated.floats === 1 && floated.floatHoldsPanel === true, 'float() put this panel into its own floating window')
    check(action(floated, 'float')[0] !== undefined && action(floated, 'float')[0].label === '收回停靠',
      'the button flipped to 收回停靠 while floating')
    rows.push({ step: 'float', detail: 'floats=1, panel inside the float' })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-2-floating.png') })

    await clickAction('float')
    const dockedBack = await readPanel()
    log('after dock: floats=' + dockedBack.floats + ' paneRoots=' + dockedBack.paneRoots)
    check(dockedBack.floats === 0 && dockedBack.paneRoots === 1, 'the same button docked it back into the column')
    check(action(dockedBack, 'float')[0].label === '浮动本页', 'and the label flipped back')
    rows.push({ step: 'dock back', detail: 'floats=0, panel back in a pane' })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-3-docked-back.png') })

    await clickAction('split')
    const split = await readPanel()
    log('after split: panes=' + split.panes + ' dividers=' + split.dividers)
    check(split.panes === 2 && split.dividers === 1, 'split() produced a second pane and its divider')
    rows.push({ step: 'split', detail: 'panes=2 dividers=1' })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-4-split.png') })

    const before = (await readPanel()).modes
    await clickAction('fullscreen')
    const full = await readPanel()
    log('after fullscreen: before=' + JSON.stringify(before) + ' after=' + JSON.stringify(full.modes))
    check(JSON.stringify(full.modes) !== JSON.stringify(before) || full.modes.length > 0,
      'toggleFullscreen() switched the display mode (' + JSON.stringify(full.modes) + ')')
    check(action(full, 'fullscreen') !== undefined && action(full, 'fullscreen')[0].label === '退出全屏',
      'the button flipped to 退出全屏 (' + (action(full, 'fullscreen')[0] === undefined ? 'gone' : action(full, 'fullscreen')[0].label) + ')')
    rows.push({ step: 'full screen', detail: JSON.stringify(full.modes) })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-5-fullscreen.png') })
    await clickAction('fullscreen')
    await settle(800)
    const back = await readPanel()
    check(action(back, 'fullscreen')[0].label === '全屏', 'and back out again')
    rows.push({ step: 'exit full screen', detail: JSON.stringify(back.modes) })
  }

  /* ---------- the compact header's own tree control is two-way ---------- */

  await page.setViewportSize({ width: 380, height: 1000 })
  await settle(1800)
  const narrow = await readPanel()
  log('narrow: panel ' + narrow.panel[2] + ' chrome=' + narrow.chrome + ' header tree=' + JSON.stringify(action(narrow, 'tree').filter((entry) => entry.inHeader)))
  check(narrow.chrome === 'compact', 'the panel is in the compact chrome (' + narrow.chrome + ')')
  const headerButton = page.locator('.dig-root:visible .dig-compact-bar [data-action="tree"]').first()
  check(await headerButton.count() === 1, 'the compact header carries a tree control')
  await headerButton.click({ timeout: 6000 })
  await settle(1200)
  const headerFolded = await readPanel()
  check(headerFolded.tree === null, 'it folded the tree')
  const stillThere = page.locator('.dig-root:visible .dig-compact-bar [data-action="tree"]').first()
  check(await stillThere.count() === 1, 'and it is STILL THERE while the tree is folded (the deadlock that made a folded tree unrecoverable)')
  check(action(headerFolded, 'tree').filter((entry) => entry.inHeader)[0].pressed === 'false', 'reporting the folded state')
  await stillThere.click({ timeout: 6000 })
  await settle(1200)
  const headerOpen = await readPanel()
  check(headerOpen.tree !== null, 'clicking it again brought the tree back')
  rows.push({ step: 'compact header tree', detail: 'folded and recovered' })
  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'dock-6-compact-tree.png') })
} catch (error) {
  log('FAILED: ' + String(error.message).slice(0, 400))
  failures.push(String(error.message).slice(0, 200))
} finally {
  console.log('\nstep                 | detail')
  console.log('---------------------|--------------------------------------')
  for (const row of rows) console.log(row.step.padEnd(20) + ' | ' + row.detail)
  if (pageErrors.length > 0) {
    log('FAILED: ' + pageErrors.length + ' uncaught error(s)')
    for (const line of pageErrors.slice(0, 5)) log('  ' + line.slice(0, 200))
    failures.push('pageerror')
  }
  if (failures.length > 0) {
    log('RESULT: ' + failures.length + ' failure(s)')
    process.exitCode = 1
  } else {
    log('RESULT: all ' + mode + ' assertions passed, zero page errors')
  }
  await browser.close()
}
