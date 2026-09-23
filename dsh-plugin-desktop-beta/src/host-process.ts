/** Electron owns the child lifetime; the child owns the unchanged DSH Web server. */
import { serializeHostEnvironment } from './host-launch-environment.ts'
import { utilityProcess } from 'electron'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
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
  /** Electron's reported code. A terminated Host reports the terminator's code, not a self-chosen one. */
  readonly exitCode: number
  /** Milliseconds between fork and exit; separates an instant death from one hours in. */
  readonly uptimeMs: number
}

export async function startIsolatedDesktopHost(options: IsolatedHostOptions): Promise<void> {
  const forkedAt = performance.now()
  const child = utilityProcess.fork(fileURLToPath(new URL('./host-process-entry.js', import.meta.url)), [], {
    serviceName: 'DSH Host', stdio: 'pipe', cwd: process.cwd(), env: { ...process.env },
  })
  // Keep normal Host logs in its own files; stderr includes bootstrap failures.
  child.stdout?.on('data', (data: Buffer) => { process.stdout.write(data) })
  child.stderr?.on('data', (data: Buffer) => { process.stderr.write(data) })
  const rpc = new HostRpc({
    send: message => child.postMessage(message),
    listen: receive => { child.on('message', receive); return () => { child.removeListener('message', receive) } },
  }, 120_000)
  const releaseNative = bindNativeRuntime(rpc, options.runtime)
  rpc.handle('certificate', () => options.prepareCertificate())
  rpc.handle('quit', ([code]) => { setImmediate(() => options.requestQuit(code)) })
  let stopping = false
  let exited = false
  let booted = false
  let resolveExit!: () => void
  const exit = new Promise<void>(resolve => { resolveExit = resolve })
  child.once('exit', (code) => {
    exited = true
    rpc.close(`DSH Host exited (${code})`)
    resolveExit()
    if (!stopping && booted) {
      options.onFailure(
        new Error(`DSH Host exited (${code}); restart the application to reconnect`),
        { exitCode: code, uptimeMs: Math.max(0, performance.now() - forkedAt) },
      )
    }
  })
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
