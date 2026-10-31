import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReferenceService } from '@deepseek-ai/dsh-file-reference'
import { WorkspaceSourceRoots } from '../src/workspace-source-roots.ts'
import { installWorkspaceSourceFileReferences, WORKSPACE_SOURCE_REFERENCE_PREFIX } from '../src/workspace-source-file-references.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function directory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(path)
  return path
}

function fakeAgent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

describe('WorkspaceSourceFileReferences', () => {
  it('adds attached roots to @ browsing and emits their canonical absolute paths', async () => {
    const primary = directory('dsh-reference-primary-')
    const data = directory('dsh-reference-store-')
    const attached = join(directory('dsh-reference-attached-'), 'Fate Docs')
    mkdirSync(attached)
    writeFileSync(join(primary, 'main.md'), 'primary')
    writeFileSync(join(attached, 'read me.md'), 'attached')
    const roots = new WorkspaceSourceRoots(join(data, 'roots.json'))
    roots.add(primary, attached)
    const primaryList = vi.fn(async (_agent: Agent, query: string) => [
      { path: query === '' ? 'main.md' : `main-${query}.md`, kind: 'file' as const },
    ])
    const provider = { list: primaryList } as unknown as FileReferenceService
    const installed = installWorkspaceSourceFileReferences(provider, roots, 'linux')
    const agent = fakeAgent(primary)
    const signal = new AbortController().signal
    const alias = basename(attached)
    const queryRoot = `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/${alias}`

    const rootChoices = await provider.list(agent, `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/`, signal)
    expect(rootChoices).toContainEqual({ path: queryRoot, kind: 'directory', referencePath: attached })

    const children = await provider.list(agent, `${queryRoot}/`, signal)
    expect(children).toContainEqual({
      path: `${queryRoot}/read me.md`,
      kind: 'file',
      referencePath: join(attached, 'read me.md'),
    })

    const fuzzy = await provider.list(agent, 'read', signal)
    expect(fuzzy).toContainEqual({
      path: `${queryRoot}/read me.md`,
      kind: 'file',
      referencePath: join(attached, 'read me.md'),
    })
    expect(primaryList).toHaveBeenCalledWith(agent, 'read', signal)

    const primaryDirectoryQuery = await provider.list(agent, 'docs/', signal)
    expect(primaryDirectoryQuery).toEqual([{ path: 'main-docs/.md', kind: 'file' }])
    expect(primaryList).toHaveBeenCalledWith(agent, 'docs/', signal)

    installed.disposeAgent(agent)
    installed.dispose()
    expect(provider.list).toBe(primaryList)
  })

  it('does not expose detached roots or install a provider override on Windows', async () => {
    const primary = directory('dsh-reference-primary-')
    const data = directory('dsh-reference-store-')
    const attached = directory('dsh-reference-attached-')
    const roots = new WorkspaceSourceRoots(join(data, 'roots.json'))
    roots.add(primary, attached)
    const originalList = vi.fn(async () => [{ path: 'primary.md', kind: 'file' as const }])
    const provider = { list: originalList } as unknown as FileReferenceService
    const agent = fakeAgent(primary)
    const installed = installWorkspaceSourceFileReferences(provider, roots, 'win32')

    await expect(provider.list(agent, `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/`, new AbortController().signal))
      .resolves.toEqual([{ path: 'primary.md', kind: 'file' }])
    expect(provider.list).toBe(originalList)
    installed.dispose()
    expect(provider.list).toBe(originalList)

    const linuxProvider = { list: originalList } as unknown as FileReferenceService
    const linux = installWorkspaceSourceFileReferences(linuxProvider, roots, 'linux')
    roots.remove(primary, attached)
    await expect(linuxProvider.list(agent, `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/`, new AbortController().signal))
      .resolves.toEqual([{ path: 'primary.md', kind: 'file' }])
    linux.dispose()
  })
})
