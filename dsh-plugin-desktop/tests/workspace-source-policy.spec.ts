import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { WorkspaceSourceRoots } from '../src/workspace-source-roots.ts'
import { installWorkspaceSourcePolicy } from '../src/workspace-source-policy.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Workspace source policy on Windows', () => {
  it('keeps the primary root for file access and does not extend sandbox grants', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-workspace-source-policy-'))
    temporaryDirectories.push(directory)
    const primary = join(directory, 'primary')
    const attached = join(directory, 'attached')
    mkdirSync(primary)
    mkdirSync(attached)

    const sourceRoots = new WorkspaceSourceRoots(join(directory, 'sources.json'))
    sourceRoots.add(primary, attached)
    sourceRoots.select(primary, attached)

    const executionPolicy: Parameters<SandboxProvider['confine']>[1] = { mode: 'workspace-write', workspaceRoot: primary }
    const confined = {
      argv: ['sandbox-runner', '--', 'command'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
    } satisfies Awaited<ReturnType<SandboxProvider['confine']>>
    const confine = vi.fn<SandboxProvider['confine']>().mockResolvedValue(confined)
    const sandbox: Pick<SandboxProvider, 'confine'> = { confine }

    const fs: Pick<FileSystem, 'resolve' | 'contains' | 'writeText' | 'editText'> = {
      resolve: vi.fn<FileSystem['resolve']>(),
      contains: vi.fn<FileSystem['contains']>(),
      writeText: vi.fn<FileSystem['writeText']>(),
      editText: vi.fn<FileSystem['editText']>(),
    }
    const list = vi.fn<WorkspaceFiles['list']>().mockResolvedValue({ path: '', entries: [], truncated: false })
    const workspaceFiles: Pick<WorkspaceFiles, 'read' | 'readBytes' | 'stat' | 'list' | 'changes'> = {
      read: vi.fn<WorkspaceFiles['read']>(),
      readBytes: vi.fn<WorkspaceFiles['readBytes']>(),
      stat: vi.fn<WorkspaceFiles['stat']>(),
      list,
      changes: vi.fn<WorkspaceFiles['changes']>(),
    }

    const restore = installWorkspaceSourcePolicy(
      sandbox,
      fs,
      workspaceFiles,
      () => executionPolicy,
      sourceRoots,
      'win32',
    )
    try {
      const result = await sandbox.confine(['command'], executionPolicy)
      expect(result.argv).toEqual(confined.argv)
      expect(confine).toHaveBeenCalledWith(['command'], executionPolicy, undefined)

      const scope = { sessionId: SessionId('test-session'), workspaceRoot: primary }
      const selectedFile = join(attached, 'file.txt')
      await workspaceFiles.list(scope, selectedFile, new AbortController().signal)
      expect(list).toHaveBeenCalledOnce()
      expect(list.mock.calls[0]?.[0].workspaceRoot).toBe(primary)
      expect(list.mock.calls[0]?.[1]).toBe(selectedFile)
      expect(sourceRoots.selectedRoot(primary)).toBe(attached)
    } finally {
      restore()
    }
  })
})
