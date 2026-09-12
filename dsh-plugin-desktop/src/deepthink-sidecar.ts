import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 9899
const START_TIMEOUT_MS = 60_000
const PREPARE_TIMEOUT_MS = 8 * 60_000

export type DeepThinkRuntimeState = 'STOPPED' | 'STARTING' | 'READY' | 'FAILED'
export interface DeepThinkRuntimeSnapshot {
  readonly state: DeepThinkRuntimeState
  readonly port: number
  readonly error?: string
}

function deepThinkRoot(): string {
  const configured = process.env.DSH_DEEPTHINK_ROOT?.trim()
  if (configured) return resolve(configured)
  const candidates = [
    resolve(process.cwd(), 'dsh-plugin-desktop/deepthink'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../deepthink'),
  ]
  return candidates.find(path => existsSync(path)) ?? candidates[0]!
}

function deepThinkNode(): string {
  const configured = process.env.DSH_DEEPTHINK_NODE?.trim()
  if (configured) return configured
  return process.versions.electron === undefined ? process.execPath : 'node'
}

async function healthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch { return false }
}

export function deepThinkWebBuildIsRoutable(indexPath: string): boolean {
  if (!existsSync(indexPath)) return false
  try {
    const html = readFileSync(indexPath, 'utf8')
    return html.includes('src="/deepthink/assets/')
      && html.includes('href="/deepthink/assets/')
  } catch {
    return false
  }
}

function latestTypeScriptMtime(directory: string): number {
  if (!existsSync(directory)) return 0
  let latest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) latest = Math.max(latest, latestTypeScriptMtime(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) latest = Math.max(latest, statSync(path).mtimeMs)
  }
  return latest
}

export function deepThinkBackendBuildIsCurrent(root: string, entryPath: string): boolean {
  if (!existsSync(entryPath)) return false
  try {
    const latestSource = latestTypeScriptMtime(resolve(root, 'src'))
    return latestSource === 0 || statSync(entryPath).mtimeMs >= latestSource
  } catch {
    return false
  }
}

export class DeepThinkSidecar {
  private child: ChildProcess | undefined
  private state: DeepThinkRuntimeState = 'STOPPED'
  private error: string | undefined
  private starting: Promise<DeepThinkRuntimeSnapshot> | undefined
  readonly port: number

  constructor(port = Number(process.env.DSH_DEEPTHINK_PORT ?? DEFAULT_PORT)) {
    this.port = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT
  }

  snapshot(): DeepThinkRuntimeSnapshot { return { state: this.state, port: this.port, ...(this.error ? { error: this.error } : {}) } }

  async ensureReady(): Promise<DeepThinkRuntimeSnapshot> {
    if (this.state === 'READY' && await healthy(this.port)) return this.snapshot()
    if (this.starting) return this.starting
    this.starting = this.startInternal().finally(() => { this.starting = undefined })
    return this.starting
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined; this.state = 'STOPPED'; this.error = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolvePromise => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise() }, 2_000)
      child.once('close', () => { clearTimeout(timer); resolvePromise() })
      child.kill('SIGTERM')
    })
  }

  private async startInternal(): Promise<DeepThinkRuntimeSnapshot> {
    this.state = 'STARTING'; this.error = undefined
    const root = deepThinkRoot()
    try {
      const entry = resolve(root, 'dist/index.js')
      const webEntry = resolve(root, 'web/dist/index.html')
      if (!deepThinkBackendBuildIsCurrent(root, entry) || !deepThinkWebBuildIsRoutable(webEntry)) await this.prepare(root)
      if (!deepThinkBackendBuildIsCurrent(root, entry) || !deepThinkWebBuildIsRoutable(webEntry)) {
        throw new Error(`DeepThink build artifacts are missing or use the wrong web base path under ${root}`)
      }
      this.child = spawn(deepThinkNode(), [entry], {
        cwd: root,
        env: {
          ...process.env,
          WEB_PORT: String(this.port),
          DEEPTHINK_WEB_DIST_DIR: resolve(root, 'web/dist'),
          DSH_LOCAL_ADMIN_MODE: '1',
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      this.child.stderr?.setEncoding('utf8')
      this.child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-3000) })
      this.child.once('error', cause => { this.state = 'FAILED'; this.error = cause instanceof Error ? cause.message : String(cause) })
      this.child.once('close', code => {
        if (this.state === 'STARTING' || this.state === 'READY') {
          this.state = code === 0 ? 'STOPPED' : 'FAILED'
          if (code !== 0) this.error = stderr.trim() || `DeepThink exited with code ${String(code)}`
        }
      })
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (await healthy(this.port)) { this.state = 'READY'; return this.snapshot() }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 300))
      }
      throw new Error(this.error || `DeepThink health check timed out on ${this.port}`)
    } catch (cause) {
      this.state = 'FAILED'; this.error = cause instanceof Error ? cause.message : String(cause)
      await this.stop(); this.state = 'FAILED'
      return this.snapshot()
    }
  }

  private async prepare(root: string): Promise<void> {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      let error = ''
      child.stderr?.setEncoding('utf8'); child.stderr?.on('data', chunk => { error = `${error}${String(chunk)}`.slice(-3000) })
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('DeepThink dependency installation timed out')) }, PREPARE_TIMEOUT_MS)
      child.once('error', reject); child.once('close', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(error.trim() || `DeepThink npm install failed with code ${String(code)}`)) })
    })
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(npm, ['run', 'build:all'], { cwd: root, env: { ...process.env, VITE_BASE_PATH: '/deepthink/' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let error = ''
      child.stderr?.setEncoding('utf8'); child.stderr?.on('data', chunk => { error = `${error}${String(chunk)}`.slice(-3000) })
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('DeepThink build timed out')) }, PREPARE_TIMEOUT_MS)
      child.once('error', reject); child.once('close', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(error.trim() || `DeepThink build failed with code ${String(code)}`)) })
    })
  }
}
