// ═══════════════════════════════════════════════════════════════
// jianying-audio-sync.js — 剪映音频素材自动同步（内置定时任务）
// 2026-09-22 用户裁决：客户端内置定时任务，自动把本机剪映音频素材（音效+音乐）
//  同步到服务端音频库——不再依赖「从剪映同步」手动按钮。
//  2026-10-11 用户裁决：默认改为关闭（音频库 4751 条后内容判重 409 风暴，见日志
//  12:59/14:54 两轮）——需 jyaudio:setEnabled 显式开启，startup 首跑同样受开关约束。
//
// 自动范围（成熟度边界）：
//  ✅ 可自动：User Data/Cache/music 已下载缓存（剪映对流式素材按需下载——
//     试听/使用过即落盘）+ Projects/*/draft_content.json 的 materials.audios[]
//     （含真实素材名，修正哈希文件名不可读的问题）
//  ❌ 不可自动：剪映素材库「未下载」的云端条目——拉取需剪映登录态签名接口，
//     无成熟稳定方案（第三方反向接口随时失效），不做；先在剪映里使用即触发下载
//
// 流程：扫描（缓存音频 + 草稿名增强）→ 与服务端音频库 filename 增量比对 →
//  multipart 上传（分类：<2s 音效 / ≥2s 音乐）→ 状态落盘 userData 可查。
// 分层：主进程模块，零渲染层依赖；编排（定时器/开关）在本文件，纯扫描逻辑可测。
// CJS→ESM 纯搬迁（2026-09-23，铁律10）：仅导入导出语法转换，函数体/常量/注释逐字
// 保留。app() 体内 require('electron') 保持惰性——以 createRequire 别名实现，
// 顶层不 import electron（harness 子进程加载本模块不得触碰 electron）；
// initJianyingAudioSync 的 IPC 接线由编排层负责。
// ═══════════════════════════════════════════════════════════════
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const DEFAULT_INTERVAL_MIN = 30

/** 收集本机剪映音频缓存（Cache/music 下 mp3/wav/m4a，≥1KB） */
function listAudioCacheFiles(jianyingRoot) {
  const dir = path.join(jianyingRoot, 'Cache', 'music')
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.(mp3|wav|m4a)$/i.test(f))
      .map((f) => {
        const fp = path.join(dir, f)
        let bytes = 0
        try { bytes = fs.statSync(fp).size } catch (_) {}
        return { file: fp, id: f.replace(/\.(mp3|wav|m4a)$/i, ''), ext: path.extname(f).toLowerCase(), bytes }
      })
      .filter((x) => x.bytes >= 1024)
  } catch (_) {
    return []
  }
}

/** 扫描草稿库建立 缓存路径→真实素材名 映射（materials.audios[].name 为剪映内显示名） */
function buildDraftAudioNameMap(jianyingRoot) {
  const map = new Map()
  const projectsRoot = path.join(jianyingRoot, 'Projects')
  let roots = []
  try { roots = fs.readdirSync(projectsRoot) } catch (_) { return map }
  for (const ns of roots) {
    const nsDir = path.join(projectsRoot, ns)
    let drafts = []
    try { drafts = fs.readdirSync(nsDir) } catch (_) { continue }
    for (const d of drafts) {
      const dj = path.join(nsDir, d, 'draft_content.json')
      try {
        if (!fs.existsSync(dj)) continue
        const j = JSON.parse(fs.readFileSync(dj, 'utf-8'))
        const audios = j && j.materials && Array.isArray(j.materials.audios) ? j.materials.audios : []
        for (const a of audios) {
          const p = String(a.path || '').trim()
          const nm = String(a.name || '').trim()
          if (p && nm) map.set(p.toLowerCase(), nm)
        }
      } catch (_) { /* 单草稿损坏跳过 */ }
    }
  }
  return map
}

/**
 * 扫描本机剪映音频素材（纯函数核心，便于单测）：
 * 返回 [{id, file, name, category}]——name 优先草稿真实名（哈希文件名不可读），
 * category：<2s 音效 / 其余音乐（同导出音效池口径；无时长按 音乐），
 * excludeNames=服务端已有 filename 集合（lower），命中的为已同步不重复上传。
 */
function collectNewAudioItems(opts) {
  const o = opts || {}
  const files = Array.isArray(o.files) ? o.files : []
  const nameByPath = o.nameByPath instanceof Map ? o.nameByPath : new Map()
  const excludeNames = o.excludeNames instanceof Set ? o.excludeNames : new Set()
  const out = []
  for (const f of files) {
    const lower = path.basename(f.file).toLowerCase()
    if (excludeNames.has(lower)) continue
    const durSec = Number(f.duration) || 0
    const real = nameByPath.get(String(f.file).toLowerCase()) || ''
    const display = real || ('剪映音频_' + f.id.slice(0, 8))
    const safeName = String(display).replace(/[\\/:*?"<>|]/g, '_').trim() || ('jyaudio_' + f.id.slice(0, 8))
    out.push({
      id: f.id,
      file: f.file,
      filename: safeName + f.ext,
      name: display,
      category: durSec > 0 && durSec < 2 ? '音效' : '音乐',
      durSec,
    })
  }
  return out
}

/** 创建控制器（main 进程注入 ipcMain/httpRequest/getServerUrl/probeMedia） */
function initJianyingAudioSync(deps) {
  const { ipcMain, httpRequest, getServerUrl, probeMedia } = deps
  const stateFile = () => path.join(app().getPath('userData'), 'jianying_audio_sync_state.json')
  const jianyingRoot = () => path.join(process.env.LOCALAPPDATA || '', 'JianyingPro', 'User Data')
  function app() { return require('electron').app }

  let timer = null
  let running = false
  // 2026-10-11 用户裁决（409 风暴）：自动同步默认关闭。旧默认(true)写进过状态文件
  // 的视为未选择（无 UI 开关，不存在用户主动开启路径），一次性按新默认重置；
  // 此后 jyaudio:setEnabled 的显式开关随 defaultOff 标记正常记忆。
  const state = { enabled: false, intervalMin: DEFAULT_INTERVAL_MIN, lastRunAt: null, lastResult: '', defaultOff: true, syncedHashes: [] }
  try {
    const persisted = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) || {}
    if (persisted.defaultOff === true) Object.assign(state, persisted)
    else Object.assign(state, persisted, { enabled: false, defaultOff: true })
  } catch (_) {}

  function saveState() {
    try { fs.writeFileSync(stateFile(), JSON.stringify({ enabled: state.enabled, intervalMin: state.intervalMin, lastRunAt: state.lastRunAt, lastResult: state.lastResult, defaultOff: state.defaultOff === true }, null, 2)) } catch (_) {}
  }

  /** 单次同步：扫描 → 增量比对 → 逐条 multipart 上传（串行，单失败不阻断） */
  async function syncNow(trigger = 'timer') {
    if (running) return { ok: false, error: '上次同步仍在执行' }
    running = true
    const results = { added: 0, skipped: 0, failed: 0, total: 0, errors: [] }
    try {
      await httpRequest('GET', '/health', { timeout: 5000 }).catch(() => { throw new Error('服务端不可达（OFFLINE）') })
      // 增量比对基线（2026-10-11 用户裁决，治本）：按内容哈希本地判重——旧方案按
      // 文件名翻页爬全库（4751 条×100/页）建排除名单，服务端 flap 时名单残缺→整缓存
      // 误判为新→409 风暴（2026-09-24 前科+2026-10-10/11 两轮复发）。现哈希在本地
      // 状态文件持久化，409（服务端已有同内容）亦记账，零 /audio/library 列表依赖。
      const synced = new Set(state.syncedHashes || [])
      const files = listAudioCacheFiles(jianyingRoot())
      const nameByPath = buildDraftAudioNameMap(jianyingRoot())
      const items = collectNewAudioItems({ files, nameByPath })
      results.total = items.length
      let conflictStreak = 0
      for (const it of items) {
        try {
          const boundary = '----TinTinJyAudioSync' + Date.now() + Math.floor(Math.random() * 1e4)
          const abuf = fs.readFileSync(it.file)
          const hash = createHash('sha256').update(abuf).digest('hex')
          if (synced.has(hash)) { results.skipped++; continue }
          const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${it.filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`),
            abuf,
            Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${encodeURIComponent(it.category)}`),
            Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${encodeURIComponent('剪映')}`),
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ])
          const up = await httpRequest('POST', '/audio/library/upload', {
            body,
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
            timeout: 120000,
          }).catch((e) => ({ error: e.message, status: e.status }))
          if (up && up.error) {
            // 409=服务端已有同内容（哈希判重）：内容已在库=已同步，记账后不再重传；
            // 连续 20 条判重即中止本轮（疑似判重异常，避免刷满日志）
            if (up.status === 409) {
              results.skipped++
              synced.add(hash)
              conflictStreak++
              if (conflictStreak >= 20) {
                results.errors.push('连续 20 条被服务端判重——中止本轮')
                break
              }
              continue
            }
            conflictStreak = 0
            throw new Error(up.error)
          }
          conflictStreak = 0
          synced.add(hash)
          results.added++
        } catch (e) {
          results.failed++
          results.errors.push(`${it.name}: ${e.message}`)
        }
      }
      state.syncedHashes = Array.from(synced)
      state.lastRunAt = new Date().toISOString()
      state.lastResult = `新增 ${results.added}，跳过已存在 ${results.skipped}${results.failed ? '，失败 ' + results.failed : ''}（扫描 ${results.total} 条）`
      saveState()
    } catch (e) {
      state.lastRunAt = new Date().toISOString()
      state.lastResult = '失败：' + e.message
      saveState()
    } finally {
      running = false
    }
    void trigger
    return results
  }

  function startTimer() {
    stopTimer()
    if (!state.enabled) return
    timer = setInterval(() => { void syncNow('timer') }, Math.max(5, state.intervalMin) * 60 * 1000)
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  ipcMain.handle('jyaudio:syncNow', async () => { const r = await syncNow('manual'); return { ok: !r.error, ...r, lastResult: state.lastResult } })
  ipcMain.handle('jyaudio:status', () => ({ ...state, running }))
  ipcMain.handle('jyaudio:setEnabled', (_e, p) => {
    state.enabled = !!(p && p.enabled)
    if (!state.enabled) stopTimer(); else startTimer()
    saveState()
    return { ok: true, enabled: state.enabled }
  })

  return {
    get enabled() { return state.enabled },
    startTimer() { if (state.enabled && !timer) { timer = setInterval(() => { void syncNow('timer') }, Math.max(5, state.intervalMin) * 60 * 1000) } },
    stopTimer,
    syncNow,
  }
}

/** 启动定时器（启用时：启动后 90 秒首跑，此后按 interval 周期；关闭时 startup 首跑也不执行） */
function startJianyingAudioSyncTimer(ctrl) {
  setTimeout(() => { if (ctrl.enabled) void ctrl.syncNow('startup') }, 90 * 1000)
  ctrl.startTimer()
}

export { initJianyingAudioSync, startJianyingAudioSyncTimer, collectNewAudioItems, listAudioCacheFiles, buildDraftAudioNameMap, DEFAULT_INTERVAL_MIN }
