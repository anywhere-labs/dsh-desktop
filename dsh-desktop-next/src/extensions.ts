/** Narrow Host capabilities consumed by the existing plugin markets. */
import { installComputerUseCommand } from './host/computer-use-command.ts'
import { installHostLogging } from './host/logging.ts'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ProfilePnpmInvocation } from '@deepseek-ai/dsh-app-boot'
import { installNotifications } from './notifications.ts'
import { HostPermissions } from './host-permissions.ts'
import { NEXT_PACKAGE, profileName } from './profiles.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE } from './pnpm-policy.ts'
import { unpackedPath } from './asar-archive-policy.ts'

export const name = 'desktop-next-capabilities'
export const inject = ['profileContext']

export function apply(ctx: Context): void {
  installHostLogging(ctx)
  if (process.send) {
    const permissions = new HostPermissions(process)
    ctx.provide('desktopPermissions', permissions)
    ctx.effect(() => permissions.dispose, 'Next Host permission bridge')
  }
  if (process.send) installNotifications(ctx, notification => {
    if (process.connected) process.send?.({ type: 'notification', notification }, () => {})
  })
  const profile = ctx.profileContext
  const invocation = profile.packageManager
  if (!invocation) throw new Error('Next requires its bundled pnpm invocation')
  const runner = createPackageRunner(invocation, profile.dir)
  // dshmarket installs through the bundled pnpm; Community Market manages
  // packages through the official pluginManager service and needs no Desktop
  // inventory or restart capability.
  ctx.provide('desktopProfiles', { current: { name: profile.name, dir: profile.dir } })
  ctx.provide('desktopPnpm', runner)
  installComputerUseCommand(ctx, profile.dir)
  if (process.send) ctx.provide('desktopActions', {
    ...(process.platform === 'darwin' || process.platform === 'win32' ? { openTerminal: () => {
      if (!process.connected || !process.send) throw new Error('Next shell is unavailable')
      process.send({ type: 'desktop-action', action: 'terminal' }, () => {})
    } } : {}),
    requestRestart: () => new Promise<void>((resolve, reject) => {
      if (!process.connected || !process.send) { reject(new Error('Next shell is unavailable')); return }
      process.send({ type: 'desktop-action', action: 'restart' }, error => error ? reject(error) : resolve())
    }),
  })
  ctx.effect(() => () => runner.dispose(), 'Next package process disposal')
}

/** Own each process handle so a stale cancellation cannot kill its successor. */
export function createPackageRunner(invocation: ProfilePnpmInvocation, directory: string, forceKillDelayMs = 2_000) {
  let active: { cancel(): void; done: Promise<unknown> } | undefined
  let disposed = false
  function start(args: readonly string[], cwd: string, signal?: AbortSignal, env: NodeJS.ProcessEnv = {}) {
    if (disposed) throw new Error('Package runner has been disposed')
    if (active) throw new Error('A profile package operation is already active')
    if (signal?.aborted) throw signal.reason ?? new Error('Package operation cancelled')
    if (!args.length || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Invalid package arguments')
    if (!isAbsolute(cwd) || cwd.includes('\0')) throw new Error('Package invoking directory must be absolute')
    const child = spawn(invocation.command, [...args], {
      cwd, env: { ...process.env, ...invocation.env, ...env },
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    const kill = (kind: NodeJS.Signals): void => {
      if (settled || !child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => { if (!settled) child.kill(kind) })
      } else {
        try { process.kill(-child.pid, kind) } catch { child.kill(kind) }
      }
    }
    const cancel = (): void => {
      if (settled || killTimer) return
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), forceKillDelayMs)
      killTimer.unref()
    }
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, exitSignal) => { resolve({ exitCode, signal: exitSignal }) })
    }).finally(() => {
      settled = true
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', cancel)
      if (active?.done === done) active = undefined
    })
    active = { cancel, done }
    void done.catch(() => {})
    signal?.addEventListener('abort', cancel, { once: true })
    return { stdout: child.stdout!, stderr: child.stderr!, done, cancel }
  }
  return {
    run(argv: readonly string[], signal?: AbortSignal) {
      if (!argv.length) throw new Error('Invalid pnpm arguments')
      // The Host invocation also serves the official manager; apply its policy only once here.
      const args = [...invocation.args, ...argv].filter(arg => arg !== PNPM_IGNORE_MINIMUM_RELEASE_AGE)
      return start([...args, PNPM_IGNORE_MINIMUM_RELEASE_AGE], directory, signal)
    },
    /** dshmarket uses the official CLI so installs/removals also reconcile Profile bundles. */
    runPlugin(argv: readonly string[], invokingDir: string, signal?: AbortSignal) {
      if (!argv.length) throw new Error('Invalid plugin arguments')
      return start(['--expose-internals', join(dirname(NEXT_PACKAGE), 'lib', 'plugin-cli.js'),
        profileName(basename(directory)), ...argv], invokingDir, signal, { DSH_HOME: dirname(dirname(directory)) })
    },
    async dispose(): Promise<void> {
      disposed = true
      const current = active
      current?.cancel()
      await current?.done.catch(() => {})
    },
  }
}

/**
 * Entry of the pnpm this installation carries. Electron runs it as a separate Node-mode process
 * with its own workers, so a packaged Next uses the copy unpacked beside app.asar.
 * @param anchor - Manifest the installation resolves packages from.
 * @returns Absolute physical path of `pnpm.mjs`.
 */
export function bundledPnpmEntry(anchor: string): string {
  const require = createRequire(anchor)
  return unpackedPath(join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'))
}
