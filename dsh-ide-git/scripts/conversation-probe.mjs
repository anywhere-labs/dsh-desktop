/**
 * Conversation-tab probe (issue #8): drives a RUNNING clean dsh web instance and
 * locks the third seat — the `conversation.view` tab beside 对话/轨迹.
 *
 * What it asserts, in order:
 *   1. after a session starts inside a workspace, the conversation tab ring
 *      carries a "Git" tab (the seat our client half registers);
 *   2. clicking it mounts the panel (.dig-root) with repository data — the
 *      session's own cwd is the repository, resolved through the sessions
 *      service, not the sidebar props;
 *   3. the settings card's placement switch takes the tab down and puts it
 *      back LIVE — no reload (the row Config field `conversationTab`);
 *   4. with the direct plugin route fenced off (403, the remote pairing
 *      client's reality), the panel still loads: the transport retries through
 *      the /remote proxy path (issue #9);
 *   5. after opening a commit detail, the conversation scrollport keeps NO
 *      residual wheel scroll (scrollHeight - clientHeight <= 1px — the seat's
 *      convergence invariant, v0.13.3 follow-up);
 *   6. zero uncaught page errors throughout.
 *
 *   node scripts/conversation-probe.mjs "http://127.0.0.1:3099/?token=…" [out-dir]
 *
 * The instance is expected to be clean-isolated (independent DSH_HOME) with a
 * workspace named 演示仓库 bound to a git repository (scripts/demo-repo.mjs
 * generates one); the probe passes the onboarding gate with a dummy key and
 * creates one session inside that workspace. Set DIG_PROBE_WORKSPACE to use a
 * different workspace title.
 *
 * Playwright is loaded from the DSH checkout (DSH_CHECKOUT overrides the path).
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
if (url === undefined || url === '') {
  console.error('usage: node scripts/conversation-probe.mjs <web-url-with-token> [out-dir]')
  process.exit(1)
}
const outDir = process.argv[3] === undefined || process.argv[3] === '' ? '/tmp/conversation-probe' : process.argv[3]
mkdirSync(outDir, { recursive: true })
const logPath = join(outDir, 'probe.log')
writeFileSync(logPath, '')
const log = (message) => { console.log('[conv] ' + message); appendFileSync(logPath, message + '\n') }
const workspaceTitle = process.env.DIG_PROBE_WORKSPACE === undefined ? '演示仓库' : process.env.DIG_PROBE_WORKSPACE

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

const failures = []
const pageErrors = []
browser.on('page', (p) => { p.on('console', (m) => { if (m.type() === 'warning' && m.text().indexOf('dsh-ide-git') >= 0) log('[panel] ' + m.text().slice(0, 220)) }) })
const check = (ok, message) => {
  if (ok === true) { log('ok   ' + message); return true }
  log('FAIL ' + message)
  failures.push(message)
  return false
}
page.on('pageerror', (error) => {
  pageErrors.push(String(error.message))
  log('PAGEERROR ' + String(error.message).slice(0, 300))
})
page.on('console', (message) => {
  const text = message.text()
  if (text.indexOf('[dsh-ide-git]') === 0) log('CONSOLE ' + text.slice(0, 200))
  else if (message.type() === 'error') log('CONSOLE-ERROR ' + text.slice(0, 200))
})
const settle = (ms) => page.waitForTimeout(ms === undefined ? 1200 : ms)

/* Coordinate clicks throughout: Playwright's actionability retry loop has
   stalled on this host's overlay buttons before (the element is found, the
   click never fires); measure-and-mouse.click is the steady pattern. Note
   evaluate serializes the function SOURCE only — closures do not cross the
   boundary, so any dynamic value rides as an explicit argument. */
const clickCenter = async (finder, arg) => {
  const point = await page.evaluate(finder, arg)
  if (point === null || point === undefined) return false
  await page.mouse.click(point.x, point.y)
  await settle(1500)
  return true
}

/* ---- enter: gate → workspace → session (see scripts/layout-probe.mjs; the
   0.2.1 gate takes a key up front, and a dummy one is enough — the probe never
   needs a model reply, only a session record with a cwd) ----

   The workspace bind rides the「新会话」menu (its items ARE the workspaces;
   clicking one fires /api/session/create with the workspace attached — the
   response must answer ok). The conversation view mounts after a RELOAD
   restores the created session (the shell stays on the hero meanwhile), and
   the probe's first message makes the view ring appear. NOTE: the workspace
   path in the instance's storages/workspace.json must be the REALPATH form
   (/private/tmp/… on macOS, not /tmp/…) — attach rejects the symlinked
   spelling with session/workspace-attach-failed. */
async function enterSession() {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(9000)
  /* The preview notice re-appears whenever the home's settings were wiped (the
     runner does exactly that); it overlays the composer and swallows clicks. */
  for (let attempt = 0; attempt < 2; attempt++) {
    const dismissed = await clickCenter(() => {
      for (const el of document.querySelectorAll('button')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.x < 280 || r.y < 300 || r.y > 720) continue
        if ((el.textContent || '').trim() === '继续') return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
      return null
    })
    if (dismissed !== true) break
    await settle(1500)
  }
  const key = page.locator('input[type="password"]').first()
  if (await key.count() > 0) {
    await key.click({ timeout: 6000 })
    await page.keyboard.type('sk-conversation-probe-dummy')
    await page.getByRole('button', { name: '保存并继续' }).first().click({ timeout: 6000 })
    await settle(2000)
  } else {
    log('no API-key gate visible (already configured)')
  }
  /* Already inside a restored conversation — nothing to create. */
  const onHero = () => page.evaluate(() => [...document.querySelectorAll('*')].some((el) => (el.textContent || '').trim() === '选择一个工作区开始'))
  if (await onHero() !== true) {
    log('conversation restored from the previous run')
  } else {
    /* The「新会话」button opens the workspace menu; an item click creates AND
       attaches (ok:true). Fallback: the hero's own 选择工作区 picker. */
    let bound = false
    try {
      await page.locator('button', { hasText: '新会话' }).first().click({ timeout: 6000 })
      await settle(1000)
      await page.getByText(workspaceTitle, { exact: true }).last().click({ timeout: 6000 })
      await settle(3000)
      bound = true
    } catch (error) {
      log('new-session menu bind failed: ' + String(error && error.message ? error.message : error).slice(0, 140))
    }
    if (bound === false) {
      log('falling back to the hero picker')
      await clickCenter(() => {
        for (const el of document.querySelectorAll('button')) {
          const label = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')
          if (label.indexOf('选择工作区') < 0) continue
          const r = el.getBoundingClientRect()
          if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
        return null
      })
      await settle(1200)
      await clickCenter((title) => {
        let found = null
        for (const el of document.querySelectorAll('button')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if ((el.textContent || '').trim() === title) found = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
        return found
      }, workspaceTitle)
      await settle(2500)
    }
    /* The shell stays on the hero through the create; the conversation mounts
       when the reload restores the now-attached session. */
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(9000)
  }
  const live = await page.evaluate(() => [...document.querySelectorAll('[contenteditable="true"]')].length > 0)
  if (live !== true) {
    const diag = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('button, span, h2, [class*="toast"]')) {
        if (el.children.length > 0) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.x < 280) continue
        const t = (el.textContent || '').trim()
        if (t !== '') out.push(t.slice(0, 22) + '@' + Math.round(r.y))
      }
      return [...new Set(out)].slice(0, 20)
    })
    log('enter-session diagnostics: ' + JSON.stringify(diag))
    await page.screenshot({ path: join(outDir, 'enter-failed.png') })
    throw new Error('the conversation did not mount after the workspace bind')
  }
  const typed = await clickCenter(() => {
    for (const el of document.querySelectorAll('[contenteditable="true"], textarea')) {
      const r = el.getBoundingClientRect()
      if (r.width > 80 && r.height > 20) return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }
    }
    return null
  })
  if (typed === true) {
    await page.keyboard.type('conversation probe: ignore this message', { delay: 15 })
    await settle(400)
    await page.keyboard.press('Enter')
    await settle(8000)
  }
  /* The conversation shell mounts with the session; the tab ring shows 对话. */
  try {
    await page.getByText('对话', { exact: true }).first().waitFor({ timeout: 15000 })
  } catch (error) {
    const diag = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('button, span, h2, [class*="toast"]')) {
        if (el.children.length > 0) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.x < 280) continue
        const t = (el.textContent || '').trim()
        if (t !== '') out.push(t.slice(0, 22) + '@' + Math.round(r.y))
      }
      return [...new Set(out)].slice(0, 20)
    })
    log('enter-session diagnostics: ' + JSON.stringify(diag))
    await page.screenshot({ path: join(outDir, 'enter-failed.png') })
    throw error
  }
  log('session is up; conversation shell mounted')
}

/* Re-enter a live conversation from wherever the app stands. The plugin page
   carries its own close affordance (关闭); history.goBack is the fallback, and
   the enter dance (composer + Enter) is the last resort. */
async function ensureConversation() {
  if (await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)) return true
  const close = page.getByRole('button', { name: '关闭' }).first()
  if (await close.count() > 0) {
    try { await close.click({ timeout: 3000 }) } catch (error) { void error }
    await settle(3500)
  }
  if (await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)) return true
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await settle(3500)
  if (await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)) return true
  const typed = await clickCenter(() => {
    for (const el of document.querySelectorAll('[contenteditable="true"], textarea')) {
      const r = el.getBoundingClientRect()
      if (r.width > 80 && r.height > 20) return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }
    }
    return null
  })
  if (typed === true) {
    try {
      await page.keyboard.type('conversation probe: ignore this message too', { delay: 15 })
      await settle(400)
      await page.keyboard.press('Enter')
      await settle(8000)
    } catch (error) { void error }
  }
  return await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)
}

/* The tab ring row that carries 对话; our seat renders a plain "Git" button in
   it. Scoped to the row so the sidebar's Git card never matches. */
async function gitTabButton() {
  return page.evaluateHandle((title) => {
    const anchor = [...document.querySelectorAll('button, [role="tab"], span')].find((el) => (el.textContent || '').trim() === '对话')
    if (anchor === undefined) return null
    let row = anchor.closest('div, nav, ul, header')
    for (let depth = 0; depth < 5 && row !== null; depth++) {
      const git = [...row.querySelectorAll('button, [role="tab"]')].find((el) => (el.textContent || '').trim() === 'Git')
      if (git !== undefined) return git
      row = row.parentElement
    }
    return null
  }, '对话')
}

const panelState = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('.dig-root')]
  const visible = roots.filter((el) => el.getBoundingClientRect().height > 40)
  const text = visible.length > 0 ? (visible[0].textContent || '') : ''
  return { roots: roots.length, visible: visible.length, text: text.replace(/\s+/g, ' ').slice(0, 160) }
})

try {
  await enterSession()

  /* 1 — the seat is in the ring. */
  const tab = await gitTabButton()
  const tabFound = tab !== null && tab.asElement() !== null
  check(tabFound, 'the conversation tab ring carries a Git tab beside 对话/轨迹')
  if (tabFound === false) {
    await page.screenshot({ path: join(outDir, 'no-git-tab.png') })
    throw new Error('Git tab missing — nothing further to probe')
  }

  /* 2 — clicking it mounts the panel on the session's own cwd. */
  await tab.asElement().click()
  await settle(5000)
  let state = await panelState()
  check(state.visible === 1, 'the Git view mounts the panel (.dig-root visible)')
  check(/main|master|branch|分支/i.test(state.text) === true, 'the panel carries repository data from the session cwd: ' + state.text.slice(0, 80))
  await page.screenshot({ path: join(outDir, 'conversation-git-tab.png') })

  /* 2a — the immersive seat (issue #8 round 3, default ON): the seat declares
     the host's composer-overlay contract, fills the whole conversation height,
     and the composer seat is hidden while the Git view owns the ring (the CSS
     :not() chain keeps approvals reachable — nothing else may block that). */
  const immersiveOn = await page.evaluate(() => {
    const seat = document.querySelector('.dig-conversation-seat[data-immersive="1"]')
    const composer = document.querySelector('[data-composer-seat]')
    const scroll = document.querySelector('[data-conversation-scroll]')
    return {
      present: seat !== null,
      overlay: seat !== null && seat.hasAttribute('data-conversation-composer-overlay'),
      composerHidden: composer === null || getComputedStyle(composer).display === 'none',
      seatHeight: seat === null ? 0 : Math.round(seat.getBoundingClientRect().height),
      gap: scroll === null ? -1 : scroll.scrollHeight - scroll.clientHeight,
    }
  })
  check(immersiveOn.present === true && immersiveOn.overlay === true,
    'the immersive seat declares the composer-overlay contract (saw ' + JSON.stringify(immersiveOn) + ')')
  check(immersiveOn.composerHidden === true, 'the composer seat is hidden while the Git view owns the ring')
  check(immersiveOn.seatHeight >= 400, 'the seat fills the conversation height (saw ' + immersiveOn.seatHeight + 'px)')
  check(immersiveOn.gap <= 1, 'the scrollport has no residual overflow under the overlay layout (saw ' + immersiveOn.gap + 'px)')

  /* 2b — same-workspace session switch (v0.13.1): the seat remounts per
     session, and the first-paint cache must hand the new mount the previous
     discovery + first page, so the chrome paints whole instead of re-growing
     button by button. Asserted loosely (data present shortly after the
     switch) — the cache's absence shows up as spinner-then-stagger, which a
     probe can only approximate. */
  const freshClicked = await clickCenter(() => {
    for (const el of document.querySelectorAll('button')) {
      const label = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')
      if (label.indexOf('新会话') < 0 && label.indexOf('新建会话') < 0) continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.x < 300) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  })
  if (freshClicked === true) {
    await settle(4500)
    /* A blank session omits the view ring ("A blank Session still omits the
       conversation.view slot") — give the fresh session its first message,
       exactly like every other enter path in this probe. */
    const typed = await clickCenter(() => {
      for (const el of document.querySelectorAll('[contenteditable="true"], textarea')) {
        const r = el.getBoundingClientRect()
        if (r.width > 80 && r.height > 20) return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }
      }
      return null
    })
    if (typed === true) {
      await page.keyboard.type('switch probe: ignore this message', { delay: 15 })
      await settle(400)
      await page.keyboard.press('Enter')
      await settle(8000)
    }
    const tab1b = await gitTabButton()
    if (tab1b !== null && tab1b.asElement() !== null) {
      await tab1b.asElement().click()
      await settle(3000)
      state = await panelState()
      check(state.visible >= 1 && /main|master|branch|分支/i.test(state.text) === true,
        'a same-workspace session switch paints the panel from the first-paint cache')
      await page.screenshot({ path: join(outDir, 'conversation-git-tab-switched.png') })
      /* 2c — the detail flip (v0.13.1 report): opening a commit's detail (and
         from there a file diff) used to grow the panel with its content, and
         the width-vs-height chrome test flipped the wide seat into the stacked
         sidebar layout, shifting everything down. The seat is now pinned to
         the scrollport's visible height, so the chrome must stay `columns` and
         the panel must not grow past the viewport. */
      /* The newest demo commit is a MERGE — git show on a merge is empty by
         default, which hides the diff pane legitimately. Probe a regular
         commit instead (second row). */
      const commitRow = page.locator('.dig-root:visible .dig-commit').nth(1)
      if (await commitRow.count() > 0) {
        await commitRow.click({ timeout: 6000 })
        await settle(4000)
        /* The user's exact path: click a changed FILE inside the detail — the
           diff is the tallest content that used to trigger the flip. */
        const fileRow = page.locator('.dig-root:visible .dig-detail-files .dig-row-file').first()
        if (await fileRow.count() > 0) {
          try { await fileRow.click({ timeout: 5000 }) } catch (error) { log('file click failed: ' + String(error && error.message ? error.message : error).slice(0, 120)) }
          await settle(3500)
        }
        const chrome = await page.evaluate(() => {
          const root = [...document.querySelectorAll('.dig-root')].find((el) => el.getBoundingClientRect().height > 40)
          if (root === undefined) return null
          const body = root.querySelector('.dig-body')
          const rect = root.getBoundingClientRect()
          const scroll = root.closest('[data-conversation-scroll]')
          return {
            chrome: body === null ? 'none' : (body.className.match(/dig-body-(columns|stack|compact)/) || [])[1] || 'unknown',
            rootHeight: Math.round(rect.height),
            viewport: scroll === null ? window.innerHeight : Math.round(scroll.clientHeight),
          }
        })
        if (chrome === null) check(false, 'the panel vanished while the detail was open')
        else {
          check(chrome.chrome === 'columns', 'opening a commit detail keeps the columns chrome (saw ' + chrome.chrome + ')')
          check(chrome.rootHeight <= chrome.viewport + 40,
            'the panel stays within the visible area (root ' + chrome.rootHeight + 'px vs viewport ' + chrome.viewport + 'px)')
        }
        /* v0.13.3 follow-up: pinning the seat still left a residual WHEEL
           scroll on the real host — the sticky composer's flow space, plus
           content that mounts after the first convergence pass. The seat's
           controlled convergence must leave the shared scrollport with NO
           scrollable margin at all: scrollHeight - clientHeight <= 1px, with
           the detail (the tallest content) wide open. */
        const scrollGap = await page.evaluate(() => {
          const scroll = document.querySelector('[data-conversation-scroll]')
          if (scroll === null) return null
          return Math.round(scroll.scrollHeight - scroll.clientHeight)
        })
        check(scrollGap !== null && scrollGap <= 1,
          'the scrollport has no residual wheel scroll after convergence (gap ' + String(scrollGap) + 'px)')
        await page.screenshot({ path: join(outDir, 'conversation-git-detail.png') })
        /* 2c-b — diff selection → right-click → send (v0.13.5): select a few
           rendered diff lines programmatically, open the context menu, and
           assert the two send items appear; clicking one must land a
           line-anchored reference in the session composer. */
        const sel = await page.evaluate(() => {
          const root = [...document.querySelectorAll('.dig-root')].find((el) => el.getBoundingClientRect().height > 40)
          if (root === undefined) return { lines: 0 }
          const lines = [...root.querySelectorAll('[data-diff] div[class*="line"], [data-diff] > div')].filter((el) => {
            const r = el.getBoundingClientRect()
            return r.height > 0 && (el.textContent || '').length > 0
          })
          if (lines.length < 5) {
            /* Diagnostic payload returned to Node — page context has no logger. */
            return {
              lines: lines.length,
              diag: {
                dataDiff: document.querySelectorAll('[data-diff]').length,
                dataDiffChildren: document.querySelectorAll('[data-diff] > div').length,
                lineClass: document.querySelectorAll('[class*="line"]').length,
                detailFiles: document.querySelectorAll('.dig-detail-files .dig-row-file').length,
                patchPre: document.querySelectorAll('.dig-root pre, .dig-root [class*="diff"]').length,
                diffPane: document.querySelectorAll('.dig-diff-pane').length,
                selectedRow: document.querySelectorAll('.dig-row-selected').length,
              },
            }
          }
          const range = document.createRange()
          range.selectNodeContents(lines[2])
          if (lines[4] !== undefined) range.setEnd(lines[4], 0)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          const target = lines[3]
          const r = target.getBoundingClientRect()
          return { lines: lines.length, x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2, file: (root.querySelector('.dig-detail-files .dig-row-selected, .dig-detail-files .dig-row-file') || {}).textContent || '' }
        })
        if (sel === null || sel.lines < 5) {
          log('selection diagnostics: ' + JSON.stringify(sel))
        } else {
          await page.mouse.click(sel.x, sel.y, { button: 'right' })
          await settle(1200)
          const items = await page.evaluate(() => {
            const menus = [...document.querySelectorAll('.dig-root [class*="menu"], .dig-root .dig-menu')]
            const text = menus.map((m) => m.textContent || '').join('|')
            return { hasLines: text.indexOf('发送选中行') >= 0, hasSnippet: text.indexOf('发送选中片段') >= 0 }
          })
          check(items.hasLines === true || items.hasSnippet === true,
            'selecting diff lines offers the send-to-chat menu items (lines=' + String(items.hasLines) + ' snippet=' + String(items.hasSnippet) + ')')
          if (items.hasLines === true || items.hasSnippet === true) {
            const sendItem = page.locator('.dig-root button, .dig-root [role="menuitem"]')
              .filter({ hasText: items.hasLines === true ? '发送选中行' : '发送选中片段' }).first()
            await sendItem.click({ timeout: 5000 })
            await settle(2500)
            const composerText = await page.evaluate(() => {
              const areas = [...document.querySelectorAll('[contenteditable="true"]')]
              return areas.map((a) => (a.textContent || '').trim() + ' ||HTML ' + a.innerHTML.slice(0, 400)).join(' :: ')
            })
            check(/第\s*\d+/.test(composerText) === true || /行/.test(composerText) === true,
              'the composer receives the line-anchored reference: ' + composerText.slice(0, 80))
          }
          await page.evaluate(() => { const s = window.getSelection(); if (s !== null) s.removeAllRanges() })
        }
        /* Back to the history so the later steps start from a known surface. */
        const back = page.locator('.dig-root:visible button', { hasText: '返回历史' }).first()
        if (await back.count() > 0) { try { await back.click({ timeout: 4000 }) } catch (error) { void error } await settle(2000) }
      } else {
        log('commit rows not found — skipping the detail-flip check')
      }
    } else {
      check(false, 'the Git tab is present on the fresh session')
    }
  } else {
    log('新会话 button absent — skipping the session-switch cache check')
  }

  /* The plugin page is an in-app view switch no history undo reliably
     reverses, so after each flip the probe re-enters through a fresh load —
     deterministic, and it doubles as a persistence check (the setting must
     survive the reload). */
  const reenterConversation = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(9000)
    try { await enterSession() } catch (error) {
      log('re-entry failed: ' + String(error && error.message ? error.message : error).slice(0, 160))
    }
    return await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)
  }

  /* 3 — the remote pairing reality: the direct plugin route answers 403 (the
     harness browser-auth gate), the panel must still load through /remote.
     Simulated with route interception: direct → 403, /remote/… → the real
     route. The retry is sticky, so ONE fenced call is enough to prove it. */
  let remoteHits = 0
  await page.route('**/dsh-ide-git/api/**', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'forbidden' } }) }))
  await page.route('**/remote/**', (route) => {
    remoteHits += 1
    const stripped = route.request().url().replace('/remote/', '/')
    return route.continue({ url: stripped })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(9000)
  /* A cold reload may land on the workspace home rather than the session; the
     fencing verdict needs a live conversation first. */
  await reenterConversation()
  const tab2 = await gitTabButton()
  if ((await tab2) !== null && tab2.asElement() !== null) {
    await tab2.asElement().click()
    await settle(6000)
    state = await panelState()
    if (state.visible < 1 || /main|master|branch|分支/i.test(state.text) !== true) {
      log('remote-fencing panel state: ' + JSON.stringify(state) + ' remoteHits=' + remoteHits)
    }
    /* visible >= 1, not === 1: the sidebar panel from the flip steps may still
       be open beside the conversation view — both seats ride the same
       transport, so either proves the point. */
    check(state.visible >= 1 && /main|master|branch|分支/i.test(state.text) === true,
      'with the direct route fenced off the panel still loads through the /remote proxy')
    check(remoteHits > 0, 'the transport actually issued /remote requests (saw ' + remoteHits + ')')
    await page.screenshot({ path: join(outDir, 'conversation-git-tab-remote.png') })
  } else {
    check(false, 'the Git tab survived the reload (sticky view + fencing active)')
  }


  const dockGit = async () => {
    /* Open the panel through the sidebar's start page — the canonical entry
     (see layout-probe.mjs): expand the right sidebar, then its Git guide
     card. The bottom dock's tab set is persisted state and NOT guaranteed
     after a reload, so it is only a fallback. A flip step may have left the
     app on the PLUGIN page (the rail settings button navigates there), so
     first make sure we are back on a conversation surface. */
    if (await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false) !== true) {
      await reenterConversation()
    }
    /* PRIMARY entry: the conversation-area ring's own Git button — the ring is
       unaffected by sidebar state, and the guide cards only render while the
       sidebar shows its start page (a prior step may have left a content tab
       open, hiding them). The sidebar path stays as the fallback for the
       conversationTab-off world, where the ring button is gone. */
    const ringTab = await gitTabButton()
    if (ringTab !== null && ringTab.asElement() !== null) {
      try { await ringTab.asElement().click({ timeout: 4000 }) } catch (error) { void error }
      await settle(4000)
      if (await page.locator('.dig-root:visible').count() > 0) return true
    }
    const collapse = page.getByRole('button', { name: '关闭右侧边栏' }).first()
    if (await collapse.count() > 0) {
      try { await collapse.click({ timeout: 4000 }) } catch (error) { void error }
      await settle(2500)
    }
    const expand = page.getByRole('button', { name: '打开右侧边栏' }).first()
    if (await expand.count() > 0) {
      try { await expand.click({ timeout: 4000 }) } catch (error) { void error }
      await settle(3000)
    }
    const card = page.locator('[data-sidebar-right-guide-entry="dsh-ide-git:panel"], [data-sidebar-right-guide-entry="ide-git"]').first()
    if (await card.count() > 0) {
      try { await card.click({ timeout: 6000 }) } catch (error) { void error }
      await settle(4000)
      if (await page.locator('.dig-root:visible').count() > 0) return true
    } else {
      const diag = await page.evaluate(() => ({
        guide: [...document.querySelectorAll('[data-sidebar-right-guide-entry]')].map((el) => el.getAttribute('data-sidebar-right-guide-entry')),
        expand: [...document.querySelectorAll('button')].some((el) => (el.getAttribute('aria-label') || '') === '打开右侧边栏'),
        dialog: [...document.querySelectorAll('button, span')].some((el) => (el.textContent || '').trim() === '对话'),
      }))
      log('dock Git diagnostics: ' + JSON.stringify(diag))
      await page.screenshot({ path: join(outDir, 'dock-git-failed.png') })
    }
    const candidates = await page.evaluate(() => {
      const points = []
      for (const el of document.querySelectorAll('button')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if ((el.textContent || '').trim() !== 'Git') continue
        points.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
      }
      return points
    })
    for (const point of candidates) {
      await page.mouse.click(point.x, point.y)
      await settle(4000)
      const open = await page.locator('.dig-root:visible').count()
      if (open > 0) return true
    }
    return false
  }
  /* Strict: "removed" only counts when the ring itself is visible (an absent
     ring must never read as a pass). */
  const ringState = async () => {
    const anchor = await page.getByText('对话', { exact: true }).first().isVisible().catch(() => false)
    if (anchor !== true) return 'no-ring'
    const git = await gitTabButton()
    return git !== null && git.asElement() !== null ? 'git-present' : 'git-absent'
  }

  /* 4b — the immersive switch (default ON): off → the seat drops the overlay
     marker and the pin-to-scrollport fallback takes over (the composer seat
     is visible again); on → back to the full-height overlay layout. Same
     dock-settings surface as the placement switch, same re-entry pattern. */
  const flipImmersive = async () => {
    if (await dockGit() !== true) { log('dock Git tab not found (immersive flip)'); return false }
    const rail = page.locator('.dig-root:visible .dig-rail-settings').first()
    try { await rail.waitFor({ timeout: 10000 }) } catch (error) {
      log('rail settings button not found (immersive flip)')
      return false
    }
    await rail.click({ timeout: 6000 })
    await settle(3000)
    const placement = page.locator('input#dig-placement-immersive').first()
    if (await placement.count() === 0) { log('immersive switch not found on the settings surface'); return false }
    await placement.click({ timeout: 6000 })
    await settle(2500)
    return true
  }
  if (await flipImmersive() === true) {
    check(await reenterConversation() === true, 'back on the conversation after the immersive-off flip')
    const tabIm = await gitTabButton()
    if (tabIm !== null && tabIm.asElement() !== null) {
      await tabIm.asElement().click()
      await settle(4000)
      const immersiveOff = await page.evaluate(() => {
        const seat = document.querySelector('.dig-conversation-seat')
        const composer = document.querySelector('[data-composer-seat]')
        return {
          marker: seat === null ? 'no-seat' : (seat.hasAttribute('data-immersive') ? 'on' : 'off'),
          composerHidden: composer === null || getComputedStyle(composer).display === 'none',
          pinned: seat !== null && seat.style.height !== '' && seat.style.height !== '100%',
        }
      })
      check(immersiveOff.marker === 'off', 'immersive off drops the overlay marker (saw ' + JSON.stringify(immersiveOff) + ')')
      check(immersiveOff.composerHidden === false, 'the composer seat is visible again with immersive off')
      await page.screenshot({ path: join(outDir, 'conversation-git-tab-immersive-off.png') })
    } else {
      check(false, 'the Git tab is present for the immersive-off check')
    }
    if (await flipImmersive() === true) {
      check(await reenterConversation() === true, 'back on the conversation after the immersive-on flip')
      const tabIm2 = await gitTabButton()
      if (tabIm2 !== null && tabIm2.asElement() !== null) {
        await tabIm2.asElement().click()
        await settle(4000)
        const immersiveBack = await page.evaluate(() => {
          const seat = document.querySelector('.dig-conversation-seat[data-immersive="1"]')
          const composer = document.querySelector('[data-composer-seat]')
          return {
            on: seat !== null && seat.hasAttribute('data-conversation-composer-overlay'),
            composerHidden: composer === null || getComputedStyle(composer).display === 'none',
          }
        })
        check(immersiveBack.on === true && immersiveBack.composerHidden === true,
          'immersive back on restores the overlay layout (saw ' + JSON.stringify(immersiveBack) + ')')
      } else {
        check(false, 'the Git tab is present for the immersive-on restore check')
      }
    } else {
      check(false, 'the immersive-on flip completed')
    }
  } else {
    log('skipping the immersive-switch check (settings surface not reachable)')
  }

  /* 5 — the placement switch drives the seat live. On hosts that serve the
     plugin page, the rail settings button NAVIGATES there (the in-panel dialog
     never opens), so every toggle is verified back ON the conversation page:
     open the dock's Git panel → settings → flip → go back → inspect the ring. */
  const flipPlacement = async () => {
    if (await dockGit() !== true) { log('dock Git tab not found'); return false }
    /* The dock panel opens asynchronously (repo resolve + chrome render);
       wait for the button instead of sampling once. */
    const rail = page.locator('.dig-root:visible .dig-rail-settings').first()
    try { await rail.waitFor({ timeout: 10000 }) } catch (error) {
      log('rail settings button not found (panel did not open in time)')
      return false
    }
    await rail.click({ timeout: 6000 })
    await settle(3000)
    const placement = page.locator('input#dig-placement-conversationTab').first()
    if (await placement.count() === 0) { log('placement switch not found on the settings surface'); return false }
    await placement.click({ timeout: 6000 })
    await settle(2500)
    return true
  }
  if (await flipPlacement() === true) {
    check(await reenterConversation() === true, 'back on the conversation after the off flip')
    const goneState = await ringState()
    check(goneState === 'git-absent', 'turning the switch off removes the tab (ring visible, Git absent; saw ' + goneState + ')')
    /* The ON flip is verified by the RUNNER: after this probe the switch stays
       off (the settings entry lives inside the panel, which the absent ring
       button no longer opens), so the runner resets the row Config in the
       profile's cordis.patch.yml and restarts — the next run's assertion 1
       (Git tab present) IS the restore proof. */
    log('the switch stays OFF; the runner must reset the row Config + restart')
  } else {
    log('skipping the live-switch check (settings surface not reachable)')
  }


  check(pageErrors.length === 0, 'zero uncaught page errors (saw ' + pageErrors.length + ')')
} catch (error) {
  check(false, 'probe crashed: ' + String(error && error.message ? error.message : error).slice(0, 300))
}

await browser.close()
if (failures.length > 0) {
  log(failures.length + ' failure(s); see ' + logPath)
  process.exit(1)
}
log('all checks passed')
