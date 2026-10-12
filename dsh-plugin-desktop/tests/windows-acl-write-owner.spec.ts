import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// A workspace on a non-system drive (for example D:) usually carries only the
// drive root's inherited ACL: Authenticated Users get Modify and nobody but
// SYSTEM/Administrators holds WRITE_OWNER. Upstream 0.1.7 writes the Low
// mandatory label on every workspace grant, which needs WRITE_OWNER, so the
// grant failed with Win32 5 before the dsh-sandbox-windows-acl patch. The same
// ACL shape is rebuilt here under the temp directory so the check does not
// depend on which drives the machine has.
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspaceWithoutWriteOwner(): { root: string, workspace: string, outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-acl-write-owner-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(join(workspace, 'nested'), { recursive: true })
  mkdirSync(outside)
  // Authenticated Users (S-1-5-11) Modify + SYSTEM (S-1-5-18) Full, no inheritance:
  // the owner keeps only its implicit READ_CONTROL and WRITE_DAC.
  execFileSync('icacls', [root, '/inheritance:r', '/grant:r', '*S-1-5-11:(OI)(CI)M', '*S-1-5-18:(OI)(CI)F'], { stdio: 'ignore', windowsHide: true })
  return { root, workspace, outside }
}

describe.runIf(process.platform === 'win32')('Windows ACL sandbox on a workspace without WRITE_OWNER', () => {
  it('grants the workspace and still confines writes to it', async () => {
    const { AclSandbox, workspaceWriteSid } = await import('@deepseek-ai/dsh-sandbox-windows-acl')
    const { workspace, outside } = workspaceWithoutWriteOwner()
    const sandbox = new AclSandbox({ writableDirs: [workspace], mode: 'workspace-write', tempDir: null, writeSid: workspaceWriteSid(workspace) })
    const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    try {
      await sandbox.init()
      // Relative targets keep the command line free of quoting (temp paths may contain spaces).
      const inside = await sandbox.spawn({ command: cmd, args: ['/d', '/c', 'echo inside>nested\\inside.txt'], cwd: workspace }).wait()
      const escaped = await sandbox.spawn({ command: cmd, args: ['/d', '/c', 'echo outside>..\\outside\\escaped.txt'], cwd: workspace }).wait()

      expect(inside.exitCode).toBe(0)
      expect(existsSync(join(workspace, 'nested', 'inside.txt'))).toBe(true)
      expect(escaped.exitCode).not.toBe(0)
      expect(existsSync(join(outside, 'escaped.txt'))).toBe(false)
    }
    finally {
      sandbox.dispose()
    }
  }, 60_000)
})
