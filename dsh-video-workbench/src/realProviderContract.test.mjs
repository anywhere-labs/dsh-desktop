import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('real provider flow performs preflight and sends the selected input contract', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(source, /videoApi\.preflight\(requestBody\)/)
  assert.match(source, /approvalId/)
  assert.match(source, /assets/)
  assert.match(source, /settings: \{ duration, quality, style, platforms \}/)
  assert.match(source, /videoApi\.generate\(requestBody\)/)
  assert.match(source, /setGeneratedVideoUrl\(resultUrl\(status\.outputUrl\)\)/)
})
