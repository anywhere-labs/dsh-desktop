/**
 * Captures the README screenshots from a RUNNING dsh web instance.
 *
 * The instance must have exactly two plugins installed (dsh-better-sidebar and
 * dsh-ide-git) and be bound to the throwaway demo repository, so nothing private
 * — no real workspace, no wallpaper plugin, no other panel — can end up in the
 * images. Every shot is an element screenshot of the plugin's own root, so only
 * the panel is captured, never the surrounding shell.
 *
 *   node scripts/demo-repo.mjs /tmp/dsh-ide-git-demo
 *   # a clean DSH_HOME with the two plugins, then:
 *   #   dsh web --port 3099 --no-open
 *   node scripts/screenshots.mjs "http://127.0.0.1:3099/?token=…"
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/screenshots.mjs <web-url-with-token> [out-dir]')
  process.exit(1)
}

const outDir = process.argv[3] === undefined || process.argv[3] === ''
  ? fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
  : process.argv[3]
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })

const log = (message) => console.log('[shot] ' + message)
const settle = (ms) => page.waitForTimeout(ms === undefined ? 1500 : ms)

async function clickText(text, options) {
  const locators = [page.getByRole('button', { name: text, exact: true }), page.getByText(text, { exact: true })]
  for (const locator of locators) {
    try {
      const target = locator.first()
      if (await target.count() === 0) continue
      await target.click({ timeout: options !== undefined && options.timeout !== undefined ? options.timeout : 6000 })
      await settle(options !== undefined && options.wait !== undefined ? options.wait : 1500)
      log('click ' + text)
      return true
    } catch (error) { void error }
  }
  log('MISS ' + text)
  return false
}

async function shot(name, index) {
  const roots = page.locator('.dig-root')
  const count = await roots.count()
  if (count === 0) throw new Error('panel not present for ' + name)
  const target = index === undefined ? roots.first() : roots.nth(index)
  await target.screenshot({ path: join(outDir, name) })
  log('saved ' + name)
}

/** Boots the clean instance into a session whose workspace is the demo repo. */
async function enterSession() {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(7000)
  await clickText('继续')
  await clickText('稍后配置')
  await clickText('新建会话')
  await settle(2000)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  await editor.click({ timeout: 8000 })
  await page.keyboard.type('演示截图会话')
  await page.getByRole('button', { name: '发送消息', exact: true }).first().click({ timeout: 8000 })
  await settle(7000)
}

/** Opens the bottom workbench (the wide chrome) and its Git tab. */
async function openBottomPanel() {
  await clickText('展开底部面板')
  await settle(2500)
  const resize = page.locator('.nArs4W_bottomResize').first()
  if (await resize.count() > 0) {
    const box = await resize.boundingBox()
    if (box !== null) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, Math.max(120, box.y - 320), { steps: 14 })
      await page.mouse.up()
      log('resized the workbench')
      await settle(1200)
    }
  }
  await page.locator('.nArs4W_tabBarPlus').first().click({ timeout: 8000 })
  await settle(1500)
  await page.getByText('Git', { exact: true }).first().click({ timeout: 8000 })
  await settle(6000)
}

try {
  await enterSession()
  await openBottomPanel()

  // 1 — the three-pane workbench: branch tree, commit graph, changes + commit box
  await shot('1-bottom-workbench.png')

  // 2 — the commit context menu
  await page.locator('.dig-commit').nth(2).click({ button: 'right' })
  await settle(1200)
  await shot('2-commit-menu.png')
  await page.keyboard.press('Escape')
  await settle(800)

  // 3 — deleting a branch really deletes it; the toast offers an undo
  const branchRow = page.locator('.dig-tree .dig-row').filter({ hasText: 'feature/search-index' }).first()
  await branchRow.click({ button: 'right' })
  await settle(1200)
  await page.getByText('删除', { exact: true }).first().click({ timeout: 6000 })
  await settle(1200)
  await page.locator('.dig-dialog .dig-btn-danger').first().click({ timeout: 6000 })
  await settle(3000)
  await shot('3-branch-undo.png')
  const undoButton = page.locator('.dig-toast-action').first()
  if (await undoButton.count() > 0) {
    await undoButton.click({ timeout: 6000 })
    await settle(3000)
    log('branch restored through undo')
  }

  // 4 — the action rail settings (reorder + show/hide)
  await page.locator('.dig-rail-settings').first().click({ timeout: 6000 })
  await settle(1500)
  await shot('4-rail-settings.png')
  await page.locator('.dig-dialog .dig-btn-primary').first().click({ timeout: 6000 })
  await settle(1000)

  // 5 — commit details with the per-file diff
  await page.locator('.dig-commit').nth(1).click({ timeout: 6000 })
  await settle(2500)
  const detailFile = page.locator('.dig-detail-files .dig-row').first()
  if (await detailFile.count() > 0) {
    await detailFile.click({ timeout: 6000 })
    await settle(2500)
  }
  await shot('5-commit-detail.png')

  // 6 — the same panel in the native right sidebar (narrow + tall). The workbench
  //     is folded first so exactly one panel root exists on the page.
  await page.keyboard.press('Escape')
  await clickText('折叠底部面板')
  await settle(1500)
  await clickText('打开右侧边栏')
  await settle(3000)
  // A freshly opened right sidebar shows its start page, whose cards open a tab
  // directly — no plus menu involved.
  await page.locator('button:visible').filter({ hasText: /^Git$/ }).last().click({ timeout: 8000 })
  await settle(6000)
  await shot('6-right-sidebar.png')
  log('done')
} finally {
  await browser.close()
}