import { describe, expect, it } from 'vitest'
import { manualInstallHint } from '../src/install/manual.js'

const base = {
  id: 'example/plugin',
  name: 'Example Plugin',
  displayName: 'Example Plugin',
  summary: 'Example plugin',
  repository: { url: 'https://github.com/example/plugin', subdirectory: 'packages/plugin' },
  installSource: {
    kind: 'github' as const,
    commit: '0123456789abcdef0123456789abcdef01234567',
  },
  provenance: {
    sourceRecordId: 'source-1',
    providerId: 'provider.example',
    itemId: 'example/plugin',
  },
}

describe('manual install hints', () => {
  it('renders pinned GitHub sources as non-executable display commands', () => {
    expect(manualInstallHint(base)).toMatchObject({
      kind: 'github',
      mutable: false,
      desktopVerification: 'not-verified',
      displayCommand: 'dsh plugin add github:example/plugin#0123456789abcdef0123456789abcdef01234567&path:/packages/plugin',
    })
  })

  it('does not expose malformed pinned sources', () => {
    expect(manualInstallHint({
      ...base,
      installSource: { kind: 'github', commit: 'not-a-commit' },
    })).toBeUndefined()
  })
})
