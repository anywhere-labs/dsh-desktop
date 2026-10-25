// OpenFilm Studio launcher (host side). The Studio server is a detached local
// process started by the OpenFilm CLI (`openfilm open`); this module finds the
// vendored runtime, starts/attaches to Studio without opening the system
// browser (OPENFILM_NO_BROWSER=1 — the desktop shell owns the window), and
// returns the address the shell should load.
// 实例所有权(2026-10-23 用户裁决, 见 .agents/notes/proposed/architecture/
// 2026-10-23-tintin-studio-service-lifecycle-ownership.zh.md):附着前做指纹对账——
// run.json 存在但指纹不符(旧构建/官方 app 启动的服务)时,结束陈旧实例并以当前
// 资源重启。指纹 = openfilm 包版本 + editor dist(index.html + 资产名)摘要,落
// 在本模块,main-hook 不再自行解释 run.json。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    return { origin: raw.origin.replace(/\/+$/, ''), key: String(raw.key), pid: Number(raw.pid) || 0, supervisor: Number(raw.supervisor) || 0 }
  } catch {
    return null
  }
}

/** The vendored openfilm package dir for a runtime root (editor dist lives inside it). */
const openfilmPackageDir = (runtime) => join(runtime.root, 'openfilm', 'node_modules', 'openfilm')

/**
 * DSH 侧的实例指纹:openfilm 包版本 + editor dist 摘要(index.html 全文 + 资产清单)。
 * shell overlay 换 dist、升级 openfilm 包都会改变指纹 —— 附着时对账的依据。
 * 无法计算(运行时缺文件)时返回 '',此时跳过对账(保持旧行为,不误杀)。
 * @param {NonNullable<ReturnType<typeof resolveOpenfilmRuntime>>} runtime
 * @returns {string}
 */
export function editorFingerprint(runtime) {
  try {
    const pkg = JSON.parse(readFileSync(join(openfilmPackageDir(runtime), 'package.json'), 'utf8'))
    const dist = join(openfilmPackageDir(runtime), 'studio', 'ui', 'dist')
    const index = readFileSync(join(dist, 'index.html'))
    const assets = readdirSync(join(dist, 'assets')).sort().join('\n')
    const hash = createHash('sha256').update(index).update(assets).digest('hex').slice(0, 16)
    return `${String(pkg.version ?? '0')}-${hash}`
  } catch {
    return ''
  }
}

/** DSH 侧账本:记录「当前这个服务进程是我们以哪个指纹启动的」。与 run.json 同目录。 */
const sidecarPath = (studioHome) => join(String(studioHome || ''), 'run.tintin.json')

function readSidecar(studioHome) {
  try {
    const raw = JSON.parse(readFileSync(sidecarPath(studioHome), 'utf8'))
    return typeof raw?.fingerprint === 'string' ? raw : null
  } catch {
    return null
  }
}

function writeSidecar(studioHome, fingerprint) {
  try {
    writeFileSync(sidecarPath(studioHome), `${JSON.stringify({ fingerprint, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch { /* 账本写不进只影响下次对账(按无账本=陈旧处理),不阻断启动 */ }
}

/**
 * 运行中服务实际伺服的编辑器,是否就是自有 dist(2026-10-23 补课):fetch 服务页面,
 * 比对 index.html 里的主资产名。账本可能被毒化(supervisor 复活旧服务后 CLI 附着,
 * 旧账被新指纹覆盖),所以指纹相符不够,要验服务本身。identity 为空 → 视为相符
 * (算不出自有身份时宁可不杀,见 editorFingerprint 同一口径)。
 * @param {string} origin
 * @param {string} key
 * @param {string} identityHtml 自有 dist 的 index.html 全文
 * @returns {Promise<boolean>}
 */
export async function serverServesOwnedEditor(origin, key, identityHtml) {
  const ownedAsset = /assets\/index-[^"']+\.js/.exec(String(identityHtml || ''))?.[0] ?? ''
  if (!ownedAsset) return true
  try {
    const res = await fetch(`${origin}/open?key=${encodeURIComponent(key)}`)
    const body = await res.text()
    return body.includes(ownedAsset)
  } catch {
    return false /* 服务不应答:按陈旧处理(对账会清场冷启) */
  }
}

/**
 * 附着前的对账:已有服务但账本缺失、指纹不符、或服务实际伺服的不是自有编辑器
 * → 结束陈旧实例(pid + supervisor),清 run.json 与账本,让本次 spawn 以当前
 * 资源起新服务。返回是否清理过。
 * @param {string} studioHome
 * @param {string} fingerprint
 * @param {{ verify?: () => Promise<boolean> }} [options]
 *   verify:指纹之外的服务实测(账本可被 supervisor 复活竞态毒化,见
 *   serverServesOwnedEditor);缺省只按账本判 —— 有实测时应传入。
 * @returns {Promise<boolean>}
 */
export async function reconcileStudioInstance(studioHome, fingerprint, { verify } = {}) {
  const run = readStudioRunAt(studioHome)
  if (!run) return false
  if (fingerprint === '') return false /* 算不出指纹:不误杀(见 editorFingerprint) */
  const side = readSidecar(studioHome)
  if (side && side.fingerprint === fingerprint) {
    if (verify === undefined || (await verify())) return false /* 版本相符且实测相符:附着即可 */
    /* 账本相符但实测不符:账本被毒化,按陈旧清场 */
  }
  /* 先杀 supervisor 再杀服务:顺序反了会被 supervisor 立即拉起新实例 */
  for (const pid of [run.supervisor, run.pid]) {
    if (typeof pid === 'number' && pid > 0) {
      try { process.kill(pid) } catch { /* 已退出 */ }
    }
  }
  try { rmSync(join(String(studioHome || ''), 'run.json'), { force: true }) } catch { /* 无文件 */ }
  try { rmSync(sidecarPath(studioHome), { force: true }) } catch { /* 无文件 */ }
  return true
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
 * Locate the vendored OpenFilm runtime ({ root, node, cli, browsers, source }).
 * 运行时归属校验(2026-10-23 实障:陈旧 env 指向旧拷贝,伺服旧 shell 构建,页面桥
 * 失配黑屏)——候选顺序以 app 自有资源为先:TINTIN_BIN_DIR(桌面主进程只从自身
 * resources/bin 设置,可信)、开发工位 tintin-resources(bundleDir 同源);外部
 * TINTIN_OPENFILM_RUNTIME 降为最后兜底,且只在自有运行时缺失时才被采用。
 * source 记录命中来源,便于诊断「伺服的不是自己的 dist」。
 * null when nothing usable is present — the caller reports the setup gap.
 * @param {{ env?: Record<string, string | undefined>, bundleDir?: string }} [options]
 */
export function resolveOpenfilmRuntime({ env = process.env, bundleDir } = {}) {
  const candidates = []
  const binDir = String(env.TINTIN_BIN_DIR || '').trim()
  if (binDir) candidates.push({ root: dirname(binDir), source: 'bin' })
  if (bundleDir) candidates.push({ root: join(dirname(bundleDir), 'dsh-plugin-desktop-tintin', 'tintin-resources'), source: 'dev' })
  const explicit = String(env.TINTIN_OPENFILM_RUNTIME || '').trim()
  if (explicit) candidates.push({ root: explicit, source: 'env' })
  for (const { root, source } of candidates) {
    const node = join(root, 'openfilm', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const cli = join(root, 'openfilm', 'node_modules', 'openfilm', 'bin', 'openfilm.mjs')
    if (!existsSync(node) || !existsSync(cli)) continue
    const browsers = join(root, 'playwright-browsers')
    return { root, node, cli, browsers: existsSync(browsers) ? browsers : null, source }
  }
  return null
}

/**
 * Environment for a Studio child: no browser hand-off, its own Studio home and
 * port (so the official OpenFilm desktop app on ~/.openfilm + port 4747 is
 * never adopted), and the vendored Chromium when present. With
 * `openaiCompatUrl` the OpenAI provider is pointed at the TinTin server's
 * OpenAI-compatible /v1 surface with a placeholder key, so Studio's built-in
 * features (make subtitles…) call the server directly instead of falling back
 * to agent tool round trips. Skipped when this process already carries an
 * OpenAI key or URL of its own, or when the person pasted their own openai key
 * into the isolated Studio home — a file key outranks the env one, and it must
 * reach api.openai.com, never the server.
 * @param {{ browsers?: string | null } | null | undefined} runtime
 * @param {Record<string, string | undefined>} [env]
 * @param {{ openaiCompatUrl?: string | null }} [compat]
 * @returns {Record<string, string | undefined>}
 */
export function studioEnv(runtime, env = process.env, { openaiCompatUrl } = {}) {
  const next = { ...env, OPENFILM_NO_BROWSER: '1' }
  if (String(next.OPENFILM_HOME || '').trim() === '') next.OPENFILM_HOME = tintinStudioHome(env)
  if (String(next.OPENFILM_STUDIO_PORT || '').trim() === '') next.OPENFILM_STUDIO_PORT = '4788'
  if (runtime?.browsers && !next.PLAYWRIGHT_BROWSERS_PATH) next.PLAYWRIGHT_BROWSERS_PATH = runtime.browsers
  const compat = String(openaiCompatUrl || '').trim().replace(/\/+$/, '')
  if (compat && String(next.OPENFILM_OPENAI_URL || '').trim() === '' && String(next.OPENAI_API_KEY || '').trim() === '') {
    let personOpenaiKey = false
    try {
      personOpenaiKey = Boolean(JSON.parse(readFileSync(join(next.OPENFILM_HOME, 'providers.json'), 'utf8'))?.keys?.openai)
    } catch { /* 无文件或坏文件：照常注入 */ }
    if (!personOpenaiKey) {
      next.OPENFILM_OPENAI_URL = compat
      next.OPENAI_API_KEY = 'tintin-server'
    }
  }
  return next
}

/**
 * Start (or attach to) Studio for `folder` and resolve with `{ url, origin, key, pid }`.
 * The CLI detaches the Studio server and exits; we read the address it prints,
 * falling back to run.json. Throws a sentence the UI can show on failure.
 * @param {{ folder?: string | null, runtime: NonNullable<ReturnType<typeof resolveOpenfilmRuntime>>,
 *   homeDir: string, timeoutMs?: number, env?: Record<string, string | undefined>,
 *   openaiCompatUrl?: string | null }} options
 */
export function startStudio({ folder, runtime, homeDir, timeoutMs = 45_000, env = process.env, openaiCompatUrl }) {
  return new Promise((resolve, reject) => {
    const args = [runtime.cli, 'open', ...(folder ? [String(folder)] : [])]
    const childEnvironment = studioEnv(runtime, env, { openaiCompatUrl })
    const fingerprint = editorFingerprint(runtime)
    // 自有编辑器身份:服务的实测比对基准(账本可能被 supervisor 复活竞态毒化)。
    let identity = ''
    try { identity = readFileSync(join(openfilmPackageDir(runtime), 'studio', 'ui', 'dist', 'index.html'), 'utf8') } catch { /* 空:只按账本对账 */ }
    const studioHome = childEnvironment.OPENFILM_HOME
    const prePid = readStudioRunAt(studioHome)?.pid ?? 0
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
      // 记账仅限「确认是我们的孩子冷启」:spawn 前记下旧 pid,adopt 时 run.json 的
      // pid 变了才是新服务。附着到既有服务时不覆盖账本 —— 覆盖会把 owned 指纹记到
      // 实际伺服旧 dist 的服务上,毒化对账(CLI 打印地址在附着模式也可能发生,不作判据)。
      if (fingerprint !== '' && (run?.pid ?? 0) > 0 && run?.pid !== prePid) writeSidecar(childEnvironment.OPENFILM_HOME, fingerprint)
      finish(null, {
        url,
        origin: new URL(url).origin,
        key: run?.key ?? '',
        pid: run?.pid ?? 0,
        project: parseStudioProject(output) || lastStudioProject(childEnvironment.OPENFILM_HOME),
      })
    }
    // 实例对账(2026-10-23 用户裁决):spawn 前结束陈旧实例(旧构建/官方 app 启动的
    // 服务),本次 CLI 以当前资源冷启 —— 版本漂移不再依赖 has-shell 探测兜底。
    // 指纹之外再做服务实测:账本相符但页面不是自有编辑器,同样清场(毒化对账)。
    reconcileStudioInstance(studioHome, fingerprint, {
      verify: async () => {
        const run = readStudioRunAt(studioHome)
        return run ? serverServesOwnedEditor(run.origin, run.key, identity) : true
      },
    }).then(() => {
      const child = spawn(runtime.node, args, { env: childEnvironment, windowsHide: true })
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
  })
}
