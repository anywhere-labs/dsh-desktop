// TinTin bridge host (P0 skeleton). The full seam inventory lives in
// docs/tintin-port-execution-plan.zh.md WP-1: the IPC dispatcher, job
// registry, media range streaming and the FastAPI server proxy grow on
// these same webServer routes. The probe routes below are P0 verification
// (V5 local file write, V6 external process, V7 job channel) and stay minimal
// on purpose; WP-1 replaces them with the real seam handlers.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync, copyFileSync, rmSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { resolveMachineIdSync } from './lib/machine-id.js'
import { installSkillPackage } from './lib/skills-install.js'
import { findLegacyConfigDir, planImportedSettingsRecovery, planLegacyMigration, readImportedTintinSection } from './lib/legacy-config.js'
import { mergeConfigDocs, mergeTintinConfigStore, readTintinConfigStore, stripEmptyObjectLeaves } from './lib/tintin-config-store.js'
import {
  createServerUrlResolver,
  createHttpRequest,
  createOpenSseStream,
  isExpectedOfflineError,
  resolveEndpoint,
  API_ENDPOINTS,
} from './lib/server-proxy.js'
import { createFfmpegGateApi } from './lib/montage/ffmpeg-gate.js'
import { createMontageVoiceApi } from './lib/montage/voice-ipc.js'
import { preprocessTtsKeepingPause } from './lib/montage/voice-tts-logic.js'
import { createMontageFinalApi } from './lib/montage/final-ipc.js'
import { createRembgApi, createAudioArchiveApi, createVsrApi, createTtsUploadSampleApi } from './lib/media-proxy.js'
import { loopbackCall, readLoopbackConfig, summarizeExtract } from './lib/loopback-helpers.js'
import { createTintinAgentTools } from './lib/agent-tools.js'
import { createContextTaskApi, defaultWorkspaceDir } from './lib/context-task.js'
import { registerWorkspaceEnsureRoute } from './lib/workspace-ensure-route.js'
import { createYtdlpApi } from './lib/ytdlp.js'
import { loadPresetDefinitions } from './lib/preset-definitions.js'
import { createOpenfilmChannels, createOpenfilmSync } from './lib/openfilm/plugin.js'
import { createChannelTable } from './lib/channel-table.js'

const PING_PATH = '/tintin/ping'
const PROBE_FILE_PATH = '/tintin/probe/file'
const PROBE_SPAWN_PATH = '/tintin/probe/spawn'
const JOBS_PATH = '/tintin/jobs'
const JOB_STATUS_RE = /^\/tintin\/jobs\/([a-z0-9-]+)$/
const IPC_PATH = '/tintin/ipc'
const IPC_RE = /^\/tintin\/ipc\/(.+)$/

// TinTin server.* channel → endpoint. Each maps a client bridge call onto the
// FastAPI service; extend as WP-2 polyfill grows (对照 SRC preload server 域).
const IPC_SERVER_ROUTES = {
  'server:health': { method: 'GET', endpoint: API_ENDPOINTS.health.check },
  'server:llmModels': { method: 'GET', endpoint: API_ENDPOINTS.llm.models },
  'server:materialList': { method: 'POST', endpoint: API_ENDPOINTS.material.list },
  'server:materialSearch': { method: 'POST', endpoint: API_ENDPOINTS.material.search },
  // WP-2 generic passthrough: window.tintin.server.get/post/... forward an
  // arbitrary service path. Path is constrained to the TinTin API surface
  // (leading '/', no protocol/authority) so the bridge cannot be turned into
  // an open relay (B1).
  'server:get': { method: 'GET', generic: true },
  'server:post': { method: 'POST', generic: true },
  'server:put': { method: 'PUT', generic: true },
  'server:delete': { method: 'DELETE', generic: true },
}

// ── NATIVE_CHANNELS — 本地原生通道（montage 域，WP-3）──────────────────────
// <ns>:<method> 通道不走上面的 server:* 白名单：通道名直接映射到 lib/montage/
// 搬运模块的具名函数（ipcMain 壳已剥离，见各模块头注）。载荷 = client polyfill
// 的 {args:[...]}（位置参数，回调已剔除），返回值 sendJson 200 {result}。
// 每个条目形如 (args, ctx) => fn(...args, ctx)；ctx.emit 为进度事件注入点——
// P0 阶段同步阻塞返回最终结果，进度条先不做（jobId 化是后续项）。
// ffmpeg/ffprobe 经 resolveBinary 注入（TINTIN_BIN_DIR）；httpRequest 族经
// createHttpRequest 注入（依赖注入面同源 createMontageFinalIpc 工厂参数）。

// ── WP-1 media binaries ────────────────────────────────────────────────────
// Resolve the dir holding ffmpeg/ffprobe/yt-dlp: the shell hands it over as
// TINTIN_BIN_DIR (resources/bin); fall back to a local search when unset.
export function getBinDir() {
  const fromEnv = process.env.TINTIN_BIN_DIR
  if (fromEnv) return fromEnv
  return null
}

export function resolveBinary(bin) {
  const dir = getBinDir()
  const name = process.platform === 'win32' ? `${bin}.exe` : bin
  return dir ? join(dir, name) : name
}

// TinTin settings namespace schema (server.url 等本地配置), schemastery form
// (settings.register 需要 z schema——image-generation:14 先例). schemastery 无
// optional 修饰（实测 optional 为 undefined）；空对象 schema 全可选，读取处
// 自行判空（server?.url）。字段约束随 WP-5 设置卡细化。
// TinTin settings namespace schema (schemastery; no .optional() exists — nested
// default({}) keeps absent sections valid). Declaring server.url makes the
// harness settings UI render the field as the 服务器地址 card (WP-5a); the
// host reads it defensively either way. Seeded on first boot by the shell
// (tintin-first-boot.ts) so a fresh install is usable without manual RPC.
const TintinConfig = z.object({
  server: z.object({
    url: z.string().volatile(),
    // First-boot wizard marker: false until the user has confirmed a server
    // address through the setup overlay (probe → models → provider config).
    provisioned: z.boolean().default(false).volatile(),
  }).default({}),
  // 本地配置（2026-09-24 用户裁决：恢复原客户端「更改」能力——缓存目录可选）；
  // 空 = 使用默认（本机工作区目录 Documents/tintin-workspace）。
  local: z.object({
    cacheDir: z.string().default('').volatile(),
  }).default({}),
}).default({})

// 0.1.7 配置模型：dsh-settings-file 的 ctx.settings.register 已退役，插件以
// 导出的 Config schema 声明命名空间，loader 校验后作为 apply 第二参注入；
// 编辑经 SettingsForms 写入 profile patch 后由 loader 重启本 fiber 生效。
// 注意：字段必须标 volatile —— 否则 SettingsForms 拒绝一切写入
// （"Plugin entry has no volatile fields"），存量迁移与设置卡都会哑失败。
export const Config = TintinConfig

export const name = 'dsh-tintin-bundle'
// settings: TinTin config seam (server.url etc.). tools/webServer injected via
// scoped ctx.inject below so the tool half still loads where no web server runs.
export const inject = ['settings']

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function hasForwardedAddress(req) {
  return Boolean(
    req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-host']
  )
}

// Same-origin loopback requests only, mirroring dsh-desktop-market-installer's
// gate so the route stays unreachable from LAN pairing tunnels and proxies.
export function isTrustedRequest(req, mutation = false) {
  if (!isLoopback(req.socket.remoteAddress) || hasForwardedAddress(req)) return false
  if (!mutation) return true

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host === host && isLoopback(parsed.hostname)
  } catch {
    return false
  }
}

// mediaUnlocked — 用户显式选择的任意位置文件预览解锁登记表：media:unlock 写入、
// /tintin/media GET 放行（宿主进程单例，FIFO 上限）。必须挂在模块顶层——原先藏在
// webServer 路由块内、与 media:unlock 处理器不同作用域，登记恒 502
// 「mediaUnlocked is not defined」、对话框选中的白名单外文件恒 403
// （2026-10-08 宿主日志实锤，media:unlock 处理器注释「见上方注记」即此物）。
const mediaUnlocked = new Set()
const MEDIA_UNLOCK_CAP = 512
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

export async function apply(ctx, config) {
  // V7 job registry: in-memory for the P0 probe; WP-1 swaps in the durable
  // registry that drives the /tintin/jobs/<id> polling contract.
  const jobs = new Map()

  // V9: minimal tool so the agent can invoke it on its own, proving the
  // bundle -> defineTool -> agent orchestration seam (主方案 §3.5a 机制证明).
  const pingServerTool = defineTool({
    name: 'ping_server',
    description: 'Ping the TinTin bridge host and report liveness (pid and server time). Use to verify the TinTin host plugin is reachable.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true }, pid: { type: 'integer', required: true }, time: { type: 'integer', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', kind: 'execute', title: 'Ping TinTin host', rawInput: {} }),
    async execute() {
      return { ok: true, pid: process.pid, time: Date.now() }
    },
  })

  // WP-1: prove the TINTIN_BIN_DIR binary chain end to end — agent-invocable.
  const ffmpegProbeTool = defineTool({
    name: 'ffmpeg_probe',
    description: 'Report the resolved ffmpeg binary path and its version, proving the TinTin media binary chain (TINTIN_BIN_DIR) is wired. Use to verify ffmpeg availability before media work.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true }, bin: { type: 'string', required: true }, version: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', kind: 'execute', title: 'Probe ffmpeg', rawInput: {} }),
    async execute() {
      const bin = resolveBinary('ffmpeg')
      return await new Promise((resolve) => {
        const child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        child.stdout.on('data', (b) => { out += b.toString() })
        child.on('error', (e) => resolve({ ok: false, bin, version: undefined, error: e.message }))
        child.on('close', (code) => resolve({ ok: code === 0, bin, version: out.split('\n')[0]?.slice(0, 80) }))
      })
    },
  })

  // ── WP-1 foundation: config seam + server bridge ─────────────────────────
  // Config seam: TinTin's server.url lives in this plugin's Config namespace
  // (0.1.7: validated entry config arrives as apply's second argument — the
  // retired dsh-settings-file register() used to hand out a live handle here).
  // readConfig reads the committed value; the legacy ai_config.json path is
  // injected by the shell via TINTIN_AI_CONFIG (WP-1 shell hook), absent by default.

  // One-shot legacy config migration on boot (A2: config only). Reads the old
  // client's split-domain config and writes differing values into this
  // namespace. Idempotent — already-current values are skipped by the planner.
  ctx.effect(() => {
    const appData = process.env.APPDATA || null
    const legacyDir = findLegacyConfigDir(appData ?? undefined)
    if (!legacyDir) return undefined
    const ops = planLegacyMigration(legacyDir, config ?? {})
    if (ops.length === 0) return undefined
    const patch = {}
    for (const { path, value } of ops) {
      let node = patch
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]] ??= {}
      node[path[path.length - 1]] = value
    }
    ctx.logger.info('tintin-bundle: migrating legacy config (%d keys)', ops.length)
    // 0.1.7 起写入落 TinTin 自有存储（lib/tintin-config-store.js）：
    // SettingsForms/configEditor 拒写 overlay 插入的宿主插件条目
    // （"overridden by a home patch"），设置服务路径对本插件不可用。
    try {
      mergeTintinConfigStore(process.env.DSH_HOME, patch)
    } catch (e) {
      ctx.logger.warn('tintin-bundle: legacy migration failed: %s', e?.message ?? e)
    }
    return undefined
  }, 'tintin-bundle: legacy config migration')

  // 0.1.7 settings-yaml recovery: the upstream settings restructure renamed the
  // old store to <DSH_HOME>/settings.yaml.imported and carried only upstream
  // namespaces across — our section (server.url/provisioned, local.cacheDir)
  // was stranded, dropping the bridge onto the built-in default (was 127.0.0.1:8766; 2026-10-12 起=192.168.111.31:8000).
  // Fill still-empty leaves from the renamed store; idempotent, and it never
  // overwrites anything the user re-set after the upgrade.
  ctx.effect(() => {
    const dshHome = process.env.DSH_HOME
    if (!dshHome) return undefined
    const section = readImportedTintinSection(join(dshHome, 'settings.yaml.imported'))
    // 生效视图 = 自有存储 ∪ profile config（后者优先，与解析链同序）——
    // 用户在任一层的重设都视为已配置，恢复不覆盖。config 层先剥 schemastery
    // 占位符（空对象=未提交值），否则会覆盖 store 真实地址（实测向导预填
    // "[object Object]" 事故）。
    const effective = mergeConfigDocs(readTintinConfigStore(dshHome) ?? {}, stripEmptyObjectLeaves(config) ?? {})
    const ops = planImportedSettingsRecovery(section, effective)
    if (ops.length === 0) return undefined
    const patch = {}
    for (const { path, value } of ops) {
      let node = patch
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]] ??= {}
      node[path[path.length - 1]] = value
    }
    ctx.logger.info('tintin-bundle: recovering settings from settings.yaml.imported (%d keys)', ops.length)
    // 写入落 TinTin 自有存储（理由同上：设置服务拒写 overlay 条目）；
    // 桥接解析链下一请求即读到，无需等待 fiber 重启。
    try {
      mergeTintinConfigStore(process.env.DSH_HOME, patch)
    } catch (e) {
      ctx.logger.warn('tintin-bundle: settings recovery failed: %s', e?.message ?? e)
    }
    return undefined
  }, 'tintin-bundle: settings.yaml.imported recovery')

  // WP-5c（2026-09-28 改版）：角色预设在插件激活时直接注册进宿主 agentPresets
  // 注册表——不再复制 .agent-presets、不再转换进 Profile patch。旧的运行时状
  // 态副本会过期（existingIds 永不重转换）、会残损（一次重复键曾把客户端逼进
  // 安全模式）。注册失败单预设隔离：清单页可见，不阻断插件。存量 patch 行与
  // 源目录由壳侧 retirePluginRegisteredPresets 在同一次启动内先行清退。
  ctx.inject(['agentPresets'], (agentPresets) => {
    let definitions
    try {
      definitions = loadPresetDefinitions(fileURLToPath(new URL('./presets/', import.meta.url)))
    } catch (error) {
      ctx.logger.warn('tintin-bundle: role preset load failed: %s', error?.message ?? error)
      return undefined
    }
    for (const definition of definitions) {
      agentPresets.register(definition).catch((error) => {
        ctx.logger.warn('tintin-bundle: preset %s registration failed: %s', definition.id, error?.message ?? error)
      })
    }
    return undefined
  }, 'tintin-bundle: role preset registration')

  const aiConfigPath = process.env.TINTIN_AI_CONFIG || null
  const readAiConfig = aiConfigPath
    ? () => { try { return existsSync(aiConfigPath) ? JSON.parse(readFileSync(aiConfigPath, 'utf8')) : null } catch { return null } }
    : null
  const getServerUrl = createServerUrlResolver({
    // 类型守卫：schemastery 对 volatile 字段缺值时可能编译出空对象占位，
    // 真值判断会放行 "[object Object]" 进解析链（2026-09-28 实测 Invalid URL 根因）。
    readConfig: (key) => {
      if (key !== 'server.url') return undefined
      const v = config?.server?.url
      return typeof v === 'string' && v.length > 0 ? v : undefined
    },
    readTintinStore: () => readTintinConfigStore(process.env.DSH_HOME),
    readAiConfig,
  })

  // ── OpenFilm 服务端驱动接缝（2026-10-18 用户裁决：A 方案 + 侧栏独立窗口）──
  // 同步随包技能与 `tintin` 自定义服务（实现见 lib/openfilm/plugin.js）；失败只
  // 告警：OpenFilm 是附加能力，不得阻断会话与桥。
  const syncOpenfilmAssets = createOpenfilmSync({ getServerUrl, logger: ctx.logger })
  try { syncOpenfilmAssets() } catch (error) { ctx.logger.warn('tintin-bundle: openfilm sync skipped: %s', error?.message ?? error) }
  const getMachineId = () => resolveMachineIdSync()
  const httpRequest = createHttpRequest({
    getServerUrl,
    getMachineId,
    log: (...a) => ctx.logger.info(...a),
    warn: (...a) => ctx.logger.warn(...a),
  })
  const openSseStream = createOpenSseStream({
    getServerUrl,
    getMachineId,
    log: (...a) => ctx.logger.info(...a),
    warn: (...a) => ctx.logger.warn(...a),
  })

  // NATIVE_CHANNELS（montage 域本地原生通道）：ffmpeg 族二进制经 resolveBinary
  // 注入（TINTIN_BIN_DIR；voice/final 模块内 getBinDir 同源读取该 env），
  // 服务端依赖经 createHttpRequest/isExpectedOfflineError/getServerUrl 注入——
  // 注入面与源 createMontageVoiceIpc/createMontageFinalIpc 工厂参数一致。
  // jyaudio:*（剪映音频自动同步定时任务）随 final 工厂一并注册。
  const montageDeps = { httpRequest, isExpectedOfflineError, getServerUrl }
  // 视频扩展名 → multipart Content-Type（分割上传用）
  const VIDEO_MIME = {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  }

  // multipart POST 到服务端（SRC buildMultipartBody 口径）：part 为标量
  // {name,value}、本地文件 {name,path} 或内存字节 {name,buffer,filename}。
  // 渲染层无法读取 {path} 指向的本地音频（浏览器无该文件句柄），所以样本
  // 上传/转写和原版一样由宿主（=主进程）读盘组装——2026-09-24 用户报障
  // Step2「无样本可选」的补链通道即走这里。
  async function multipartPost(endpoint, parts, timeout = 120000) {
    const boundary = '----TintinForm' + Math.random().toString(16).slice(2)
    const chunks = []
    for (const part of parts) {
      if (part.path !== undefined) {
        const buf = readFileSync(part.path)
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${basename(part.path).replace(/"/g, '')}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`))
        chunks.push(buf, Buffer.from('\r\n'))
      } else if (part.buffer !== undefined) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${String(part.filename ?? part.name).replace(/"/g, '')}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`))
        chunks.push(part.buffer, Buffer.from('\r\n'))
      } else {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`))
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    const res = await httpRequest('POST', endpoint, {
      body: Buffer.concat(chunks),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      timeout,
    })
    return res.data
  }
  // 音频扩展名 → multipart Content-Type（服务端转写/样本接口按扩展与类型识别）。
  const audioMimeOf = (file) => ({
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  }[String(extname(file)).toLowerCase()] ?? 'application/octet-stream')

  // 缓存目录解析（env:cacheDir 与 ytdlp 门共用）：设置 local.cacheDir（通用设置
  // 卡「更改」写入）> 默认本机工作区目录 Documents/tintin-workspace。
  const resolveCacheDir = () => {
    // 2026-09-29 [object Object] 终局修复：schemastery volatile 占位符会把
    // local.cacheDir 物化成空对象（3.9c 同族锚点，String 化即 [object Object]，
    // 空对象为真值还会压过工作区回退）——只接受字符串值，其余一律视为未配置
    const raw = config?.local?.cacheDir
    const configured = typeof raw === 'string' ? raw.trim() : ''
    return configured
      || process.env.TINTIN_WORKSPACE_DIR
      || join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'tintin-workspace')
  }

  // yt-dlp 二进制链（SRC resolveYtDlpPath 收敛为 TINTIN_BIN_DIR 链）：打包
  // resources/bin（TINTIN_BIN_DIR）> 系统 PATH。yt-dlp 不随包分发时 available=false，
  // 卡片呈现「未部署」态。
  const ytdlpBin = (() => {
    const dir = getBinDir()
    const candidate = dir ? join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp') : null
    return candidate && existsSync(candidate) ? candidate : 'yt-dlp'
  })()

  const nativeChannels = createChannelTable({
    ctx, config, httpRequest, getServerUrl, getMachineId, getBinDir, resolveBinary,
    resolveCacheDir, ytdlpBin, multipartPost, audioMimeOf, isExpectedOfflineError,
    montageDeps, syncOpenfilmAssets, mediaUnlocked, MEDIA_UNLOCK_CAP, VIDEO_MIME,
  })

  // tintinBridge: the host service the media/ops plugins inject (WP-1 契约).
  // Surface: server proxy, machine id, config, jobs registry, media stream,
  // native montage channels (WP-3).
  const tintinBridge = {
    getServerUrl,
    getMachineId,
    httpRequest,
    jobs,
    // dispatch a native <ns>:<method> bridge call to the ported montage module
    // handlers. args is the polyfill's positional {args:[...]} array; ctx.emit
    // is the progress-event sink (undefined in P0 — sync blocking return).
    async callNative(channel, args) {
      const entry = nativeChannels[channel]
      if (!entry) {
        const err = new Error(`Unknown TinTin native channel: ${channel}`)
        err.code = 'unknown-channel'
        throw err
      }
      return await entry(Array.isArray(args) ? args : [], { emit: undefined })
    },
    // dispatch a server.* bridge call to the FastAPI service.
    async callServer(channel, payload) {
      const route = IPC_SERVER_ROUTES[channel]
      if (!route) {
        const err = new Error(`Unknown TinTin bridge channel: ${channel}`)
        err.code = 'unknown-channel'
        throw err
      }
      // Generic passthrough: the client supplies the path. Constrain it to the
      // TinTin API surface so the bridge cannot become an open relay (B1).
      if (route.generic) {
        const p = payload?.path
        if (typeof p !== 'string' || !p.startsWith('/') || /^\/\//.test(p) || /^[a-z]+:/i.test(p)) {
          const err = new Error(`Invalid bridge path: ${String(p)}`)
          err.code = 'invalid-path'
          throw err
        }
        const params = payload?.params
        const qs = params && typeof params === 'object'
          ? (() => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) { if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x))); else if (v != null) q.set(k, String(v)) } const s = q.toString(); return s ? (p.includes('?') ? '&' : '?') + s : '' })()
          : ''
        const result = await httpRequest(route.method, p + qs, { body: route.method === 'GET' || route.method === 'DELETE' ? undefined : payload?.body, headers: payload?.headers, timeout: payload?.timeout })
        return result.data
      }
      const path = resolveEndpoint(route.endpoint, payload?.params ?? payload)
      const result = await httpRequest(route.method, path, { body: route.method === 'GET' ? undefined : payload?.body ?? payload })
      return result.data
    },
  }
  ctx.provide('tintinBridge', tintinBridge)

  // 工具注册独立段（铁律 7 不扩大，2026-09-27 事故修复）：单个工具 schema
  // 编译失败只跳过自身并 error 打点，绝不拖垮 web 路由注册——曾因 browser_open
  // 误用原生 JSON-schema 形态（parameters.type='object'）把整个插件 effect
  // 炸断，/tintin/ipc 等全部路由未注册，渲染层桥请求全线 405/404。
  ctx.inject(['tools'], (toolsCtx) => {
    const registerTool = (def) => {
      try {
        toolsCtx.tools.register(defineTool(def))
      } catch (error) {
        ctx.logger.error('tintin-bundle: tool %s skipped: %s', def?.name, error?.message ?? error)
      }
    }
    registerTool(pingServerTool)
    registerTool(ffmpegProbeTool)

    // ── 浏览器域 agent 工具（架构文档 §浏览器域三层形态第2/3层）：
    // 经壳层回环服务（loopback.json 握手，token 鉴权）驱动独立浏览器引擎。
    // 输出摘要化（架构 §4.5 成本护栏）：只回 agent 决策所需字段。
    // parameters 用 dsh-tools 平铺形态（每参数名 → schema），禁用原生
    // JSON-schema 形态——parameters.type 是框架保留槽。
    registerTool({
      name: 'browser_open',
      description: '打开 TinTin 内置浏览器独立窗口并导航到平台首页（douyin/bilibili/kuaishou/xiaohongshu/weixin/youtube/jimeng/fxg/web）。各平台登录态独立隔离。用例：需要用户登录平台或打开平台页面前置。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 id：douyin/bilibili/kuaishou/xiaohongshu/weixin/youtube/jimeng/fxg/web' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean', required: true }, error: { type: 'string' },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => false,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '打开内置浏览器', rawInput: {} }),
      async execute(args) {
        return loopbackCall('/tintin-browser/open', { platform: args.platform })
      },
    })

    registerTool({
      name: 'page_extract',
      description: '在 TinTin 内置浏览器中运行平台抽取脚本，抽取当前页面的结构化内容（标题/作者/正文/媒体链接等，视平台而定）。前置：先用 browser_open 打开对应平台。抽取失败会返回结构化原因（NEED_LOGIN=需先登录 / RISK_CAPTCHA=触发验证码 / DOM_MISMATCH=页面结构变化）。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 id（douyin/bilibili/kuaishou/xiaohongshu/weixin）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean', required: true }, summary: { type: 'string' }, error: { type: 'string' },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => false,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '抽取平台页面内容', rawInput: {} }),
      async execute(args) {
        const res = await loopbackCall('/tintin-browser/extract', { platform: args.platform })
        return summarizeExtract(res)
      },
    })

    registerTool({
      name: 'browser_login_status',
      description: '查询 TinTin 内置浏览器各平台的登录状态（cookie 条数）。用例：下载/抽取前判断平台是否已登录；count>0 视为有登录痕迹。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean', required: true }, counts: { type: 'string' }, error: { type: 'string' },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '查询平台登录状态', rawInput: {} }),
      async execute() {
        const res = await loopbackCall('/tintin-browser/login/status', {})
        if (res && res.ok === false) return res
        const counts = res && res.counts ? res.counts : {}
        const summary = Object.entries(counts).map(([k, v]) => k + ':' + v).join(' ') || '（无）'
        return { ok: true, counts: summary }
      },
    })

    registerTool({
      name: 'hotspot_capture',
      description: '采集今日各平台热榜（抖音/小红书/B站，隐藏窗口采集，约 15-25 秒）。清单落盘 userData/hotspots/hotspots_sync.json 并返回本次采集条数。用例：选题/热点文案创作前获取实时热榜。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean', required: true }, count: { type: 'number' }, message: { type: 'string' },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => false,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '采集今日热点', rawInput: {} }),
      async execute() {
        const res = await loopbackCall('/tintin-browser/hotspot/capture', {})
        if (Array.isArray(res)) {
          const [ok, data] = res
          return { ok: !!ok, count: typeof data === 'number' ? data : 0, message: typeof data === 'string' ? data : '' }
        }
        return { ok: false, count: 0, message: '回环服务未返回结果' }
      },
    })
    // WP-5 agent 工具组（2026-09-25 用户裁决：拆解路由服务端 + 合理使用服务端
    // 能力 + 聚焦业务；dsh 底层零改动，defineTool 为上游插件 API）。montage
    // 工具经 callNative 复用 NATIVE_CHANNELS 已移植通道；识图/规划走 /llm 与
    // /workflow/plan 服务端契约（2026-09-25 实测在）。
    for (const def of createTintinAgentTools({
      httpRequest,
      callNative: (channel, args) => nativeChannels[channel]?.(args),
      readFile: async (p) => readFileSync(p),
      log: (...a) => ctx.logger.info('tintin-bundle:', ...a),
      warn: (...a) => ctx.logger.warn('tintin-bundle:', ...a),
    })) {
      registerTool(def)
    }
  })

  ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {
    const disposePing = webCtx.webServer.register({
      kind: 'exact',
      path: PING_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' || !isTrustedRequest(req)) {
          sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        sendJson(res, 200, { ok: true, plugin: name, pid: process.pid, time: Date.now() })
      },
    })

    // V5: write a temp file from the host process to prove local fs access.
    const disposeFile = webCtx.webServer.register({
      kind: 'exact',
      path: PROBE_FILE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        try {
          const dir = join(tmpdir(), 'tintin-p0')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `probe-${Date.now()}.txt`)
          writeFileSync(file, `tintin host probe ${new Date().toISOString()}`, 'utf8')
          sendJson(res, 200, { ok: true, file, bytes: statSync(file).size })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    // V6: spawn an external binary. Default probe target is node --version so
    // the route is verifiable before ffmpeg lands in resources (WP-1); the
    // same code path carries ffmpeg later.
    const disposeSpawn = webCtx.webServer.register({
      kind: 'exact',
      path: PROBE_SPAWN_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const target = process.env.TINTIN_PROBE_BINARY ?? process.execPath
        const args = target === process.execPath ? ['--version'] : ['-version']
        const child = spawn(target, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (b) => { stdout += b.toString() })
        child.stderr.on('data', (b) => { stderr += b.toString() })
        child.on('error', (error) => sendJson(res, 500, { ok: false, target, error: error.message }))
        child.on('close', (code) => {
          sendJson(res, 200, { ok: code === 0, code, target, stdout: stdout.slice(0, 300), stderr: stderr.slice(0, 300) })
        })
      },
    })

    // V7: job channel — POST starts a job (202 + jobId), GET status polls it.
    const disposeJobs = webCtx.webServer.register({
      kind: 'exact',
      path: JOBS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const job = { id, state: 'running', createdAt: Date.now(), doneAt: null }
        jobs.set(id, job)
        // Probe job completes asynchronously after a beat so polling flips state.
        setTimeout(() => {
          job.state = 'done'
          job.doneAt = Date.now()
        }, 800).unref?.()
        ctx.logger.info('tintin-bundle: job started %s', id)
        sendJson(res, 202, { jobId: id, state: 'running' })
      },
    })

    const disposeJobStatus = webCtx.webServer.register({
      // prefix kind matches pathname.startsWith(`${prefix}/`), so the prefix
      // must not carry a trailing slash.
      kind: 'prefix',
      path: '/tintin/jobs',
      handler: async (req, res) => {
        const match = JOB_STATUS_RE.exec(new URL(req.url, 'http://localhost').pathname)
        if (req.method !== 'GET' || !isTrustedRequest(req) || !match) {
          sendJson(res, !match ? 404 : req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const job = jobs.get(match[1])
        if (!job) {
          sendJson(res, 404, { error: 'Unknown job.' })
          return
        }
        sendJson(res, 200, { jobId: job.id, state: job.state, elapsedMs: Date.now() - job.createdAt })
      },
    })

    // WP-1: /tintin/ipc/<channel> dispatch — the host endpoint the WP-2
    // window.tintin polyfill calls. Native montage channels (<ns>:<method>,
    // NATIVE_CHANNELS) run the ported local handlers first; server:* channels
    // forward to the FastAPI service through the bridge; failure keeps
    // status + message (铁律 7).
    // ── /tintin/media — 本地媒体流式供给（WP-1 media streaming）────────────
    // 移植版页面经 http 提供，<audio>/<video src="file:///..."> 被 Chromium
    // 禁止（原客户端页面走 file:// 不受限）——本地媒体（克隆配音/分割预览/
    // 音效等）统一经本路由流式回源。受信 GET（仅回环）；path 限定在缓存目录/
    // 默认工作区内，防任意文件读取；支持 Range（音频拖动进度条必需）。
    const MEDIA_PATH = '/tintin/media'
    // media:unlock — 用户显式选择的任意位置文件预览解锁。白名单根只覆盖缓存/
    // 工作区目录，而用户自选目录（桌面等）的文件——如图像抠图的原图与落盘在
    // 原图旁的 `_matting.png` 结果——预览会被 403。渲染层在文件选中/结果产生
    // 处经受信 POST 登记单个文件（绝对路径 + 存在性 + isFile 校验，FIFO 上限
    // 512 防无限增长），/tintin/media GET 对已登记路径放行。信任面评估（B1）：
    // 读范围 = 用户刚刚亲手选过/业务刚落盘的文件，登记只能由受信渲染层发起，
    // 不构成任意路径读取（白名单根仍然是主通道）。
    // mediaUnlocked/MEDIA_UNLOCK_CAP=模块顶层声明（见 sendJson 上方）——本块
    // 只持有 MEDIA_CT；曾把 Set 藏在本块导致 media:unlock 处理器看不到它。
    const MEDIA_CT = {
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
      '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    }
    const disposeMedia = webCtx.webServer.register({
      kind: 'prefix',
      path: MEDIA_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' || !isTrustedRequest(req)) {
          sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== MEDIA_PATH) { sendJson(res, 404, { error: 'Not found.' }); return }
        const requested = String(url.searchParams.get('path') || '')
        const resolved = normalize(requested)
        // 白名单 = 生效缓存目录 + 默认工作区 + 过渡期旧缓存目录
        const home = process.env.DSH_HOME || ''
        const configured = String(config?.local?.cacheDir || '').trim()
        const roots = [
          configured,
          process.env.TINTIN_WORKSPACE_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'tintin-workspace'),
          home ? join(home, 'tintin', 'cache') : '',
        ].filter(Boolean).map((r) => normalize(r).toLowerCase())
        const low = resolved.toLowerCase()
        const allowed = roots.some((r) => low === r || low.startsWith(r.endsWith(sep) ? r : r + sep))
          || mediaUnlocked.has(resolved)
        if (!allowed) { sendJson(res, 403, { error: 'Path outside allowed media roots.' }); return }
        let st
        try { st = statSync(resolved) } catch { sendJson(res, 404, { error: 'Not found.' }); return }
        if (!st.isFile()) { sendJson(res, 404, { error: 'Not a file.' }); return }
        const ct = MEDIA_CT[extname(resolved).toLowerCase()] || 'application/octet-stream'
        const range = String(req.headers.range || '')
        const baseHeaders = {
          'content-type': ct,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        }
        if (/^bytes=\d*-\d*$/.test(range)) {
          const [startStr, endStr] = range.slice(6).split('-')
          let start = Number(startStr) || 0
          let end = endStr ? Number(endStr) : st.size - 1
          if (start > end || start >= st.size) {
            res.writeHead(416, { 'content-range': `bytes */${st.size}` })
            res.end()
            return
          }
          end = Math.min(end, st.size - 1)
          res.writeHead(206, {
            ...baseHeaders,
            'content-range': `bytes ${start}-${end}/${st.size}`,
            'content-length': end - start + 1,
          })
          createReadStream(resolved, { start, end }).pipe(res)
          return
        }
        res.writeHead(200, { ...baseHeaders, 'content-length': st.size })
        createReadStream(resolved).pipe(res)
      },
    })

    const disposeIpc = webCtx.webServer.register({
      kind: 'prefix',
      path: IPC_PATH,
      handler: async (req, res) => {
        const match = IPC_RE.exec(new URL(req.url, 'http://localhost').pathname)
        if (req.method !== 'POST' || !isTrustedRequest(req, true) || !match) {
          sendJson(res, !match ? 404 : req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const channel = match[1]
        let payload
        try {
          const chunks = []
          for await (const c of req) chunks.push(c)
          payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body.' })
          return
        }
        // 全量桥请求追踪（2026-09-27 用户裁决：所有桥请求含成功都可追溯）。
        // ctx.logger.info 在 harness 日志传输规则里不落盘，trace 走子进程
        // stdout（harness.log 的 [stdout] 行全量捕获）——这是唯一保证承载的
        // 通道。每个请求一行：通道 + 目标 + 结果 + 耗时；失败另有 ✗ warn 详
        // 述错误体，两行互补。
        const started = Date.now()
        const hint = typeof payload?.path === 'string' ? ` ${payload.path}` : ''
        const trace = (outcome) => {
          try { console.log(`[bridge] ${channel}${hint} -> ${outcome} ${Date.now() - started}ms`) } catch { /* 追踪不得影响分发 */ }
        }
        try {
          // Native channel first: the polyfill forwards unknown window.tintin
          // members as {args:[...]} positional payloads. P0 progress note:
          // long-running channels (final:mix / voice:cloneBatch / dubVideos)
          // block until the final result — jobId-based progress is follow-up.
          if (nativeChannels[channel]) {
            const result = await tintinBridge.callNative(channel, payload?.args)
            trace('ok')
            sendJson(res, 200, { result })
            return
          }
          const result = await tintinBridge.callServer(channel, payload)
          trace('ok')
          sendJson(res, 200, { result })
        } catch (error) {
          const code = error?.code === 'unknown-channel' ? 404 : (error?.status ?? 502)
          trace(`failed ${code}`)
          ctx.logger.warn('tintin-bundle: ipc %s failed: %s', channel, error?.message ?? error)
          sendJson(res, code, { error: error?.message ?? String(error) })
        }
      },
    })

    // WP-2 upload passthrough: the browser sends multipart/form-data (native
    // FormData); we buffer the body and forward it verbatim with its
    // content-type (boundary included) to the FastAPI service via the bridge.
    // Progress stays client-side (XHR upload.onprogress); server-side task
    // progress uses the job channel.
    const disposeUpload = webCtx.webServer.register({
      kind: 'exact',
      path: '/tintin/upload',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const targetPath = url.searchParams.get('path')
        if (req.method !== 'POST' || !isTrustedRequest(req, true) || typeof targetPath !== 'string'
          || !targetPath.startsWith('/') || /^\/\//.test(targetPath) || /^[a-z]+:/i.test(targetPath)) {
          sendJson(res, 400, { error: 'Request rejected.' })
          return
        }
        // 上游方法白名单（默认 POST；frames 端点=PUT multipart——405 修复 2026-10-06）
        const upstreamMethod = url.searchParams.get('method') === 'PUT' ? 'PUT' : 'POST'
        const chunks = []
        for await (const c of req) chunks.push(c)
        const body = Buffer.concat(chunks)
        try {
          const result = await httpRequest(upstreamMethod, targetPath, {
            body,
            headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {},
          })
          sendJson(res, 200, { result: result.data })
        } catch (error) {
          ctx.logger.warn('tintin-bundle: upload %s failed: %s', targetPath, error?.message ?? error)
          sendJson(res, error?.status ?? 502, { error: error?.message ?? String(error) })
        }
      },
    })

    // WP-2 sse passthrough: the polyfill's server.sse(path, onEvent, onError)
    // fetches this route and parses the event stream renderer-side. The host
    // only relays: GET → upstream GET (Accept: text/event-stream +
    // X-Machine-ID) → pipe the body verbatim. SRC shipped this as ipcMain
    // 'server:sse' with main-process parsing + event channels; the web route
    // topology replaces that plumbing (offline arrives as HTTP 502 instead of
    // the 'OFFLINE' sentinel). Path validation mirrors /tintin/upload.
    const disposeSse = webCtx.webServer.register({
      kind: 'exact',
      path: '/tintin/sse',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const targetPath = url.searchParams.get('path')
        if (req.method !== 'GET' || !isTrustedRequest(req) || typeof targetPath !== 'string'
          || !targetPath.startsWith('/') || /^\/\//.test(targetPath) || /^[a-z]+:/i.test(targetPath)) {
          sendJson(res, 400, { error: 'Request rejected.' })
          return
        }
        let upstream
        try {
          upstream = await openSseStream(targetPath)
        } catch (error) {
          ctx.logger.warn('tintin-bundle: sse %s failed: %s', targetPath, error?.message ?? error)
          sendJson(res, error?.status ?? 502, { error: error?.message ?? String(error) })
          return
        }
        res.writeHead(upstream.statusCode, {
          'content-type': upstream.headers['content-type'] || 'text/event-stream',
          'cache-control': 'no-cache',
        })
        // Browser unsubscribe (fetch abort) closes res → tear down upstream.
        res.on('close', () => {
          try { upstream.destroy() } catch { /* already gone */ }
        })
        upstream.pipe(res)
      },
    })

    // Workspace directory ensure for client-side first-boot provisioning.
    const disposeWorkspaceEnsure = registerWorkspaceEnsureRoute({ webServer: webCtx.webServer, isTrustedRequest, sendJson, mkdirSync, defaultWorkspaceDir })

    // First-boot setup wizard probe: the browser cannot reach an arbitrary LAN
    // address directly (cross-origin), so the host probes the candidate server
    // (health + model list) on its behalf and returns what the provider config
    // should contain.
    const disposeSetupProbe = webCtx.webServer.register({
      kind: 'exact',
      path: '/tintin/setup/probe',
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isTrustedRequest(req, true)) {
          sendJson(res, req.method === 'POST' ? 403 : 405, { error: 'Request rejected.' })
          return
        }
        const chunks = []
        for await (const c of req) chunks.push(c)
        let base
        try { base = JSON.parse(Buffer.concat(chunks).toString('utf8')).url } catch { base = null }
        base = typeof base === 'string' ? base.replace(/\/+$/u, '') : ''
        if (!/^https?:\/\/[^\s/]+/i.test(base)) {
          sendJson(res, 400, { error: '地址需形如 http://<主机>:<端口>' })
          return
        }
        try {
          const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) })
          if (!health.ok) throw new Error(`/health 返回 ${String(health.status)}`)
          const modelsRes = await fetch(`${base}/llm/models`, { signal: AbortSignal.timeout(8000) })
          if (!modelsRes.ok) throw new Error(`/llm/models 返回 ${String(modelsRes.status)}`)
          const data = await modelsRes.json()
          const models = Array.isArray(data?.models) && data.models.length
            ? data.models.map((m) => ({ id: String(m?.id ?? ''), name: String(m?.name ?? m?.id ?? ''), isDefault: m?.default === true }))
            : []
          if (!models.length) throw new Error('服务端未返回模型列表')
          const preferred = models.find((m) => m.isDefault) ?? models[0]
          sendJson(res, 200, { result: { ok: true, base, models, preferred } })
        } catch (error) {
          ctx.logger.warn('tintin-bundle: setup probe %s failed: %s', base, error?.message ?? error)
          sendJson(res, 502, { error: `无法连接 ${base}：${error instanceof Error ? error.message : String(error)}` })
        }
      },
    })

    return async () => {
      disposePing()
      disposeFile()
      disposeSpawn()
      disposeJobs()
      disposeJobStatus()
      disposeIpc()
      disposeUpload()
      disposeMedia()
      disposeSse()
      disposeWorkspaceEnsure()
      disposeSetupProbe()
    }
  }, 'tintin-bundle: probe routes'))
  ctx.logger.info('tintin-bundle host ready')
}
