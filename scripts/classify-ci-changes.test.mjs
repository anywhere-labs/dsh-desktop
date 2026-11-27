/** Pin which changed paths need the product build, tests and packaging jobs. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const classifier = fileURLToPath(new URL('./classify-ci-changes.mjs', import.meta.url))
const classify = paths => execFileSync(process.execPath, [classifier], {
  input: Buffer.from(`${paths.join('\0')}\0`),
  encoding: 'utf8',
}).trim()

test('skips the product gate only for documentation-only changes', () => {
  assert.equal(classify([
    'docs/architecture.md',
    '.agents/notes/implemented/architecture/decision.md',
    '.agents/notes/implemented/architecture/decision.i18n.yaml',
    'dsh-community-market/docs/schema.json',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
  ]), 'docs')
})

test('runs the product gate for source, workflow, license and empty changes', () => {
  assert.equal(classify(['README.md', 'dsh-desktop-next/src/main.ts']), 'full')
  assert.equal(classify(['.github/workflows/ci.yml']), 'full')
  assert.equal(classify(['THIRD_PARTY_NOTICES.md']), 'full')
  assert.equal(classify([]), 'full')
})

test('checks the standalone ACP workspace for plugin code and packaged previews', () => {
  assert.equal(classify(['README.md', 'dsh-acp-bridge/src/panel/panel.tsx']), 'acp')
  assert.equal(classify(['dsh-acp-bridge/docs/preview.zh.svg']), 'acp')
  assert.equal(classify(['dsh-acp-bridge/src/index.ts', 'yarn.lock']), 'full')
})
