/** Pin which Beta files count as channel-specific and which of them reach Vitest. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { relatedTestTargets } from './test-beta-variant.mjs'
import { variantSpecificFiles } from './verify-desktop-variants.mjs'

test('lists Beta files that differ from Next or exist only in Beta', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-variants-'))
  const write = (base, path, text) => {
    mkdirSync(dirname(join(root, base, path)), { recursive: true })
    writeFileSync(join(root, base, path), text)
  }
  try {
    write('next', 'src/shared.ts', 'export const shared = 1\n')
    write('beta', 'src/shared.ts', 'export const shared = 1\n')
    write('next', 'src/channel.ts', "export const channel = 'next'\n")
    write('beta', 'src/channel.ts', "export const channel = 'beta'\n")
    write('next', 'package.json', '{"name":"dsh-desktop-next"}\n')
    write('beta', 'package.json', '{"name":"dsh-plugin-desktop-beta"}\n')
    write('beta', 'tests/beta-only.spec.ts', 'export {}\n')
    write('next', 'tests/next-only.spec.ts', 'export {}\n')
    assert.deepEqual(
      variantSpecificFiles(join(root, 'next'), join(root, 'beta')),
      ['package.json', 'src/channel.ts', 'tests/beta-only.spec.ts'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('hands Vitest only modules from source, scripts and tests', () => {
  assert.deepEqual(
    relatedTestTargets([
      'package.json',
      'cordis.patch.yml',
      'assets/app-icon.png',
      'src/native-ui/index.html',
      'src/main.ts',
      'src/client/updates.tsx',
      'scripts/verify-host.mjs',
      'tests/runtime-fixture.ts',
    ]),
    ['src/main.ts', 'src/client/updates.tsx', 'scripts/verify-host.mjs', 'tests/runtime-fixture.ts'],
  )
})
