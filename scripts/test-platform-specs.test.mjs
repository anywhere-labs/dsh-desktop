/** Keep the platform-only Beta specs listed where the Windows and macOS packaging jobs run them. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { betaSpecSources, PLATFORM_SPECS, platformGatedSpecs } from './test-platform-specs.mjs'

test('finds runIf gates written directly, through an alias, or as a negated skipIf', () => {
  const sources = new Map([
    ['tests/direct.spec.ts', "it.runIf(process.platform === 'win32')('reads a token', () => {})\n"],
    ['tests/alias.spec.ts', "const windows = process.platform === 'win32'\ndescribe.runIf(windows)('drive paths', () => {})\n"],
    ['tests/negated.spec.ts', "it.skipIf(process.platform !== 'darwin')('reads a bundle', () => {})\n"],
    ['tests/mac-alias.spec.ts', "const darwinInstall = process.platform === 'darwin'\nit.runIf(darwinInstall)('resolves', () => {})\n"],
    // Skipping a platform still runs the case on Linux, and an unused alias gates nothing.
    ['tests/skip.spec.ts', "it.skipIf(process.platform === 'win32')('uses POSIX modes', () => {})\n"],
    ['tests/unused.spec.ts', "const windows = process.platform === 'win32'\nconst separator = windows ? '\\\\' : '/'\n"],
  ])
  assert.deepEqual(platformGatedSpecs(sources), {
    win32: ['tests/alias.spec.ts', 'tests/direct.spec.ts'],
    darwin: ['tests/mac-alias.spec.ts', 'tests/negated.spec.ts'],
  })
})

test('lists every Beta spec with a Windows-only or macOS-only case', () => {
  assert.deepEqual(platformGatedSpecs(betaSpecSources()), {
    win32: [...PLATFORM_SPECS.win32].sort(),
    darwin: [...PLATFORM_SPECS.darwin].sort(),
  })
})
