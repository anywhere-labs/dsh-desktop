// OpenFilm Studio launcher (host side). The Studio server is a detached local
// process started by the OpenFilm CLI (`openfilm open`); this module finds the
// vendored runtime, starts/attaches to Studio without opening the system
// browser (OPENFILM_NO_BROWSER=1 — the desktop shell owns the window), and
// returns the address the shell should load.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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

/** The project path the CLI prints (`project  D:\films\launch-video`), for the chat to work in. */
export function parseStudioProject(text) {
  const match = String(text || '').match(/^\s*project\s+(.+?)\s*$/mu)
  return match ? match[1] : null
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

/**
 * This channel's own OpenFilm home (settings, keys, run.json). The official
 * OpenFilm desktop app shares `~/.openfilm` and its usual port 4747: attaching
 * to that Studio serves its native page, which needs that app's Electron
 * preload and paints black inside this shell, and its open log file blocks a
 * second Studio from starting. Use `OPENFILM_HOME` when set, else a sibling of
 * the harness home; the project library (`OPENFILM_LIBRARY`) stays shared.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function tintinStudioHome(env = process.env) {
  const explicit = String(env.OPENFILM_HOME || '').trim()
  if (explicit) return explicit
  const harnessHome = String(env.DSH_HOME || '').trim()
  return join(harnessHome !== '' ? harnessHome : homedir(), 'openfilm-studio')
}

/** run.json inside a Studio home (not the person's home). */
export function readStudioRunAt(studioHome) {
  try {
    const raw = JSON.parse(readFileSync(join(String(studioHome || ''), 'run.json'), 'utf8'))
    if (typeof raw?.origin !== 'string' || typeof raw?.key !== 'string') return null
    return { origin: raw.origin.replace(/\/+$/, ''), key: String(raw.key), pid: Number(raw.pid) || 0 }
  } catch {
    return null
  }
}

/** The project a Studio home last opened (`studio.json` recent[0]), when its folder still exists. */
export function lastStudioProject(studioHome) {
  try {
    const raw = JSON.parse(readFileSync(join(String(studioHome || ''), 'studio.json'), 'utf8'))
    const path = raw?.recent?.[0]?.path
    return typeof path === 'string' && path && existsSync(path) ? path : null
  } catch {
    return null
  }
}

/**
 * Seed the isolated Studio's recent list from the shared OpenFilm home the first
 * time (the user's existing projects show up in the embedded Studio). Never
 * overwrites a non-empty recent list.
 * @param {{ studioHome: string, sourceHome: string, log?: (message: string) => void }} options
 */
export function seedStudioRecents({ studioHome, sourceHome, log = () => {} }) {
  try {
    const target = join(String(studioHome || ''), 'studio.json')
    const current = JSON.parse(readFileSync(target, 'utf8'))
    if (Array.isArray(current?.recent) && current.recent.length > 0) return { status: 'kept' }
  } catch { /* absent or broken: seed below */ }
  try {
    const source = JSON.parse(readFileSync(join(String(sourceHome || ''), 'studio.json'), 'utf8'))
    const recent = Array.isArray(source?.recent)
      ? source.recent.filter((item) => item && typeof item.path === 'string' && existsSync(item.path))
      : []
    if (!recent.length) return { status: 'empty' }
    const target = join(String(studioHome || ''), 'studio.json')
    let current = {}
    try { current = JSON.parse(readFileSync(target, 'utf8')) } catch { /* new file */ }
    mkdirSync(String(studioHome || ''), { recursive: true })
    writeFileSync(target, `${JSON.stringify({ ...(current && typeof current === 'object' ? current : {}), recent }, null, 2)}\n`)
    log(`seeded ${recent.length} recent project(s)`)
    return { status: 'seeded', count: recent.length }
  } catch {
    return { status: 'empty' }
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

/**
 * Environment for a Studio child: no browser hand-off, its own Studio home and
 * port (so the official OpenFilm desktop app on ~/.openfilm + port 4747 is
 * never adopted), and the vendored Chromium when present.
 * @param {{ browsers?: string | null } | null | undefined} runtime
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string | undefined>}
 */
export function studioEnv(runtime, env = process.env) {
  const next = { ...env, OPENFILM_NO_BROWSER: '1' }
  if (String(next.OPENFILM_HOME || '').trim() === '') next.OPENFILM_HOME = tintinStudioHome(env)
  if (String(next.OPENFILM_STUDIO_PORT || '').trim() === '') next.OPENFILM_STUDIO_PORT = '4788'
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
    const childEnvironment = studioEnv(runtime, env)
    const child = spawn(runtime.node, args, { env: childEnvironment, windowsHide: true })
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
      // The isolated home is authoritative; fall back to the legacy shared one
      // so a Studio started by an older build still answers.
      const run = readStudioRunAt(childEnvironment.OPENFILM_HOME) ?? readStudioRun(homeDir)
      const url = printed || studioPageUrl(run)
      if (!url) return finish(new Error(`Studio 未返回地址：${output.trim().split('\n').slice(-3).join(' / ') || '无输出'}`))
      finish(null, {
        url,
        origin: new URL(url).origin,
        key: run?.key ?? '',
        pid: run?.pid ?? 0,
        project: parseStudioProject(output) || lastStudioProject(childEnvironment.OPENFILM_HOME),
      })
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
