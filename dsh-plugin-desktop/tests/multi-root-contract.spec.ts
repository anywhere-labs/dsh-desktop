/** Behavior of the installed sandbox, not text assertions against an obsolete patch version. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
const installed = JSON.parse(readFileSync(resolve(dirname(require.resolve('@deepseek-ai/dsh-sandbox')), '../package.json'), 'utf8')) as { version: string }

describe('installed multi-root sandbox contract', () => {
  it('loads the sandbox family declared by this Desktop package', () => {
    expect(installed.version).toBe(manifest.dependencies['@deepseek-ai/dsh-sandbox'])
  })
  it('preserves legacy single-root writable policy exactly', () => {
    const expected = [...new Set(['/workspace-primary', '/tmp', tmpdir()].map(canonicalPath))]
    expect(writableRoots({ mode: 'workspace-write', workspaceRoot: '/workspace-primary' })).toEqual(expected)
  })
  it('grants all selected roots, deduplicated, without adding an unselected root', () => {
    const roots = writableRoots({ mode: 'workspace-write', workspaceRoot: '/workspace-primary',
      workspaceRoots: ['/workspace-primary', '/workspace-extra', '/workspace-primary'] })
    expect(roots).toEqual([...new Set(['/workspace-primary', '/workspace-extra', '/tmp', tmpdir()].map(canonicalPath))])
    expect(roots).not.toContain('/workspace-unselected')
  })
  it('retains the primary root fallback for empty optional roots', () => {
    expect(writableRoots({ mode: 'workspace-write', workspaceRoot: '/workspace-primary', workspaceRoots: [] }))
      .toEqual(writableRoots({ mode: 'workspace-write', workspaceRoot: '/workspace-primary' }))
  })
  it('does not authorize any roots in read-only mode', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: '/workspace-primary',
      workspaceRoots: ['/workspace-primary', '/workspace-extra'] })).toEqual([])
  })
})
