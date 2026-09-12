import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 3029
const HEALTH_PATH = '/api/health'
const START_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 250

export type ProductVisualRuntimeState = 'STOPPED' | 'STARTING' | 'READY' | 'FAILED'

export interface ProductVisualRuntimeSnapshot {
  readonly state: ProductVisualRuntimeState
  readonly port: number
  readonly error?: string
}

function rootFromEnvironment(): string {
  const configured = process.env.DSH_PRODUCT_VISUAL_ROOT?.trim()
  if (configured) return resolve(configured)
  const fromCurrentDirectory = resolve(process.cwd(), 'product-visual-backend')
  const fromPlugin = resolve(dirname(fileURLToPath(import.meta.url)), '../../product-visual-backend')
  const fromParentDirectory = resolve(process.cwd(), '..', 'product-visual-backend')
  return [fromCurrentDirectory, fromPlugin, fromParentDirectory].find(path => existsSync(path)) ?? fromCurrentDirectory
}

function pythonFromEnvironment(root: string): string {
  const configured = process.env.DSH_PRODUCT_VISUAL_PYTHON?.trim()
  if (configured) return configured
  const userRuntime = resolve(homedir(), '.dsh/product-visual-venv/bin/python')
  if (existsSync(userRuntime)) return userRuntime
  const bundled = resolve(root, '.venv/bin/python')
  if (existsSync(bundled)) return bundled
  return 'python3'
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`, { signal: AbortSignal.timeout(800) })
    return response.ok
  } catch {
    return false
  }
}

export class ProductVisualSidecar {
  private child: ChildProcess | undefined
  private state: ProductVisualRuntimeState = 'STOPPED'
  private error: string | undefined
  private starting: Promise<ProductVisualRuntimeSnapshot> | undefined
  private readonly port: number

  constructor(port = Number(process.env.DSH_PRODUCT_VISUAL_PORT ?? DEFAULT_PORT)) {
    this.port = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT
  }

  snapshot(): ProductVisualRuntimeSnapshot {
    return { state: this.state, port: this.port, ...(this.error ? { error: this.error } : {}) }
  }

  async ensureReady(): Promise<ProductVisualRuntimeSnapshot> {
    if (this.state === 'READY' && await isHealthy(this.port)) return this.snapshot()
    if (this.starting) return this.starting
    this.starting = this.startInternal().finally(() => { this.starting = undefined })
    return this.starting
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.state = 'STOPPED'
    this.error = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolvePromise => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise() }, 2_000)
      child.once('close', () => { clearTimeout(timer); resolvePromise() })
      child.kill('SIGTERM')
    })
  }

  private async startInternal(): Promise<ProductVisualRuntimeSnapshot> {
    this.state = 'STARTING'
    this.error = undefined
    const root = rootFromEnvironment()
    const python = pythonFromEnvironment(root)
    try {
      this.child = spawn(python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(this.port)], {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      this.child.stderr?.setEncoding('utf8')
      this.child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2000) })
      this.child.once('error', cause => {
        this.state = 'FAILED'
        this.error = cause instanceof Error ? cause.message : String(cause)
      })
      this.child.once('close', code => {
        if (this.state === 'STARTING' || this.state === 'READY') {
          this.state = code === 0 ? 'STOPPED' : 'FAILED'
          if (code !== 0) this.error = stderr.trim() || `商品视觉服务退出，code=${String(code)}`
        }
      })
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (await isHealthy(this.port)) {
          this.state = 'READY'
          return this.snapshot()
        }
        await new Promise(resolvePromise => setTimeout(resolvePromise, POLL_INTERVAL_MS))
      }
      throw new Error(this.error || `商品视觉服务健康检查超时（${this.port}）`)
    } catch (cause) {
      this.state = 'FAILED'
      this.error = cause instanceof Error ? cause.message : String(cause)
      await this.stop()
      this.state = 'FAILED'
      return this.snapshot()
    }
  }
}
