/**
 * Panes probe (issue #5): drives a RUNNING clean dsh web instance and checks that
 * the three panes are draggable and that their sizes are remembered PER SURFACE.
 *
 * What it asserts, in order:
 *   1. a gutter drag really changes the pane it belongs to;
 *   2. the new size survives a page reload;
 *   3. it survives a new session (the panel remounts and re-reads storage);
 *   4. the wide-and-flat bucket and the tall-and-narrow bucket do not share a
 *      size — the bottom workbench and the right sidebar each keep their own;
 *   5. double-click restores the stylesheet default, the arrow keys nudge;
 *   6. the panel raised no uncaught error along the way.
 *
 *   node scripts/panes-probe.mjs "http://127.0.0.1:3099/?token=…" [out-dir]
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/panes-probe.mjs <web-url-with-token> [out-dir]')
  process.exit(1)
}

const outDir = process.argv[3] === undefined || process.argv[3] === '' ? '/tmp/panes-probe' : process.argv[3]
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
const log = (message) => console.log('[panes] ' + message)
const check = (ok, message) => {
  if (ok) { log('ok   ' + message); return true }
  log('FAIL ' + message)
  failures.push(message)
  return false
}
const settle = (ms) => page.waitForTimeout(ms === undefined ? 900 : ms)

// A crash in the panel is what better-sidebar's error boundary swallows, so every
// uncaught error is a failure even when the assertions below happen to pass.
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

async function enterSession(label) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(7000)
  await clickText('继续')
  await clickText('稍后配置')
  await clickText('新建会话')
  await settle(1800)
  const editor = page.locator('textarea, [contenteditable="true"]').first()
  await editor.click({ timeout: 8000 })
  await page.keyboard.type(label)
  await page.getByRole('button', { name: '发送消息', exact: true }).first().click({ timeout: 8000 })
  await settle(6000)
}

/** The panel lives in the right-sidebar dock; its card carries the tab id.
 *  Creating a session closes that dock and can raise the credential onboarding,
 *  so the way back in is: dismiss the dialog, open the dock, click the card. */
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
  await settle(5000)
  // The panel needs the branch/changes data before a gutter exists at all.
  await page.locator('.dig-body').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(1500)
  return await page.locator('.dig-root:visible').count() > 0
}

/** Everything the assertions need, straight out of the rendered panel. */
async function readState() {
  return page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    }
    // A folded dock keeps its (zero-sized) root around, so take the laid-out one.
    let root = null
    for (const candidate of document.querySelectorAll('.dig-root')) {
      if (candidate.getBoundingClientRect().width > 0) { root = candidate; break }
    }
    if (root === null) return { missing: true }
    const body = root.querySelector('.dig-body')
    const match = body === null ? null : body.className.match(/dig-body-(columns|stack|compact)/)
    const chrome = match === null ? 'none' : match[1]
    const pick = (...selectors) => {
      for (const selector of selectors) {
        const found = root.querySelector(selector)
        if (found !== null) return box(found)
      }
      return null
    }
    const tree = pick('.dig-pane-tree', '.dig-pane-tree-stack', '.dig-compact-tree')
    return {
      panel: box(root),
      body: body === null ? null : box(body),
      chrome: chrome,
      tree: tree,
      changes: pick('.dig-pane-changes', '.dig-pane-changes-stack'),
      main: pick('.dig-pane-main'),
      diff: pick('.dig-diff-pane'),
      gutters: [...root.querySelectorAll('.dig-gutter')].map((gutter) => ({
        vertical: gutter.classList.contains('dig-gutter-v'),
        now: Number(gutter.getAttribute('aria-valuenow')),
        min: Number(gutter.getAttribute('aria-valuemin')),
        max: Number(gutter.getAttribute('aria-valuemax')),
        tabIndex: gutter.getAttribute('tabindex'),
        box: box(gutter),
        next: gutter.nextElementSibling === null ? null : gutter.nextElementSibling.getAttribute('data-pane'),
      })),
      // A divider that occupies no space while still announcing a window of
      // 0..0 is a dead control and must not exist at all (v0.8.0 shipped one in
      // the columns chrome, focusable, with aria-valuenow === aria-valuemax === 0).
      deadGutters: [...root.querySelectorAll('.dig-gutter')].filter((gutter) => {
        const rect = gutter.getBoundingClientRect()
        const now = Number(gutter.getAttribute('aria-valuenow'))
        const max = Number(gutter.getAttribute('aria-valuemax'))
        return rect.width === 0 || rect.height === 0 || (now === 0 && max === 0)
      }).length,
      paneStyles: [...root.querySelectorAll('[data-pane]')].map((node) => node.getAttribute('data-pane') + ':' + String(node.getAttribute('style'))),
      stored: window.localStorage.getItem('dsh-ide-git.panes.v1'),
    }
  })
}

function bucketOf(state) {
  if (state.body === null) return 'none'
  return state.chrome + (state.body.h > state.body.w ? ':tall' : ':wide')
}

const stored = (state) => {
  if (state.stored === null || state.stored === '') return { treeOpen: true, panes: {} }
  try { return JSON.parse(state.stored) } catch (error) { return { parseError: String(error) } }
}

/** One pointer drag on a divider; returns the state after the gesture. */
async function dragGutter(index, delta) {
  const handle = page.locator('.dig-root:visible .dig-gutter').nth(index)
  const rect = await handle.boundingBox()
  if (rect === null) throw new Error('gutter ' + index + ' has no box')
  const vertical = await handle.evaluate((node) => node.classList.contains('dig-gutter-v'))
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(vertical ? x + delta : x, vertical ? y : y + delta, { steps: 10 })
  await settle(200)
  await page.mouse.up()
  await settle(600)
}

/** How far a divider can actually travel from where it is now: the clamp's own
 *  window decides the direction, so the probe never asserts a move the limits
 *  forbid. */
function travel(gutter, current) {
  const up = gutter.max - current
  const down = current - gutter.min
  /* Growth first, however small the window is: a ceiling below the current size
     is exactly the defect this probe hunts, so a cramped panel must still be able
     to give the pane a few pixels. Only a pane that is already AT its ceiling is
     moved the other way, to show the divider still works. */
  if (up >= 8) return Math.min(70, up)
  if (down >= 8) return -Math.min(70, down)
  return 0
}

/** Is an overlay really inside the panel? Invariant 13: every menu, dialog and
 *  toast is positioned inside `.dig-root`, and that includes being no WIDER than
 *  it — a fixed min-width used to beat max-width and push the menu past the
 *  panel's right edge once the panel was dragged narrow. */
async function overlayFit(selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (element === null) return { found: false }
    const root = element.closest('.dig-root')
    if (root === null) return { found: true, within: false, why: 'no .dig-root ancestor' }
    const box = element.getBoundingClientRect()
    const panel = root.getBoundingClientRect()
    const rect = [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)]
    return {
      found: true,
      rect: rect,
      panel: [Math.round(panel.left), Math.round(panel.top), Math.round(panel.width), Math.round(panel.height)],
      within: box.left >= panel.left - 1 && box.top >= panel.top - 1
        && box.right <= panel.right + 1 && box.bottom <= panel.bottom + 1,
    }
  }, selector)
}

const rows = []

/** Invariant 13 under a narrow panel: the overlays are positioned inside
 *  `.dig-root` AND are no wider than it. A fixed min-width used to beat
 *  max-width, so once the panel was dragged narrow the context menu came out
 *  wider than the panel and hung past its right edge. */
async function checkNarrowOverlays(label, width) {
  await page.setViewportSize({ width: width, height: 900 })
  await settle(1800)
  const state = await readState()
  log(label + ': panel ' + state.panel.w + 'x' + state.panel.h + ' chrome=' + state.chrome)
  check(state.chrome === 'compact' && state.panel.w < 400,
    label + ': the panel is narrow enough for the compact chrome (' + state.panel.w + 'px)')
  const rootClass = await page.locator('.dig-root:visible').first().getAttribute('class')
  check(String(rootClass).indexOf('dig-root-narrow') >= 0,
    label + ': the panel marks itself narrow so overlay text wraps instead of clipping')

  const row = page.locator('.dig-root:visible .dig-row').first()
  if (await row.count() > 0) {
    await row.click({ button: 'right' })
    await settle(800)
    const menu = await overlayFit('.dig-menu')
    check(menu.found === true && menu.within === true,
      label + ': the context menu fits inside the panel (menu ' + JSON.stringify(menu.rect) + ' vs panel ' + JSON.stringify(menu.panel) + ')')
    rows.push({ step: label + ' menu', bucket: bucketOf(state), tree: state.tree === null ? 'none' : state.tree.h + 'px', stored: menu.within === true ? 'within root' : 'OVERFLOW' })
    await page.locator('.dig-root').first().screenshot({ path: join(outDir, label.replace(/[^a-z0-9]+/gi, '-') + '-menu.png') })
    await page.keyboard.press('Escape')
    await settle(500)
  } else {
    check(false, label + ': the narrow chrome still renders a branch row to right-click')
  }

  await clickText('新建分支', 1200)
  const dialog = await overlayFit('.dig-dialog')
  check(dialog.found === true && dialog.within === true,
    label + ': the dialog fits inside the panel (dialog ' + JSON.stringify(dialog.rect) + ' vs panel ' + JSON.stringify(dialog.panel) + ')')
  rows.push({ step: label + ' dialog', bucket: bucketOf(state), tree: state.tree === null ? 'none' : state.tree.h + 'px', stored: dialog.within === true ? 'within root' : 'OVERFLOW' })
  if (dialog.found === true) await page.locator('.dig-root').first().screenshot({ path: join(outDir, label.replace(/[^a-z0-9]+/gi, '-') + '-dialog.png') })
  await page.keyboard.press('Escape')
  await settle(400)
}

try {
  await enterSession('拖拽探针 A')
  if (!await ensurePanel()) throw new Error('the panel never opened')
  await settle(1500)

  /* ---------- 1. tall surface: drag, reload, new session ---------- */

  const tall0 = await readState()
  log('tall start: panel ' + tall0.panel.w + 'x' + tall0.panel.h + ' body ' + tall0.body.w + 'x' + tall0.body.h
    + ' chrome=' + tall0.chrome + ' bucket=' + bucketOf(tall0) + ' gutters=' + tall0.gutters.length
    + ' tree=' + (tall0.tree === null ? 'none' : tall0.tree.w + 'x' + tall0.tree.h))
  check(tall0.gutters.length >= 2, 'the tall chrome renders a divider per pane seam (got ' + tall0.gutters.length + ')')
  check(tall0.stored === null, 'a fresh profile starts with no stored pane sizes')
  const tallBucket = bucketOf(tall0)
  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'tall-default.png') })
  rows.push({ step: 'tall default', bucket: tallBucket, tree: tall0.tree.h + 'px', stored: 'none' })

  const first = tall0.gutters[0]
  const delta = travel(first, Math.round(tall0.tree.h))
  check(delta !== 0, 'the tree divider has room to move (current ' + tall0.tree.h + 'px, limits '
    + first.min + '..' + first.max + ')')
  await dragGutter(0, delta)
  const tall1 = await readState()
  const tallMoved = tall1.tree.h - tall0.tree.h
  log('tall after drag ' + delta + ': tree ' + tall0.tree.h + ' -> ' + tall1.tree.h + 'px (limits '
    + tall1.gutters[0].min + '..' + tall1.gutters[0].max + ')')
  check(tallMoved * Math.sign(delta) >= Math.min(20, Math.abs(delta) / 2), 'dragging the divider moved the pane by ' + tallMoved + 'px')
  check(tall1.tree.h >= tall1.gutters[0].min - 2 && tall1.tree.h <= tall1.gutters[0].max + 2,
    'the new height stays inside the clamp (' + tall1.tree.h + ' in ' + tall1.gutters[0].min + '..' + tall1.gutters[0].max + ')')
  const afterDrag = stored(tall1)
  check(afterDrag.panes[tallBucket] !== undefined && typeof afterDrag.panes[tallBucket].tree === 'number',
    'pointerup wrote the new ratio under ' + tallBucket)
  const tallRatio = afterDrag.panes[tallBucket].tree
  check(Math.abs(tallRatio - tall1.tree.h / tall1.body.h) < 0.02,
    'the stored ratio reproduces the rendered height (' + tallRatio.toFixed(3) + ')')
  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'tall-dragged.png') })
  rows.push({ step: 'tall dragged', bucket: tallBucket, tree: tall1.tree.h + 'px', stored: tallRatio.toFixed(3) })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(8000)
  await page.locator('.dig-root:visible').first().waitFor({ timeout: 15000 }).catch(() => {})
  await ensurePanel()
  await settle(1200)
  const tall2 = await readState()
  check(tall2.missing !== true && Math.abs(tall2.tree.h - tall1.tree.h) <= 4,
    'a reload keeps the dragged height (' + tall1.tree.h + ' -> ' + (tall2.missing === true ? 'no panel' : tall2.tree.h) + 'px)')
  rows.push({ step: 'after reload', bucket: bucketOf(tall2), tree: tall2.missing === true ? 'no panel' : tall2.tree.h + 'px', stored: 'kept' })

  await clickText('新建会话', 2000)
  await settle(1500)
  await ensurePanel()
  await settle(1200)
  const tall3 = await readState()
  check(tall3.missing !== true && Math.abs(tall3.tree.h - tall1.tree.h) <= 4,
    'a new session keeps it too (' + (tall3.missing === true ? 'no panel' : tall3.tree.h) + 'px)')
  rows.push({ step: 'new session', bucket: bucketOf(tall3), tree: tall3.missing === true ? 'no panel' : tall3.tree.h + 'px', stored: 'kept' })

  /* ---------- 2. wide-and-flat surface: its own bucket ---------- */

  // 1600x520 is the size the reported bug was reproduced at: a 674-719px column
  // where 200 + 290 + 240 cannot all hold, so the old ceiling came out BELOW the
  // tree's own 201 and the first drag to the right dragged it down to 141.
  await page.setViewportSize({ width: 1600, height: 520 })
  await settle(1800)
  const wide0 = await readState()
  log('wide start: panel ' + wide0.panel.w + 'x' + wide0.panel.h + ' body ' + wide0.body.w + 'x' + wide0.body.h
    + ' chrome=' + wide0.chrome + ' bucket=' + bucketOf(wide0) + ' tree=' + wide0.tree.w + 'x' + wide0.tree.h)
  const wideBucket = bucketOf(wide0)
  check(wideBucket !== tallBucket, 'the flat surface gets a different bucket (' + wideBucket + ')')
  check(wideBucket.slice(-5) === ':wide', 'a panel wider than it is tall is the :wide bucket')
  const wideStored = stored(wide0)
  check(wideStored.panes[tallBucket] !== undefined && wideStored.panes[wideBucket] === undefined,
    'the wide bucket starts empty while the tall one stays stored')
  check(wideStored.panes[tallBucket].tree === tallRatio, 'and its stored ratio is untouched')
  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'wide-default.png') })
  rows.push({ step: 'wide default', bucket: wideBucket, tree: wide0.tree.w + 'px', stored: 'none (own bucket)' })

  const wideFirst = wide0.gutters[0]
  check(wide0.deadGutters === 0, 'no dead divider in the columns chrome (' + wide0.deadGutters + ' found)')
  check(wideFirst.now <= wideFirst.max && wideFirst.now >= wideFirst.min,
    'the divider announces a window it is actually inside (now ' + wideFirst.now + ' in ' + wideFirst.min + '..' + wideFirst.max + ')')
  // The pane must still have ROOM TO GROW here: a ceiling at or below the box it
  // already occupies is the pinning bug, not a clamp.
  check(wideFirst.max > Math.round(wide0.tree.w) + 8,
    'the column ceiling leaves room to grow (' + wide0.tree.w + 'px wide, ceiling ' + wideFirst.max + ')')
  const wideDelta = travel(wideFirst, Math.round(wide0.tree.w))
  check(wideDelta > 0, 'and the probe therefore drags it WIDER (delta ' + wideDelta + ')')
  await dragGutter(0, wideDelta)
  const wide1 = await readState()
  const wideMoved = wide1.tree.w - wide0.tree.w
  log('wide after drag ' + wideDelta + ': tree width ' + wide0.tree.w + ' -> ' + wide1.tree.w + 'px (limits '
    + wide1.gutters[0].min + '..' + wide1.gutters[0].max + ')')
  check(wideMoved >= Math.max(8, wideDelta - 4), 'dragging right GREW the tree by ' + wideMoved + 'px (never shrank it)')
  check(wide1.gutters[0].now <= wide1.gutters[0].max && wide1.gutters[0].now >= wide1.gutters[0].min,
    'and the aria window stayed consistent (now ' + wide1.gutters[0].now + ' in ' + wide1.gutters[0].min + '..' + wide1.gutters[0].max + ')')
  const wideStore = stored(wide1)
  check(wideStore.panes[wideBucket] !== undefined, 'the wide drag was stored under ' + wideBucket)
  check(wideStore.panes[tallBucket].tree === tallRatio, 'the tall bucket was not touched by the wide drag')
  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'wide-dragged.png') })
  rows.push({ step: 'wide dragged', bucket: wideBucket, tree: wide1.tree.w + 'px', stored: wideStore.panes[wideBucket].tree.toFixed(3) })

  // The other seam of the same chrome: the changes column, dragged the other way.
  if (wide1.gutters.length >= 2 && wide1.changes !== null) {
    const changesDelta = travel(wide1.gutters[1], Math.round(wide1.changes.w))
    check(changesDelta !== 0, 'the changes divider has room to move (limits '
      + wide1.gutters[1].min + '..' + wide1.gutters[1].max + ')')
    // `side: next` again: the pane sits to the RIGHT of the divider, so the screen
    // delta that grows it is the negative one.
    await dragGutter(1, -changesDelta)
    const wide2 = await readState()
    const changesMoved = wide2.changes.w - wide1.changes.w
    check(changesMoved * Math.sign(changesDelta) >= Math.max(5, Math.abs(changesDelta) - 6),
      'the main↔changes divider resizes the changes column (' + wide1.changes.w + ' -> ' + wide2.changes.w + 'px)')
    check(stored(wide2).panes[wideBucket].changes !== undefined, 'and it is stored under the same bucket')
    rows.push({ step: 'wide changes dragged', bucket: wideBucket, tree: wide2.tree.w + 'px', stored: 'tree+changes' })
  }

  /* ---------- 3. back to the tall surface: the two buckets are independent ---------- */

  await page.setViewportSize({ width: 1500, height: 1000 })
  await settle(1800)
  const tall4 = await readState()
  check(tall4.missing !== true && Math.abs(tall4.tree.h - tall1.tree.h) <= 4,
    'the tall surface still has its own height (' + tall1.tree.h + ' -> ' + (tall4.missing === true ? 'no panel' : tall4.tree.h) + 'px)')
  check(bucketOf(tall4) === tallBucket, 'and it is back in the ' + tallBucket + ' bucket')
  rows.push({ step: 'back to tall', bucket: bucketOf(tall4), tree: tall4.missing === true ? 'no panel' : tall4.tree.h + 'px', stored: 'tall kept' })

  /* ---------- 4. reset and keyboard ---------- */

  await page.locator('.dig-root:visible .dig-gutter').first().dblclick({ timeout: 6000 })
  await settle(800)
  const reset = await readState()
  const cssDefault = Math.round(tall4.body.h * 0.36)
  check(reset.tree.h <= cssDefault + 4 && reset.tree.h < tall4.tree.h,
    'double-click returns the pane to the stylesheet default (' + tall4.tree.h + ' -> ' + reset.tree.h + 'px, cap ' + cssDefault + ')')
  const resetStore = stored(reset)
  check(resetStore.panes[tallBucket] === undefined || resetStore.panes[tallBucket].tree === undefined,
    'and the override is dropped from storage')
  rows.push({ step: 'after double-click', bucket: tallBucket, tree: reset.tree.h + 'px', stored: 'reset' })

  const handle = page.locator('.dig-root:visible .dig-gutter').first()
  await handle.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await settle(600)
  const nudged = await readState()
  check(Math.abs((nudged.tree.h - reset.tree.h) - 16) <= 3,
    'ArrowDown nudges by 8px per press (' + reset.tree.h + ' -> ' + nudged.tree.h + 'px)')
  check(stored(nudged).panes[tallBucket] !== undefined, 'a keyboard nudge is persisted immediately')
  rows.push({ step: 'after two ArrowDown', bucket: tallBucket, tree: nudged.tree.h + 'px', stored: 'kept' })

  await page.locator('.dig-root').first().screenshot({ path: join(outDir, 'tall-nudged.png') })

  /* ---------- 4b. the history↔diff divider really resizes the diff ---------- */

  await page.setViewportSize({ width: 1500, height: 1000 })
  await settle(1800)
  const row = page.locator('.dig-root:visible .dig-changes-list .dig-row-file').first()
  check(await row.count() > 0, 'the changes pane offers a file to diff')
  if (await row.count() > 0) {
    await row.click({ timeout: 8000 })
    await settle(2500)
  }
  const diff0 = await readState()
  log('diff: chrome=' + diff0.chrome + ' diff=' + (diff0.diff === null ? 'none' : diff0.diff.h + 'px')
    + ' dividers=' + diff0.gutters.length + ' dead=' + diff0.deadGutters)
  check(diff0.diff !== null, 'opening a file renders the diff pane')
  check(diff0.deadGutters === 0, 'and no dead divider appeared with it (' + diff0.deadGutters + ')')
  const diffGutterIndex = diff0.gutters.map((entry) => entry.next).indexOf('diff')
  check(diffGutterIndex >= 0, 'the diff pane has its own divider (index ' + diffGutterIndex + ')')
  if (diff0.diff !== null && diffGutterIndex >= 0) {
    const handle = diff0.gutters[diffGutterIndex]
    const diffDelta = travel(handle, Math.round(diff0.diff.h))
    check(handle.max > handle.min, 'the diff divider has a usable window (' + handle.min + '..' + handle.max + ')')
    check(diffDelta !== 0, 'and the probe found a direction to move it (' + diffDelta + ')')
    // The diff divider is a `side: next` one (the pane it sizes sits BELOW it), so
    // a screen drag upwards is what grows the diff.
    await dragGutter(diffGutterIndex, -diffDelta)
    const diff1 = await readState()
    const moved = diff1.diff === null ? 0 : diff1.diff.h - diff0.diff.h
    log('diff after drag ' + diffDelta + ': height ' + diff0.diff.h + ' -> ' + (diff1.diff === null ? 'gone' : diff1.diff.h)
      + 'px, style=' + JSON.stringify(diff1.paneStyles.filter((entry) => entry.indexOf('diff:') === 0)))
    check(moved * Math.sign(diffDelta) >= Math.max(5, Math.abs(diffDelta) - 6),
      'dragging the diff divider really resized it by ' + moved + 'px (wanted ' + diffDelta + ')')
    check(diff1.paneStyles.some((entry) => entry.indexOf('diff:height:') === 0 || entry.indexOf('diff: height:') >= 0),
      'the diff pane carries the inline size the drag wrote')
    const diffStore = stored(diff1)
    check(diffStore.panes[tallBucket] !== undefined && typeof diffStore.panes[tallBucket].diff === 'number',
      'and pointerup stored the diff ratio under ' + tallBucket)
    rows.push({ step: 'diff divider', bucket: tallBucket, tree: diff1.diff === null ? 'gone' : diff1.diff.h + 'px', stored: 'diff kept' })
  }

  /* ---------- 5. the narrow panel: overlays must still fit inside it ---------- */

  await checkNarrowOverlays('narrow', 380)
  // ...and narrower than the menu's own minimum width, which is where a fixed
  // min-width used to win over max-width and push the menu out of the panel.
  await checkNarrowOverlays('tiny', 200)
} catch (error) {
  log('FAILED: ' + String(error.message).slice(0, 400))
  failures.push(String(error.message).slice(0, 200))
} finally {
  console.log('\nstep                  | bucket        | tree    | storage')
  console.log('----------------------|---------------|---------|------------------')
  for (const row of rows) {
    console.log(row.step.padEnd(21) + ' | ' + String(row.bucket).padEnd(13) + ' | ' + String(row.tree).padEnd(7) + ' | ' + row.stored)
  }
  if (pageErrors.length > 0) {
    log('FAILED: ' + pageErrors.length + ' uncaught error(s)')
    for (const line of pageErrors.slice(0, 5)) log('  ' + line.slice(0, 200))
    failures.push('pageerror')
  }
  if (failures.length > 0) {
    log('RESULT: ' + failures.length + ' failure(s)')
    process.exitCode = 1
  } else {
    log('RESULT: all pane assertions passed, zero page errors')
  }
  await browser.close()
}
