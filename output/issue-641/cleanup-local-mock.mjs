import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightRoot = process.env.ISSUE641_PLAYWRIGHT_ROOT
if (playwrightRoot === undefined) throw new Error('ISSUE641_PLAYWRIGHT_ROOT is required')
const { chromium } = await import(pathToFileURL(join(playwrightRoot, 'index.mjs')).href)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0]?.pages()[0]
if (page === undefined) throw new Error('Electron CDP exposed no renderer page')

try {
  const result = await page.evaluate(async () => {
    const call = async (method, payload) => {
      const rpcId = crypto.randomUUID()
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      const body = await response.json()
      if (!response.ok || body.result?.ok !== true) {
        throw new Error(`${method} cleanup failed with HTTP ${response.status}`)
      }
      return body.result.value
    }

    const setting = await call('settings.mutate', {
      ns: 'llm-deepseek',
      ops: [{ op: 'unset', path: ['baseURL'] }],
    })
    await call('credentials.unset', { ref: 'DEEPSEEK_API_KEY' })
    return {
      settingUnset: !Object.hasOwn(setting.value, 'baseURL'),
      credentialUnset: true,
    }
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
