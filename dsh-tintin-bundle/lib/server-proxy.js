// server-proxy — pure-logic HTTP bridge to the TinTin FastAPI inference
// service, ported from SRC desktop/main/server-proxy.js (2026-09-23, WP-1).
// Only the Electron-free core moves here: server URL resolution, /output URL
// rewrite, endpoint constants and the http/https forwarder with X-Machine-ID.
// The ipcMain shell is NOT ported — callers reach this through the host
// webServer routes (tintin-bundle/index.js), which replace IPC.
//
// No server is started and no port is listened on here; this only forwards to
// an externally deployed service.
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

/**
 * Server URL resolution chain (SRC getServerUrl, L72-93):
 *   1. config `server.url` (live, set from the settings card)
 *   2. TinTin-owned store <DSH_HOME>/tintin/config.json (0.1.7: the settings
 *      service refuses writes for overlay-inserted host plugins, so TinTin's
 *      own config persists here — wizard/card/migrations all write this file)
 *   3. ai_config.json `server_url` / `server.url` (legacy desktop fallback)
 *   4. built-in default http://192.168.111.31:8000 (定制版：内置部署服务器，与
 *      dsh-plugin-desktop-tintin/src/tintin/first-boot.ts 的播种默认同值，改动须两边同步)
 * `readConfig` is injected by the host (WP-1 config seam); `readTintinStore`
 * and `readAiConfig` are file readers, absent by default.
 */
export function createServerUrlResolver({ readConfig, readTintinStore, readAiConfig } = {}) {
  return function getServerUrl() {
    if (typeof readConfig === 'function') {
      try {
        const u = readConfig('server.url')
        // 非字符串档值（如 schemastery 对 volatile 字段的空对象占位）一律跳过，
        // 否则 String(value) 会把 "[object Object]" 送进 URL 解析（实测事故）。
        if (typeof u === 'string' && u) return u.replace(/\/$/, '')
      } catch { /* fall through */ }
    }
    if (typeof readTintinStore === 'function') {
      try {
        const store = readTintinStore()
        const u = store && store.server && store.server.url
        if (typeof u === 'string' && u) return u.replace(/\/$/, '')
      } catch { /* fall through */ }
    }
    if (typeof readAiConfig === 'function') {
      try {
        const cfg = readAiConfig()
        if (cfg && cfg.server_url) return String(cfg.server_url).replace(/\/$/, '')
        if (cfg && cfg.server && cfg.server.url) return String(cfg.server.url).replace(/\/$/, '')
      } catch { /* fall through */ }
    }
    // 定制版默认=部署服务器（2026-10-12 用户裁决：新装零配置即连；与 first-boot
    // 播种默认同值。用户/设置卡配置的值在解析链 1-3 恒优先）
    return 'http://192.168.111.31:8000'
  }
}

/**
 * /output media URL rewrite (SRC fixOutputUrl, L99-106): responses from
 * generation endpoints may carry a hard-coded old server address; the file
 * actually lives on the current server, so the client rebuilds the /output/
 * path against the current server_url. Idempotent once the server is fixed.
 */
export function createFixOutputUrl(getServerUrl) {
  return function fixOutputUrl(u) {
    const s = String(u || '')
    if (!s) return s
    const base = getServerUrl().replace(/\/$/, '')
    const idx = s.indexOf('/output/')
    if (base && idx !== -1 && !s.startsWith(base)) return base + s.slice(idx)
    return s
  }
}

/** Apply the /output rewrite to url/audio_url/file_url fields (SRC fixGenUrls). */
export function makeFixGenUrls(fixOutputUrl) {
  return function fixGenUrls(data) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const k of ['url', 'audio_url', 'file_url']) {
        if (data[k]) data[k] = fixOutputUrl(data[k])
      }
    }
    return data
  }
}

/**
 * Endpoint constants (SRC API_ENDPOINTS, L122-175). Kept in sync with
 * SRC types/server-api.ts API_PATHS — change both together, never hardcode a
 * path string in the dispatch layer (铁律 6).
 */
export const API_ENDPOINTS = {
  // capabilities：服务端从未实现（声明即 404 陷阱），2026-09-25 移除；
  // 首启探测实际依赖 check + llm.models
  health: { check: '/health/check' },
  stats: { workbench: '/stats/workbench' },
  llm: { chatCompletions: '/llm/chat/completions', adjustCopywriting: '/script/adjust-copywriting', list: '/script/list', models: '/llm/models' },
  copywriting: { voiceover: '/copywriting/voiceover' },
  asr: { transcribe: '/whisper/transcribe' },
  tts: { indextts: '/indextts/tts', voicesList: '/voice/samples', voicesSamples: '/voice/samples', qwen3Voices: '/indextts/qwen3/voices' },
  workflow: { run: '/workflow/run' },
  material: {
    list: '/material/list', search: '/material/search', serve: '/material/serve',
    ocr: '/material/ocr', stockSearch: '/material/stock_search', scoreClip: '/material/score-clip',
    webDownload: '/material/web_download', webDownloadStatus: (id) => `/material/web_download/${id}`,
    enqueueAnalysis: '/material/enqueue_analysis', scan: '/material/scan'
  },
  montage: { split: '/montage/split', concat: '/montage/concat', bgm: '/montage/bgm', auto: '/montage/auto' },
  audio: { genBgm: '/audio/gen/bgm', genSfx: '/audio/gen/sfx', bgmUpload: '/audio/bgm/upload', libraryUpload: '/audio/library/upload', sfxAnalyze: '/sfx/analyze' },
  prompt: { video: '/prompt/video' },
  vsr: { enhance: '/vsr/enhance', remove: '/vsr/remove' },
  rembg: { matting: '/matting', models: '/matting/models' },
  vision: { reversePrompt: '/vision/reverse-prompt' },
  digitalHuman: { generate: '/digital-human/generate', listModels: '/digital-human/models' },
  storyboard: { scripts: '/api/storyboard/scripts', scriptItem: (id) => `/api/storyboard/scripts/${id}` },
  // /agent/* 编排已于 2026-09-25 服务端退役（chat/tasks/sessions/artifacts 全部
  // 下线，调用一律 404）；仅能力目录 registry 保留（MCP 与仪表盘仍在消费，
  // 后续 P2 defineTool 工具化的数据源）。与 SRC 的 API_PATHS 同步在此处有意分叉。
  agent: {
    registry: '/agent/registry',
  },
  tasks: {
    list: '/tasks', unifiedList: '/tasks/unified', unifiedItem: (id) => `/tasks/unified/${id}`,
    item: (id) => `/tasks/${id}`, itemResult: (id) => `/tasks/${id}/result`,
  },
  scheduled: { tasks: '/scheduled/tasks', taskItem: (id) => `/scheduled/tasks/${id}` },
  skills: { list: '/skills', item: (id) => `/skills/${encodeURIComponent(id)}` },
  editor: { renderPackage: (id) => `/editor/render/${id}/package` },
  system: { license: '/system/license', licenseMachineId: '/system/license/machine-id', guide: '/guide' },
}

/** Resolve an endpoint (string | (id)=>string) and append a query string. */
export function resolveEndpoint(endpoint, params) {
  const path = typeof endpoint === 'function' ? endpoint(...(params?.__args || [])) : endpoint
  if (!params) return path
  const qsKeys = Object.keys(params).filter((k) => k !== '__args')
  if (!qsKeys.length) return path
  const qs = new URLSearchParams()
  qsKeys.forEach((k) => {
    const v = params[k]
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)))
    else if (v !== undefined && v !== null) qs.set(k, String(v))
  })
  const qsStr = qs.toString()
  return qsStr ? path + (path.includes('?') ? '&' : '?') + qsStr : path
}

/**
 * Forward one request to the TinTin service (SRC httpRequest, L196-284).
 * Injects X-Machine-ID via the injected getMachineId; `log`/`warn` are the
 * host logger. Timeout rejects on idle sockets (does not rely on 'error',
 * which may never fire after destroy) — repeated settle is harmless.
 */
export function createHttpRequest({ getServerUrl, getMachineId, log = () => {}, warn = () => {} } = {}) {
  return function httpRequest(method, fullPath, { body, headers = {}, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const baseUrl = getServerUrl()
      const url = new URL(fullPath.startsWith('http') ? fullPath : baseUrl + fullPath)
      try { log('http', `→ ${method} ${fullPath}`) } catch { /* ignore */ }

      const isHttps = url.protocol === 'https:'
      const lib = isHttps ? https : http

      const defaultHeaders = {
        'X-Machine-ID': getMachineId(),
        'User-Agent': 'TintinElectron/3.0'
      }

      let bodyData = null
      if (body !== undefined && body !== null) {
        if (Buffer.isBuffer(body) || typeof body === 'string') {
          bodyData = body
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream'
        } else {
          bodyData = JSON.stringify(body)
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
        }
        defaultHeaders['Content-Length'] = Buffer.byteLength(bodyData)
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: { ...defaultHeaders, ...headers },
        timeout
      }

      const req = lib.request(options, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const contentType = res.headers['content-type'] || ''
          let parsed = buf
          if (contentType.includes('application/json')) {
            try { parsed = JSON.parse(buf.toString('utf-8')) } catch { parsed = buf.toString('utf-8') }
          } else if (contentType.startsWith('text/')) {
            parsed = buf.toString('utf-8')
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { log('http', `← ${method} ${fullPath} ${res.statusCode} ${buf.length}B`) } catch { /* ignore */ }
            resolve({ data: parsed, status: res.statusCode, headers: res.headers, raw: buf })
          } else {
            const bodySnippet = String(typeof parsed === 'string' ? parsed : (() => { try { return JSON.stringify(parsed) } catch { return '' } })() || '').slice(0, 300)
            try { warn('http', `✗ ${method} ${fullPath} ${res.statusCode} body=${bodySnippet}`) } catch { /* ignore */ }
            const err = new Error(`HTTP ${res.statusCode}${bodySnippet ? `：${bodySnippet}` : ''}`)
            err.status = res.statusCode
            err.response = parsed
            err.retryAfter = res.headers['retry-after']
            reject(err)
          }
        })
      })

      req.on('timeout', () => {
        try { req.destroy() } catch { /* ignore */ }
        try { warn('http', `✗ ${method} ${fullPath} Request timeout`) } catch { /* ignore */ }
        reject(new Error('Request timeout'))
      })
      req.on('error', (err) => {
        try { warn('http', `✗ ${method} ${fullPath} ${err && (err.code || err.message) || err}`) } catch { /* ignore */ }
        reject(err)
      })

      if (bodyData) req.write(bodyData)
      req.end()
    })
  }
}

/**
 * Open a raw SSE upstream (SRC server:sse transport half, L556-601): GET with
 * Accept: text/event-stream + X-Machine-ID, resolving with the response
 * stream so the host route pipes it to the browser verbatim. 2xx resolves;
 * non-2xx buffers the body snippet and rejects with err.status. No request
 * timeout — event streams are long-lived; the caller destroys the stream to
 * close (browser disconnect / unsubscribe).
 */
export function createOpenSseStream({ getServerUrl, getMachineId, log = () => {}, warn = () => {} } = {}) {
  return function openSseStream(fullPath) {
    return new Promise((resolve, reject) => {
      const baseUrl = getServerUrl()
      const url = new URL(fullPath.startsWith('http') ? fullPath : baseUrl + fullPath)
      try { log('http', `→ SSE ${fullPath}`) } catch { /* ignore */ }
      const isHttps = url.protocol === 'https:'
      const lib = isHttps ? https : http
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'X-Machine-ID': getMachineId(),
          'Cache-Control': 'no-cache',
        },
      }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const bodySnippet = Buffer.concat(chunks).toString('utf-8').slice(0, 300)
          try { warn('http', `✗ SSE ${fullPath} ${res.statusCode}`) } catch { /* ignore */ }
          const err = new Error(`HTTP ${res.statusCode}${bodySnippet ? `：${bodySnippet}` : ''}`)
          err.status = res.statusCode
          reject(err)
        })
      })
      req.on('error', (err) => {
        try { warn('http', `✗ SSE ${fullPath} ${err && (err.code || err.message) || err}`) } catch { /* ignore */ }
        reject(err)
      })
      req.end()
    })
  }
}

/**
 * 判定是否为"外部服务未部署/不可达"的正常错误，这类错误不打主进程堆栈
 * (SRC server-proxy.js isExpectedOfflineError, L455-464 — verbatim; the
 * montage voice/final channels inject this to mirror the offline-returns-null
 * contract of voice:fonts / fancy:serverTemplates / lut:list).
 */export function isExpectedOfflineError(err) {
  const code = err && (err.code || err.message)
  if (!code) return false
  const offlineCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']
  if (typeof code === 'string' && offlineCodes.some((c) => code.includes(c))) return true
  if (typeof err.message === 'string' && /fetch failed|network error/i.test(err.message)) return true
  return false
}
