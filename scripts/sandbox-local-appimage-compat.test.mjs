/**
 * Check that the installed local sandbox re-exposes the runner an AppImage run keeps below `/tmp`.
 *
 * The AppImage runtime mounts the app below `/tmp`, and the binary this Host
 * process runs as (`process.execPath`) is the Node runner every confined
 * command starts from. The `workspace-write` bwrap profile masks `/tmp` with a
 * tmpfs, so without a read-only bind of that mount bwrap cannot exec the
 * runner and every tool fails with `sandbox-unavailable` (ENOENT, #1625).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const MOUNT = '/tmp/.mount_DSH-compat'

/** Resolve one workspace's installed copies of the modules this check exercises. */
function runtimePaths(workspace) {
  try {
    const require = createRequire(resolve(workspace, 'package.json'))
    return {
      cordis: pathToFileURL(require.resolve('@deepseek-ai/cordis')).href,
      sandboxLocal: pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-local')).href,
    }
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND') return undefined
    throw error
  }
}

// Carry the sandbox-local hunk of patches/dsh-sandbox-local@<version>.patch to every new runtime.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const paths = runtimePaths(workspace)
  test(`${workspace}: the bwrap workspace-write profile re-exposes the AppImage runner mount`, {
    skip: paths === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async () => {
    if (process.platform === 'win32') return // bwrap is the Linux rung; its profile is unreachable here.
    const executable = Object.getOwnPropertyDescriptor(process, 'execPath')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-sandbox-compat-'))
    try {
      mkdirSync(MOUNT, { recursive: true })
      // The profile reads the Host's own executable path while the Host is confined.
      Object.defineProperty(process, 'execPath', { ...executable, value: `${MOUNT}/dsh-desktop-next` })
      const { Context } = await import(paths.cordis)
      const { LocalSandboxProvider } = await import(paths.sandboxLocal)
      // A configured runner command exercises the profile builder without invoking bwrap.
      const provider = new LocalSandboxProvider(new Context(), {
        runnerCommand: ['bwrap'], runnerFailureSignatures: ['bwrap: '], probeTimeoutMs: 5_000,
      })
      const confined = await provider.confine(['/bin/true'], { mode: 'workspace-write', workspaceRoot })
      const masked = confined.argv.indexOf('--tmpfs')
      const reexposed = confined.argv.findIndex((argument, index) => argument === '--ro-bind'
        && confined.argv[index + 1] === MOUNT && confined.argv[index + 2] === MOUNT)
      assert.notEqual(masked, -1, 'workspace-write must mask /tmp')
      assert.ok(reexposed > masked, 'the AppImage mount hosting the runner must be bound back read-only after the tmpfs mask')
      // Read-only mode never masks /tmp, so the mount stays visible without an extra bind.
      const readOnly = await provider.confine(['/bin/true'], { mode: 'read-only', workspaceRoot })
      assert.ok(!readOnly.argv.includes(MOUNT), 'read-only mode must not add the mount bind')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(MOUNT, { recursive: true, force: true })
      Object.defineProperty(process, 'execPath', executable)
    }
  })
}
