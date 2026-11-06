import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installWindowStyles } from '../src/client/styles.ts'

const require = createRequire(import.meta.url)

afterEach(() => { vi.unstubAllGlobals() })

/** Install the Desktop window styles against a stub document and return the sheet's text. */
function installedStyles(): string {
  let text = ''
  vi.stubGlobal('document', {
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head: { append: (node: { textContent: string }) => { text = node.textContent } },
  })
  installWindowStyles()()
  return text
}

/** The official Web frontend's built assets with one extension, joined. */
function frontendAssets(extension: string): string {
  const assets = join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')), 'assets')
  return readdirSync(assets).filter(name => name.endsWith(extension))
    .map(name => readFileSync(join(assets, name), 'utf8')).join('\n')
}

/** Selector list entries without quotes or whitespace, sorted. */
function selectorList(list: string): string[] {
  return list.split(',').map(entry => entry.replace(/['"\s]/gu, '')).filter(entry => entry !== '').sort()
}

it('resets every control the official frontend subtracts from macOS drag rows', () => {
  const official = /html\[data-platform=darwin\] :is\(([^)]+)\)\{-webkit-app-region:no-drag\}/u.exec(frontendAssets('.css'))?.[1]
  expect(official, 'the official interactive no-drag rule').toBeDefined()
  const reset = /:scope,\s*:is\(([^)]+)\)/u.exec(installedStyles())?.[1]
  expect(reset, 'the scroller content reset').toBeDefined()
  expect(selectorList(reset!)).toEqual(selectorList(official!))
})

it('targets the scrollers and rows the official client renders', () => {
  const client = (name: string) => readFileSync(require.resolve(`@deepseek-ai/${name}/client`), 'utf8')
  expect(client('dsh-client-ui-conversation')).toContain('"data-conversation-scroll": ""')
  expect(client('dsh-client-ui-workspace')).toContain('role: "tree"')
  const plugins = client('dsh-client-ui-plugin-manager')
  for (const hook of ['"data-plugin-body": true', '"data-plugin-bar": true', '"data-natural"', '"--plugin-header-paint-height"']) expect(plugins).toContain(hook)
  // The dock layout ships inside the frontend bundle, not as its own client package.
  const frontend = frontendAssets('.js')
  for (const hook of ['"data-dockkit-content":', '"data-dockkit-pane":']) expect(frontend).toContain(hook)
})
