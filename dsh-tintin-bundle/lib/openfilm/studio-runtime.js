// OpenFilm Studio launcher (host side). The Studio server is a detached local
// process started by the OpenFilm CLI (`openfilm open`); this module finds the
// vendored runtime, starts/attaches to Studio without opening the system
// browser (OPENFILM_NO_BROWSER=1 — the desktop shell owns the window), and
// returns the address the shell should load.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The Studio address line the CLI prints: `Studio   http://127.0.0.1:4747/open?key=…`. */
export function parseStudioAddress(text) {
  const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/)
  if (!match) return null
  try {
    const url = new URL(match[0])
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** ~/.openfilm/run.json — what the running Studio wrote once it listened. */
export function readStudioRun(homeDir) {
  try {
    const raw = JSON.parse(readFileSync(join(String(homeDir || ''), '.openfilm', 'run.json'), 'utf8'))
    if (typeof raw?.origin !== 'string' || typeof raw?.key !== 'string') return null
    return { origin: raw.origin.replace(/\/+$/, ''), key: String(raw.key), pid: Number(raw.pid) || 0 }
  } catch {
    return null
  }
}

/** The page address for a Studio run (the key authorizes the page). */
export const studioPageUrl = (run) => (run ? `${run.origin}/open?key=${encodeURIComponent(run.key)}` : '')

/**
 * Locate the vendored OpenFilm runtime ({ root, node, cli, browsers }). Order:
 * TINTIN_OPENFILM_RUNTIME (root), TINTIN_BIN_DIR (resources/bin → resources),
 * then the dev checkout's tintin-resources beside this bundle package. null
 * when nothing usable is present — the caller reports the setup gap.
 * @param {{ env?: Record<string, string | undefined>, bundleDir?: string }} [options]
 */
export function resolveOpenfilmRuntime({ env = process.env, bundleDir } = {}) {
  const candidates = []
  const explicit = String(env.TINTIN_OPENFILM_RUNTIME || '').trim()
  if (explicit) candidates.push(explicit)
  const binDir = String(env.TINTIN_BIN_DIR || '').trim()
  if (binDir) candidates.push(dirname(binDir))
  if (bundleDir) candidates.push(join(dirname(bundleDir), 'dsh-plugin-desktop-tintin', 'tintin-resources'))
  for (const root of candidates) {
    const node = join(root, 'openfilm', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const cli = join(root, 'openfilm', 'node_modules', 'openfilm', 'bin', 'openfilm.mjs')
    if (!existsSync(node) || !existsSync(cli)) continue
    const browsers = join(root, 'playwright-browsers')
    return { root, node, cli, browsers: existsSync(browsers) ? browsers : null }
  }
  return null
}

/** Environment for a Studio child: no browser hand-off, vendored Chromium when present. */
export function studioEnv(runtime, env = process.env) {
  const next = { ...env, OPENFILM_NO_BROWSER: '1' }
  if (runtime?.browsers && !next.PLAYWRIGHT_BROWSERS_PATH) next.PLAYWRIGHT_BROWSERS_PATH = runtime.browsers
  return next
}

/**
 * Start (or attach to) Studio for `folder` and resolve with `{ url, origin, key, pid }`.
 * The CLI detaches the Studio server and exits; we read the address it prints,
 * falling back to run.json. Throws a sentence the UI can show on failure.
 * @param {{ folder?: string | null, runtime: NonNullable<ReturnType<typeof resolveOpenfilmRuntime>>,
 *   homeDir: string, timeoutMs?: number, env?: Record<string, string | undefined> }} options
 */
export function startStudio({ folder, runtime, homeDir, timeoutMs = 45_000, env = process.env }) {
  return new Promise((resolve, reject) => {
    const args = [runtime.cli, 'open', ...(folder ? [String(folder)] : [])]
    const child = spawn(runtime.node, args, { env: studioEnv(runtime, env), windowsHide: true })
    let output = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const adopt = () => {
      const printed = parseStudioAddress(output)
      const run = readStudioRun(homeDir)
      const url = printed || studioPageUrl(run)
      if (!url) return finish(new Error(`Studio 未返回地址：${output.trim().split('\n').slice(-3).join(' / ') || '无输出'}`))
      finish(null, { url, origin: new URL(url).origin, key: run?.key ?? '', pid: run?.pid ?? 0 })
    }
    child.stdout?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-64 * 1024)
      if (parseStudioAddress(output)) adopt()
    })
    child.stderr?.on('data', (chunk) => { output = (output + String(chunk)).slice(-64 * 1024) })
    child.on('error', (error) => finish(new Error(`OpenFilm CLI 启动失败：${error.message}`)))
    child.on('exit', (code) => {
      if (code === 2) return finish(new Error('未找到 OpenFilm 项目：请让 agent 先在会话工作区创建影片'))
      if (code !== 0 && !parseStudioAddress(output)) return finish(new Error(`OpenFilm CLI 退出码 ${code}：${output.trim().slice(-500)}`))
      adopt()
    })
    const timer = setTimeout(() => {
      if (parseStudioAddress(output)) adopt()
      else {
        try { child.kill() } catch { /* 已退出 */ }
        finish(new Error(`Studio 启动超时（${Math.round(timeoutMs / 1000)}s）`))
      }
    }, timeoutMs)
    timer.unref?.()
    child.once('exit', () => clearTimeout(timer))
  })
}
