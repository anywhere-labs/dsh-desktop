/** Keep the platform-only Beta specs listed where the Windows and macOS packaging jobs run them. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { betaSpecSources, PLATFORM_SPECS, platformGatedSpecs, PROGRAM_GATED_SPECS } from './test-platform-specs.mjs'

test('finds runIf, negated skipIf and skip-option gates, written directly or through an alias', () => {
  const sources = new Map([
    ['tests/direct.spec.ts', "it.runIf(process.platform === 'win32')('reads a token', () => {})\n"],
    ['tests/alias.spec.ts', "const windows = process.platform === 'win32'\ndescribe.runIf(windows)('drive paths', () => {})\n"],
    ['tests/negated.spec.ts', "it.skipIf(process.platform !== 'darwin')('reads a bundle', () => {})\n"],
    ['tests/mac-alias.spec.ts', "const darwinInstall = process.platform === 'darwin'\nit.runIf(darwinInstall)('resolves', () => {})\n"],
    ['tests/option.spec.ts', "it('finds a locale', { skip: process.platform !== 'darwin' }, () => {})\n"],
    ['tests/option-alias.spec.ts', "const windows = process.platform === 'win32'\nit('maps a drive', { timeout: 5_000, skip: !windows }, () => {})\n"],
    ['tests/negated-alias.spec.ts', "const darwin = process.platform === 'darwin'\ndescribe.skipIf(!darwin)('signs', () => {})\n"],
    // Skipping a platform still runs the case on Linux, and an unused alias gates nothing.
    ['tests/skip.spec.ts', "it.skipIf(process.platform === 'win32')('uses POSIX modes', () => {})\n"],
    ['tests/skip-option.spec.ts', "it('uses POSIX modes', { skip: process.platform === 'win32' }, () => {})\n"],
    ['tests/unused.spec.ts', "const windows = process.platform === 'win32'\nconst separator = windows ? '\\\\' : '/'\n"],
  ])
  assert.deepEqual(platformGatedSpecs(sources), {
    win32: ['tests/alias.spec.ts', 'tests/direct.spec.ts', 'tests/option-alias.spec.ts'],
    darwin: ['tests/mac-alias.spec.ts', 'tests/negated-alias.spec.ts', 'tests/negated.spec.ts', 'tests/option.spec.ts'],
  })
})

test('lists every Beta spec with a Windows-only or macOS-only case, plus the program-gated specs', () => {
  const sources = betaSpecSources()
  const gated = platformGatedSpecs(sources)
  for (const platform of ['win32', 'darwin']) {
    for (const spec of PROGRAM_GATED_SPECS[platform]) assert.ok(sources.has(spec), `${spec} is not a Beta spec`)
    assert.deepEqual([...PLATFORM_SPECS[platform]].sort(), [...gated[platform], ...PROGRAM_GATED_SPECS[platform]].sort(), platform)
  }
})
