/**
 * Layout probe: drives a RUNNING clean dsh web instance and records which chrome
 * the panel picks at a range of container heights.
 *
 * The panel never asks whether it is the bottom workbench or the native right
 * sidebar — it measures its container. This script exists because that rule has
 * broken twice: v0.1.3 judged by height alone and turned a 1500x300 workbench
 * into a single column, and v0.3.5 still flipped a wide-but-short workbench into
 * the tall-and-narrow chrome. Run it before and after changing the thresholds.
 *
 *   node scripts/layout-probe.mjs "http://127.0.0.1:3099/?token=…" [out-dir]
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/layout-probe.mjs <web-url-with-token> [out-dir]')
  process.exit(1)
}

const outDir = process.argv[3] === undefined || process.argv[3] === '' ? '/tmp/layout-probe' : process.argv[3]
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })

const log = (message) => console.log('[probe] ' + message)

// ssr-check only renders the empty state (no repository resolved), so a crash in
// the data-driven chrome — branch rows, changes, history — only ever shows up on a
// real page. An uncaught error means the panel fell back to better-sidebar's error
// boundary, which is exactly the regression this probe exists to catch.
const pageErrors = []
page.on('pageerror', (error) => {
  pageErrors.push(String(error.message))
  log('PAGEERROR ' + String(error.message).slice(0, 300))
})
const settle = (ms) => page.waitForTimeout(ms === undefined ? 1200 : ms)

async function clickText(text, options) {
  const locators = [page.getByRole('button', { name: text, exact: true }), page.getByText(text, { exact: true })]
  for (const locator of locators) {
    try {
      const target = locator.first()
      if (await target.count() === 0) continue
      await target.click({ timeout: options !== undefined && options.timeout !== undefined ? options.timeout : 6000 })
      await settle(options !== undefined && options.wait !== undefined ? options.wait : 1200)
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
  await settle(2000)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  await editor.click({ timeout: 8000 })
  await page.keyboard.type('布局探针会话')
  await page.getByRole('button', { name: '发送消息', exact: true }).first().click({ timeout: 8000 })
  await settle(7000)
}

/** The panel's home moved: 0.1.6 hosts it in the right-sidebar dock, and the
 *  old bottom-workbench entry ("展开底部面板" / .nArs4W_tabBarPlus) is gone. The
 *  panel is opened from the sidebar's start page, where its card carries the
 *  title/description this plugin registered.
 *
 *  better-sidebar 0.21 renders that card as a guide-entry button that carries the
 *  tab id but no description text, so the card is looked up by id first and only
 *  falls back to the old description probe. */
async function openPanel() {
  await clickText('打开右侧边栏')
  await settle(3000)
  let card = null
  for (const selector of ['[data-sidebar-right-guide-entry="dsh-ide-git:panel"]', '[data-sidebar-right-guide-entry="ide-git"]']) {
    const found = page.locator(selector).first()
    if (await found.count() > 0) { card = found; break }
  }
  if (card === null) card = page.locator('button').filter({ has: page.locator('span', { hasText: 'IDE 级 Git 面板' }) }).first()
  if (await card.count() === 0) throw new Error('the Git card is not on the sidebar start page')
  await card.click({ timeout: 8000 })
  await settle(6000)
}

const CHROMES = ['dig-body-columns', 'dig-body-stack', 'dig-body-compact']

/**
 * In the three-pane chrome the changes pane is a fixed 290px column, and the header
 * packs a fold button plus four toolbar icons. When it overflows, the rightmost icon
 * is simply clipped — invisible in a summary of the panel, obvious to whoever is
 * looking at it (reported on v0.3.8).
 */
async function headerOverflow() {
  return page.evaluate(() => {
    const head = document.querySelector('.dig-changes-head')
    if (head === null) return null
    const icons = head.querySelectorAll('.dig-icon-btn')
    const last = icons.length === 0 ? null : icons[icons.length - 1]
    const headBox = head.getBoundingClientRect()
    const parentBox = head.parentElement === null ? headBox : head.parentElement.getBoundingClientRect()
    const lastBox = last === null ? null : last.getBoundingClientRect()
    return {
      width: Math.round(headBox.width),
      // Content-box vs border-box shows up as the header being WIDER than the pane
      // that holds it, not as internal scroll overflow — compare with the parent.
      bleed: Math.round(headBox.right - parentBox.right),
      lastIcon: lastBox === null ? null : Math.round(lastBox.right),
      parentRight: Math.round(parentBox.right),
    }
  })
}

async function chromeOf() {
  // Only the visible root counts: a folded workbench keeps its DOM node around,
  // so a page-wide class lookup mixes two chromes together.
  const visible = page.locator('.dig-root:visible').first()
  const root = await visible.boundingBox()
  const found = []
  for (const name of CHROMES) {
    if (await page.locator('.dig-root:visible .' + name).count() > 0) found.push(name.replace('dig-body-', ''))
  }
  const rail = await page.locator('.dig-rail-vertical').count() > 0 ? 'vertical' : 'horizontal'
  return {
    width: root === null ? 0 : Math.round(root.width),
    height: root === null ? 0 : Math.round(root.height),
    chrome: found.join('+') === '' ? 'none' : found.join('+'),
    rail: rail,
  }
}

/* Width decides the chrome (invariant 7), so the sweep drives width: the panel
   lives in the right-sidebar dock, and its pane tracks the window. */
const WIDTHS = [1600, 1440, 1280, 1120, 980, 860, 760, 660, 560, 460, 380]
const rows = []

try {
  await enterSession()
  await openPanel()

  for (const width of WIDTHS) {
    await page.setViewportSize({ width: width, height: 1000 })
    await settle(900)
    const state = await chromeOf()
    rows.push({ requested: width, actual: state.width, state: state })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'w' + String(width).padStart(4, '0') + '.png') })
    const head = await headerOverflow()
    log('viewport ' + width + ' → panel ' + state.width + 'px, chrome=' + state.chrome + ', rail=' + state.rail
      + (head === null ? '' : ', changes-header ' + head.width + 'px bleed=' + head.bleed
        + ' lastIconRight=' + head.lastIcon + ' paneRight=' + head.parentRight))
    if (head !== null && (head.bleed > 1 || (head.lastIcon !== null && head.lastIcon > head.parentRight + 1))) {
      log('FAILED: the changes header clips its toolbar (panel ' + state.width + 'px wide)')
      process.exitCode = 1
    }
  }

  console.log('\nviewport | panel | chrome            | rail')
  console.log('---------|-------|-------------------|----------')
  for (const row of rows) {
    console.log(
      String(row.requested).padStart(8) + ' |' +
      String(row.actual).padStart(6) + ' | ' +
      row.state.chrome.padEnd(17) + ' | ' + row.state.rail,
    )
  }
  const widths = rows.map((row) => row.actual)
  if (new Set(widths).size === 1) {
    log('WARNING: the panel width never changed — the dock ignored the viewport sweep')
    process.exitCode = 1
  }

  if (pageErrors.length > 0) {
    log('FAILED: the panel raised ' + pageErrors.length + ' uncaught error(s) — the chrome crashed')
    for (const line of pageErrors.slice(0, 5)) log('  ' + line.slice(0, 200))
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
