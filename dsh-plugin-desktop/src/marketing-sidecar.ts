/** Marke侧车：spawn 营销智能引擎(Python stdlib facade)并暴露端口。仿 product-visual-sidecar.ts。 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 3039
const HEALTH_PATH = '/health'
const START_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 250

export type MarketingRuntimeState = 'STOPPED' | 'STARTING' | 'READY' | 'FAILED'
export interface MarketingRuntimeSnapshot { readonly state: MarketingRuntimeState; readonly port: number; readonly error?: string }

function rootFromEnvironment(): string {
  const configured = process.env.DSH_MARKETING_ROOT?.trim()
  if (configured) return resolve(configured)
  const candidates = [
    resolve(process.cwd(), '../marketing-intelligence-engine'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../marketing-intelligence-engine'),
    '/Volumes/SSK SSD/jian-koubo-studio os/marketing-intelligence-engine',
  ]
  return candidates.find(path => existsSync(path)) ?? candidates[0]!
}

function pythonFromEnvironment(): string {
  return process.env.DSH_MARKETING_PYTHON?.trim() || 'python3'
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`, { signal: AbortSignal.timeout(800) })
    return response.ok
  } catch { return false }
}

export class MarketingSidecar {
  private child: ChildProcess | undefined
  private state: MarketingRuntimeState = 'STOPPED'
  private error: string | undefined
  private starting: Promise<MarketingRuntimeSnapshot> | undefined
  private readonly port: number
  constructor(port = Number(process.env.DSH_MARKETING_PORT ?? DEFAULT_PORT)) {
    this.port = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT
  }
  snapshot(): MarketingRuntimeSnapshot { return { state: this.state, port: this.port, ...(this.error ? { error: this.error } : {}) } }
  async ensureReady(): Promise<MarketingRuntimeSnapshot> {
    if (this.state === 'READY' && await isHealthy(this.port)) return this.snapshot()
    if (this.starting) return this.starting
    this.starting = this.startInternal().finally(() => { this.starting = undefined })
    return this.starting
  }
  async stop(): Promise<void> {
    const child = this.child; this.child = undefined; this.state = 'STOPPED'; this.error = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolvePromise => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise() }, 2_000)
      child.once('close', () => { clearTimeout(timer); resolvePromise() })
      child.kill('SIGTERM')
    })
  }
  private async startInternal(): Promise<MarketingRuntimeSnapshot> {
    this.state = 'STARTING'; this.error = undefined
    const root = rootFromEnvironment(); const python = pythonFromEnvironment()
    try {
      this.child = spawn(python, ['examples/run_service.py', String(this.port)], {
        cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      this.child.stderr?.setEncoding('utf8')
      this.child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2000) })
      this.child.once('error', cause => { this.state = 'FAILED'; this.error = cause instanceof Error ? cause.message : String(cause) })
      this.child.once('close', code => {
        if (this.state === 'STARTING' || this.state === 'READY') {
          this.state = code === 0 ? 'STOPPED' : 'FAILED'
          if (code !== 0) this.error = stderr.trim() || `营销引擎退出，code=${String(code)}`
        }
      })
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (await isHealthy(this.port)) { this.state = 'READY'; return this.snapshot() }
        await new Promise(resolvePromise => setTimeout(resolvePromise, POLL_INTERVAL_MS))
      }
      throw new Error(this.error || `营销引擎健康检查超时（${this.port}）`)
    } catch (cause) {
      this.state = 'FAILED'; this.error = cause instanceof Error ? cause.message : String(cause)
      await this.stop(); this.state = 'FAILED'; return this.snapshot()
    }
  }
}
