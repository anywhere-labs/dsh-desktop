import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { installWindowStyles } from '../src/client/styles.ts'

const require = createRequire(import.meta.url)
afterEach(() => { vi.unstubAllGlobals() })

it('clips the collapsed Plugins drag row using the official header hooks', () => {
  let text = ''
  vi.stubGlobal('document', {
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head: { append: (node: { textContent: string }) => { text = node.textContent } },
  })
  installWindowStyles()()
  const client = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-plugin-manager/client'), 'utf8')
  for (const hook of ['data-plugin-bar', 'data-natural', '--plugin-header-paint-height']) {
    expect(client).toContain(hook)
    expect(text).toContain(hook)
  }
  expect(text).toContain('-webkit-app-region: no-drag')
})
