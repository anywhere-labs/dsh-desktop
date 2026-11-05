/** An Electron Node-mode child owns the DSH Web server outside Chromium's Utility allocator. */
import { serializeHostEnvironment } from './host-launch-environment.ts'
import { fork, type Serializable } from 'node:child_process'
import { constants } from 'node:os'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { StringDecoder } from 'node:string_decoder'
import { HostRpc } from './host-rpc.ts'
import { bindNativeRuntime, runtimeSnapshot } from './host-runtime-bridge.ts'
import type { DesktopHostOptions } from './host-bootstrap.ts'
import type { DesktopRuntime } from './runtime.ts'
import type { DesktopStartupGenerationHost } from './startup-generation.ts'
import type { DesktopLanHttpsRuntimeOptions } from './lan-https-runtime.ts'

export interface IsolatedHostOptions {
  host: DesktopHostOptions
  runtime: DesktopRuntime
  rendererToken: string
  prepareCertificate: NonNullable<DesktopLanHttpsRuntimeOptions['prepareCertificate']>
  bindHost(host: DesktopStartupGenerationHost): void
  requestQuit(code: number): void
  onFailure(error: Error, exit: IsolatedHostExit): void
}

/** What an unexpected Host exit leaves behind for evidence. */
export interface IsolatedHostExit {
  /** Child exit code, or 128 + signal number when terminated by a signal. */
  readonly exitCode: number
  /** Child PID for the crash and lifecycle records; Node-mode failures may have no Crashpad dump. */
  readonly hostPid?: number
  /** Milliseconds between fork and exit; separates an instant death from one hours in. */
  readonly uptimeMs: number
  /**
   * The Host's last stderr output, bounded to {@link HOST_STDERR_TAIL_CHARS}. A fatal Host writes
   * its reason there (the fail-loud diagnostic, or Node's own crash stack) and nowhere else.
   */
  readonly stderrTail: string
}

/** Enough for a fail-loud diagnostic with its inspected cause chain, small enough for one log entry. */
export const HOST_STDERR_TAIL_CHARS = 16 * 1024

/** The Desktop log entry for an unexpected Host exit: the reason, then what the Host said last. */
export function formatUnexpectedHostExit(error: Error, exit: IsolatedHostExit): string {
  const tail = exit.stderrTail.trimEnd()
  return tail === '' ? error.message : `${error.message}\nLast DSH Host stderr:\n${tail}`
}

export async function startIsolatedDesktopHost(options: IsolatedHostOptions): Promise<void> {
  const forkedAt = performance.now()
  const child = fork(fileURLToPath(new URL('./host-process-entry.js', import.meta.url)), [], {
    execPath: process.execPath, execArgv: [], cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
  })
  // Keep normal Host logs in its own files; stderr includes bootstrap failures.
  child.stdout?.on('data', (data: Buffer) => { process.stdout.write(data) })
  const stderrDecoder = new StringDecoder('utf8')
  let stderrTail = ''
  child.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(data)
    stderrTail = (stderrTail + stderrDecoder.write(data)).slice(-HOST_STDERR_TAIL_CHARS)
  })
  const rpc = new HostRpc({
    send: message => {
      if (!child.connected) throw new Error('DSH Host IPC is disconnected')
      child.send(message as Serializable, error => { if (error) rpc.close(`DSH Host IPC failed: ${error.message}`) })
    },
    listen: receive => { child.on('message', receive); return () => { child.removeListener('message', receive) } },
  }, 120_000)
  child.once('error', error => rpc.close(`DSH Host spawn failed: ${error.message}`))
  child.once('disconnect', () => rpc.close('DSH Host IPC disconnected'))
  const releaseNative = bindNativeRuntime(rpc, options.runtime)
  rpc.handle('certificate', () => options.prepareCertificate())
  rpc.handle('quit', ([code]) => { setImmediate(() => options.requestQuit(code)) })
  let stopping = false
  let exited = false
  let booted = false
  let resolveExit!: () => void
  const exit = new Promise<void>(resolve => { resolveExit = resolve })
  const observeExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (exited) return
    const exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)
    exited = true
    rpc.close(`DSH Host exited (${exitCode})`)
    resolveExit()
    if (!stopping && booted) {
      options.onFailure(
        new Error(`DSH Host exited (${exitCode})${child.pid === undefined ? '' : ` (pid ${String(child.pid)})`}; restart the application to reconnect`),
        {
          exitCode,
          ...(child.pid === undefined ? {} : { hostPid: child.pid }),
          uptimeMs: Math.max(0, performance.now() - forkedAt),
          stderrTail,
        },
      )
    }
    // Electron Crashpad may inherit the stdio pipes, preventing ChildProcess 'close'.
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
  child.once('exit', observeExit)
  child.once('close', observeExit)
  let stopTask: Promise<void> | undefined
  const stop = (): Promise<void> => stopTask ??= (async () => {
    stopping = true
    if (!exited) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      try { await rpc.call('stop', [], controller.signal) } catch { /* terminate an unresponsive Host */ }
      finally { clearTimeout(timeout) }
      if (!exited) child.kill()
      const timeoutExit = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DSH Host termination was not confirmed')), 1_000)
        void exit.then(() => clearTimeout(timer))
      })
      await Promise.race([exit, timeoutExit])
    }
    await releaseNative()
    rpc.close()
  })()
  options.bindHost({ fiber: { dispose: stop } })
  try {
    const { desktopLaunchEnvironment, ...host } = options.host
    await rpc.call('boot', [{ ...host, launchEnvironmentLayers: serializeHostEnvironment(desktopLaunchEnvironment) }, runtimeSnapshot(options.runtime), options.rendererToken])
    booted = true
  } catch (cause) {
    await stop()
    throw cause
  }
}
