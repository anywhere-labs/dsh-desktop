import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightRoot = process.env.ISSUE641_PLAYWRIGHT_ROOT
if (playwrightRoot === undefined) throw new Error('ISSUE641_PLAYWRIGHT_ROOT is required')
const { chromium } = await import(pathToFileURL(join(playwrightRoot, 'index.mjs')).href)

const output = resolve('output/issue-641')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0]
if (context === undefined) throw new Error('Electron CDP exposed no browser context')
const page = context.pages()[0]
if (page === undefined) throw new Error('Electron CDP exposed no renderer page')

const textarea = page.locator('textarea').first()
const send = page.locator('button[aria-label="发送消息"], button[aria-label="Send message"]').last()
const firstText = 'Issue 641 deadline recovery proof'
const secondText = 'Issue 641 recovery follow-up'
const evidence = { startedAt: new Date().toISOString(), pageUrl: page.url() }

function readState() {
  return page.evaluate(() => {
    const input = document.querySelector('textarea')
    const sendButton = document.querySelector('button[aria-label="发送消息"], button[aria-label="Send message"]')
    const hung = globalThis.__issue641HungPrompt
    return {
      phase: input?.dataset.phase ?? null,
      value: input?.value ?? null,
      readOnly: input?.readOnly ?? null,
      disabled: input?.disabled ?? null,
      sendDisabled: sendButton instanceof HTMLButtonElement ? sendButton.disabled : null,
      imagePresent: document.querySelector('img[alt="issue641.png"]') !== null,
      responseStatus: hung?.status ?? null,
      responseReceivedAt: hung?.responseReceivedAt ?? null,
      signalAborted: hung?.signal?.aborted ?? null,
      signalReasonName: hung?.signal?.reason?.name ?? null,
      signalReasonMessage: hung?.signal?.reason?.message ?? null,
      helloCount: [...document.querySelectorAll('p')].filter(node => node.textContent?.trim() === 'hello').length,
    }
  })
}

try {
  await page.waitForLoadState('domcontentloaded')
  await textarea.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea')
    return input?.dataset.phase === 'plain' && input.readOnly === false
  })
  await context.tracing.start({ screenshots: true, snapshots: true })

  for (const oldRemove of await page.locator('button[aria-label*="issue641.png"]').all()) {
    await oldRemove.click()
  }
  await textarea.fill(firstText)
  await page.evaluate(() => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5H0AAAAASUVORK5CYII='
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'issue641.png', { type: 'image/png' }))
    const target = document.querySelector('textarea')
    if (target === null) throw new Error('composer textarea missing')
    target.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }))
  })
  await page.waitForFunction(() => document.querySelector('img[alt="issue641.png"]') !== null)
  await send.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(output, 'fixed-before-injected-submit.png') })

  await page.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis)
    let intercepted = false
    globalThis.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = input instanceof Request ? input.url : String(input)
      if (!intercepted && new URL(url, location.origin).pathname === '/api/session.prompt') {
        intercepted = true
        globalThis.__issue641HungPrompt = {
          responseReceivedAt: Date.now(),
          status: response.status,
          signal: init?.signal,
        }
        return new Promise(() => {})
      }
      return response
    }
  })

  const clickedAt = Date.now()
  await send.click()
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea')
    return input?.dataset.phase === 'submitting' && input.readOnly === true
      && globalThis.__issue641HungPrompt?.status === 200
  })
  evidence.duringHang = await readState()
  await page.screenshot({ path: join(output, 'fixed-injected-submitting.png') })

  await page.waitForFunction(() => {
    const input = document.querySelector('textarea')
    return input?.dataset.phase === 'plain' && input.readOnly === false
      && globalThis.__issue641HungPrompt?.signal?.aborted === true
  }, undefined, { timeout: 45_000 })
  evidence.recoveredAfterMs = Date.now() - clickedAt
  evidence.afterDeadline = await readState()
  if (evidence.afterDeadline.value !== firstText || evidence.afterDeadline.imagePresent !== true) {
    throw new Error('deadline recovery did not preserve the image-and-text draft')
  }
  await page.screenshot({ path: join(output, 'fixed-after-deadline-recovery.png') })

  const remove = page.locator('button[aria-label*="issue641.png"]').last()
  await remove.click()
  await textarea.fill(secondText)
  await send.click()
  await page.waitForFunction(() => {
    const input = document.querySelector('textarea')
    return input?.dataset.phase === 'plain' && input.readOnly === false && input.value === ''
  }, undefined, { timeout: 10_000 })
  evidence.afterSecondSend = await readState()
  evidence.completedAt = new Date().toISOString()
  await page.screenshot({ path: join(output, 'fixed-second-send-success.png') })
  await context.tracing.stop({ path: join(output, 'fixed-electron-trace.zip') })
  await writeFile(join(output, 'fixed-electron-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  evidence.failure = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) }
  await page.screenshot({ path: join(output, 'fixed-verification-failure.png') }).catch(() => undefined)
  await context.tracing.stop({ path: join(output, 'fixed-electron-trace.zip') }).catch(() => undefined)
  await writeFile(join(output, 'fixed-electron-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  throw error
} finally {
  await browser.close()
}
