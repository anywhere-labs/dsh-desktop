import type {} from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WorkspaceLaunchRequest } from './workspace-launch-contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { desktopWorkspaceLaunches: WorkspaceLaunchQueue }
}

/** Parse one positional directory; -- permits directory names beginning with a dash. */
export function launchDirectory(args: readonly string[]): string | undefined {
  const paths = args[0] === '--' ? args.slice(1) : args
  if (paths.length === 0) return undefined
  if (paths.length !== 1 || paths[0] === '' || (args[0] !== '--' && paths[0]!.startsWith('-'))) {
    throw new Error('unknown arguments: expected one workspace directory (use -- before a directory beginning with -).')
  }
  return paths[0]
}


/** Electron may reorder/add Chromium switches in second-instance argv; use its data channel. */
export function forwardedWorkspaceArguments(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'object' || value === null || !('workspaceLaunchArgs' in value)) return undefined
  const args: unknown = value.workspaceLaunchArgs
  if (!Array.isArray(args) || args.length > 32 || !args.every(arg => typeof arg === 'string' && arg.length <= 32768)) return undefined
  return args as string[]
}

/** Bounded, process-local delivery; unacknowledged requests survive renderer reloads. */
export class WorkspaceLaunchQueue {
  private readonly requests: WorkspaceLaunchRequest[] = []
  private wake: (() => void) | undefined
  private accepting: Promise<void> = Promise.resolve()
  private outstanding = 0
  private disposed = false
  constructor(
    private readonly validate: (path: string) => Promise<boolean>,
    private readonly report: (message: string) => void,
    private readonly show: () => void,
  ) {}

  submit(args: readonly string[], cwd: string): void {
    if (this.disposed) return
    let path: string | undefined
    try { path = launchDirectory(args) } catch (error) { this.report(String(error)); return }
    if (path === undefined) return
    if (this.outstanding >= 16) { this.report('Too many pending workspace requests.'); return }
    this.outstanding += 1
    const target = resolve(cwd, path)
    this.accepting = this.accepting.then(async () => {
      let queued = false
      try {
        const canonical = await realpath(target)
        if (!(await stat(canonical)).isDirectory()) throw new Error(`Not a directory: ${target}`)
        if (this.disposed || !await this.validate(canonical) || this.disposed) return
        if (this.requests.some(request => request.path === canonical)) return
        this.requests.push({ id: randomUUID(), path: canonical })
        queued = true
        this.wake?.()
      } catch (error) {
        if (!this.disposed) this.report(`Could not open workspace ${target}: ${String(error)}`)
      } finally { if (!queued) this.outstanding -= 1 }
    })
  }

  async next(signal: AbortSignal): Promise<WorkspaceLaunchRequest | null> {
    if (this.disposed || signal.aborted) return null
    if (this.requests[0]) return this.requests[0]
    // A replaced renderer must not leave an orphaned long poll.
    this.wake?.()
    await new Promise<void>(resolveWait => {
      const finish = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        if (this.wake === finish) this.wake = undefined
        resolveWait()
      }
      const timer = setTimeout(finish, 20_000)
      this.wake = finish
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
    return this.disposed || signal.aborted ? null : this.requests[0] ?? null
  }

  complete(id: string, error?: string): boolean {
    if (this.requests[0]?.id !== id) return false
    this.requests.shift()
    this.outstanding -= 1
    if (error !== undefined) this.report(error)
    else this.show()
    return true
  }

  dispose(): void { this.disposed = true; this.requests.length = 0; this.wake?.() }
}
