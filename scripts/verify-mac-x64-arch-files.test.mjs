/** Pin which files the universal-merge preflight checks and how it reads the rule. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { uncoveredThinMachO } from './verify-mac-x64-arch-files.mjs'

const THIN_ARM64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])
const FAT = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02])

// A stand-in for minimatch's `{a,b}/**` patterns: each alternative is a literal directory prefix.
const prefixMatcher = (path, rule) => rule.slice(1, -1).split(',').some(prefix => path.startsWith(prefix.replace(/\*\*$/u, '')))

test('reports thin Mach-O files below Resources that the rule misses and ignores everything else', () => {
  const app = join(mkdtempSync(join(tmpdir(), 'dsh-x64-arch-')), 'Fixture.app')
  const write = (path, bytes) => {
    mkdirSync(dirname(join(app, path)), { recursive: true })
    writeFileSync(join(app, path), bytes)
  }
  try {
    write('Contents/MacOS/Fixture', THIN_ARM64)
    write('Contents/Frameworks/Electron Framework.framework/Electron Framework', THIN_ARM64)
    write('Contents/Resources/app.asar', THIN_ARM64)
    write('Contents/Resources/app.asar.unpacked/node_modules/covered-darwin-arm64/bin/tool', THIN_ARM64)
    write('Contents/Resources/app.asar.unpacked/node_modules/forgotten-darwin-arm64/bin/tool', THIN_ARM64)
    write('Contents/Resources/app.asar.unpacked/node_modules/universal/bin/tool', FAT)
    write('Contents/Resources/runtime/arm64/bin/python3', THIN_ARM64)
    write('Contents/Resources/app.asar.unpacked/node_modules/forgotten-darwin-arm64/README.md', 'text')
    write('Contents/Resources/empty', '')
    const rule = '{Contents/Resources/app.asar.unpacked/node_modules/covered-darwin-arm64/**,Contents/Resources/runtime/**}'
    assert.deepEqual(uncoveredThinMachO(app, rule, prefixMatcher), {
      thin: 3,
      uncovered: ['Contents/Resources/app.asar.unpacked/node_modules/forgotten-darwin-arm64/bin/tool'],
    })
  } finally {
    rmSync(dirname(app), { recursive: true, force: true })
  }
})

test('passes the app-relative path and the merge options to the matcher', () => {
  const app = join(mkdtempSync(join(tmpdir(), 'dsh-x64-arch-')), 'Fixture.app')
  try {
    mkdirSync(join(app, 'Contents', 'Resources', 'nested'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Resources', 'nested', 'tool'), THIN_ARM64)
    const calls = []
    uncoveredThinMachO(app, 'RULE', (path, rule, options) => { calls.push([path, rule, options]); return true })
    assert.deepEqual(calls, [['Contents/Resources/nested/tool', 'RULE', { matchBase: true }]])
  } finally {
    rmSync(dirname(app), { recursive: true, force: true })
  }
})
