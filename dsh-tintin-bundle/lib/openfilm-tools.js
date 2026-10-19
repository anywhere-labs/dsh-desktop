// openfilm-tools — TinTin 服务端媒体能力 → DSH 工具（2026-10-18 用户裁决：
// registry 驱动的工具层，先切媒体能力）。工具负责四件手拼 HTTP 做不好的事：
//   1) 参数归一化（音色/引擎/可选参数）；
//   2) 生成物落进影片项目（默认 assets/tintin/，相对路径按会话 cwd 解析）；
//   3) 异步任务轮询（/tasks/unified/{id}，带超时与继续查询提示）；
//   4) 错误归一化为 {ok:false,error}，不打断会话回路。
// 契约来源：GET /agent/registry（39 能力，method/path/input_schema/sync）。
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'

const errText = (e) => (e instanceof Error ? e.message : String(e))
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 服务端相对 URL → 绝对 URL。 */
export function absoluteUrl(baseUrl, url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return base + (value.startsWith('/') ? value : `/${value}`)
}

/** URL / content-type → 落盘扩展名。 */
export function extensionOf(url, contentType = '') {
  const fromUrl = extname(String(url || '').split('?')[0]).toLowerCase()
  if (fromUrl) return fromUrl
  const type = String(contentType || '').toLowerCase()
  if (type.includes('wav')) return '.wav'
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3'
  if (type.includes('mp4') || type.includes('video')) return '.mp4'
  if (type.includes('png')) return '.png'
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg'
  if (type.includes('webp')) return '.webp'
  return '.bin'
}

/** 会话 cwd（影片项目）：agent.session.header.meta.cwd。 */
export function sessionCwd(exec) {
  try {
    return String(exec?.agent?.session?.header?.meta?.cwd
      || exec?.agent?.session?.meta?.cwd
      || '')
  } catch {
    return ''
  }
}

/** 输入文件路径：绝对照用，相对按会话 cwd 解析。 */
export function resolveInPath(exec, file) {
  const value = String(file || '').trim()
  if (!value) throw new Error('缺少输入文件路径')
  if (isAbsolute(value)) return value
  const cwd = sessionCwd(exec)
  if (!cwd) throw new Error(`相对路径需要会话工作区，请传绝对路径：${value}`)
  return join(cwd, value)
}

/** 输出路径：绝对照用；相对按会话 cwd 解析。 */
export function resolveOutPath(exec, out, fallbackName) {
  const value = String(out || fallbackName || '').trim()
  if (!value) throw new Error('缺少输出路径')
  if (isAbsolute(value)) return value
  const cwd = sessionCwd(exec)
  if (!cwd) throw new Error(`相对路径需要会话工作区，请传绝对路径：${value}`)
  return join(cwd, value)
}

/** 不覆盖已有文件：a.wav → a-2.wav。 */
export function uniquePath(path) {
  if (!existsSync(path)) return path
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`
    if (!existsSync(candidate)) return candidate
  }
  return path
}

/** 从任务响应里取任务 id（id/task_id/嵌套 data）。 */
export function taskIdOf(body) {
  const obj = asObj(body)
  if (!obj) return ''
  for (const key of ['task_id', 'taskId', 'id', 'job_id', 'jobId']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key]
    if (typeof obj[key] === 'number') return String(obj[key])
  }
  const data = asObj(obj.data)
  return data ? taskIdOf(data) : ''
}

/** 从任务响应里取状态（小写）。 */
export function taskStatusOf(body) {
  const obj = asObj(body)
  if (!obj) return ''
  for (const key of ['status', 'state']) {
    if (typeof obj[key] === 'string') return obj[key].toLowerCase()
  }
  const data = asObj(obj.data)
  return data ? taskStatusOf(data) : ''
}

const DONE = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'finished'])
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled'])

/** 时间戳后缀（同一次对话里不撞名）。 */
export const stamp = () => Date.now().toString(36)

/** 从 ASR 的 segments[].words[] 生成逐词 VTT（与官方例子同形态）。 */
export function wordTimedVtt(segments) {
  const list = Array.isArray(segments) ? segments : []
  const time = (sec) => {
    const total = Math.max(0, Number(sec) || 0)
    const whole = Math.floor(total)
    const ms = Math.round((total - whole) * 1000)
    const hh = String(Math.floor(whole / 3600)).padStart(2, '0')
    const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0')
    const ss = String(whole % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`
  }
  const lines = ['WEBVTT', '']
  for (const segment of list) {
    const start = Number(segment?.start) || 0
    const end = Number(segment?.end) || start
    const words = Array.isArray(segment?.words) ? segment.words : []
    const text = words.length
      ? words.map((w, index) => {
        const token = String(w?.word ?? '')
        return index === 0 ? token : `<${time(w?.start)}>${token}`
      }).join('')
      : String(segment?.text || '')
    if (!text) continue
    lines.push(`${time(start)} --> ${time(end)}`, text, '')
  }
  return lines.join('\n')
}

/**
 * Build the media tools. All HTTP goes through the host's injected request
 * functions (server URL, machine id, trust rules stay in one place).
 * @param {{
 *   httpRequest: (method: string, path: string, options?: Record<string, unknown>) => Promise<{ data: unknown }>,
 *   getServerUrl: () => string,
 *   multipartPost: (path: string, parts: Array<Record<string, unknown>>, timeout?: number) => Promise<unknown>,
 *   fetchFile?: (url: string, target: string) => Promise<void>,
 *   log?: (...args: unknown[]) => void,
 *   warn?: (...args: unknown[]) => void,
 * }} deps
 * @returns {Array<Record<string, unknown>>}
 */
export function createOpenfilmMediaTools({
  httpRequest, getServerUrl, multipartPost, fetchFile, log = () => {}, warn = () => {},
} = {}) {
  if (typeof httpRequest !== 'function' || typeof multipartPost !== 'function' || typeof getServerUrl !== 'function') {
    throw new Error('createOpenfilmMediaTools requires httpRequest, multipartPost and getServerUrl')
  }
  const baseUrl = () => String(getServerUrl() || '').replace(/\/+$/, '')
  const download = async (url, target) => {
    const absolute = absoluteUrl(baseUrl(), url)
    if (!absolute) throw new Error('服务端未返回可下载地址')
    const path = uniquePath(target)
    mkdirSync(dirname(path), { recursive: true })
    if (typeof fetchFile === 'function') {
      await fetchFile(absolute, path)
      return path
    }
    const response = await fetch(absolute, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${absolute}`)
    writeFileSync(path, Buffer.from(await response.arrayBuffer()))
    return path
  }
  const pollTask = async (id, { timeoutMs = 600_000, intervalMs = 1500 } = {}) => {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      const response = await httpRequest('GET', `/tasks/unified/${encodeURIComponent(id)}`, { timeout: 30_000 })
      last = response?.data
      const state = taskStatusOf(last)
      if (DONE.has(state)) return { state, body: last }
      if (FAILED.has(state)) {
        const detail = asObj(last)?.error ?? asObj(last)?.message ?? state
        throw new Error(`任务 ${id} ${state}：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
      }
      await sleep(intervalMs)
    }
    throw new Error(`任务 ${id} 超时（${Math.round(timeoutMs / 1000)}s）；可用 tintin_task_status 继续查询`)
  }
  const maybeTask = async (body, options) => {
    const id = taskIdOf(body)
    const state = taskStatusOf(body)
    if (id && !DONE.has(state)) {
      log('openfilm-tools', 'task queued:', id)
      return pollTask(id, options)
    }
    return { state: state || 'completed', body }
  }
  const jsonText = (value) => {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  const render = (_args, value) => [{ type: 'text', text: jsonText(value) }]
  const output = (properties) => ({
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' }, ...properties } },
    render,
  })
  const run = (fn, onError) => async (args, exec) => {
    try { return await fn(args ?? {}, exec) } catch (error) {
      warn('openfilm-tools', 'failed:', errText(error))
      return onError(error)
    }
  }

  return [
    {
      name: 'tintin_voices',
      description: '列出 TinTin 服务端可用的配音音色：声音样本库（id 用作 sample_id，克隆音色）与 Qwen3 预置音色（engine=qwen3 + speaker）。做旁白/口播前先调它选音色。',
      parameters: {},
      output: output({ samples: { type: 'string', description: 'JSON 数组：{id,name,audio_url}' }, speakers: { type: 'string' } }),
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '列出配音音色', rawInput: {} }),
      execute: run(async () => {
        const samples = (await httpRequest('GET', '/voice/samples', { timeout: 30_000 }))?.data
        const items = Array.isArray(samples?.items) ? samples.items : (Array.isArray(samples) ? samples : [])
        const list = items
          .filter((item) => item && item.id !== undefined)
          .map((item) => ({ id: Number(item.id), name: String(item.name || item.text || `样本 ${item.id}`), audio_url: String(item.audio_url || '') }))
        let speakers = []
        try {
          const qwen = (await httpRequest('GET', '/indextts/qwen3/voices', { timeout: 30_000 }))?.data
          speakers = Array.isArray(qwen?.speakers) ? qwen.speakers.map(String) : []
        } catch { /* qwen3 未部署 */ }
        return { ok: true, samples: jsonText(list.slice(0, 50)), speakers: speakers.join(', ') }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_tts',
      description: '用 TinTin 服务端合成配音（声音克隆/预置音色），音频落到影片项目（默认 assets/tintin/vo-<ts>.wav）。先 tintin_voices 选 sample_id（克隆）或 engine=qwen3+speaker（预置）。一句约 0.25 秒/字，长句可能 1 分钟。',
      parameters: {
        text: { type: 'string', required: true, description: '要说的整段文本（一次整段提交，不要逐句拆）' },
        sample_id: { type: 'number', description: '声音样本 id（tintin_voices 返回；克隆音色）' },
        engine: { type: 'string', description: '引擎：indextts（默认）/ qwen3 / voxcpm' },
        speaker: { type: 'string', description: 'Qwen3 预置音色名（engine=qwen3 时）' },
        ref_text: { type: 'string', description: '克隆参考文本（voxcpm/qwen3 克隆需要）' },
        lang: { type: 'string', description: '语言，默认 ZH' },
        duration_factor: { type: 'number', description: '语速系数（1=正常）' },
        emo_text: { type: 'string', description: '情感提示（如 开心/温柔）' },
        emo_alpha: { type: 'number', description: '情感强度 0-1' },
        out: { type: 'string', description: '输出路径；缺省 assets/tintin/vo-<ts>.wav（相对影片项目）' },
      },
      output: output({ path: { type: 'string' }, audio_url: { type: 'string' }, sample_rate: { type: 'number' } }),
      timeoutMs: 360_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '合成配音', rawInput: { text: String(args?.text || '').slice(0, 80) } }),
      execute: run(async (args, exec) => {
        const text = String(args.text || '').trim()
        if (!text) throw new Error('text 必填')
        if (args.sample_id === undefined && !(String(args.engine || '') === 'qwen3' && args.speaker)) {
          throw new Error('缺少音色：先调 tintin_voices，传 sample_id；或 engine=qwen3 + speaker')
        }
        const body = {
          text,
          resp: 'json',
          ...(args.sample_id === undefined ? {} : { sample_id: Number(args.sample_id) }),
          ...(args.engine ? { engine: String(args.engine) } : {}),
          ...(args.speaker ? { speaker: String(args.speaker) } : {}),
          ...(args.ref_text ? { ref_text: String(args.ref_text) } : {}),
          ...(args.lang ? { lang: String(args.lang) } : {}),
          ...(args.duration_factor === undefined ? {} : { duration_factor: Number(args.duration_factor) }),
          ...(args.emo_text ? { emo_text: String(args.emo_text) } : {}),
          ...(args.emo_alpha === undefined ? {} : { emo_alpha: Number(args.emo_alpha) }),
        }
        const response = (await httpRequest('POST', '/indextts/tts', { body, timeout: 330_000 }))?.data
        const audioUrl = String(asObj(response)?.audio_url || '')
        if (!audioUrl) throw new Error(`服务端未返回 audio_url：${jsonText(response).slice(0, 200)}`)
        const out = String(args.out || join('assets', 'tintin', `vo-${stamp()}.wav`))
        const path = await download(audioUrl, resolveOutPath(exec, out))
        return { ok: true, path, audio_url: audioUrl, ...(asObj(response)?.sample_rate ? { sample_rate: Number(response.sample_rate) } : {}) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_asr',
      description: '用 TinTin 服务端转写本地音视频（whisper），返回句段 + 逐词时间戳（mode=raw），并可写出逐词 VTT。用于字幕、按词驱动页面动画。file 可为绝对路径或相对影片项目。',
      parameters: {
        file: { type: 'string', required: true, description: '本地音视频路径（absolute 或相对影片项目）' },
        language: { type: 'string', description: '语言，默认 zh' },
        vtt: { type: 'string', description: '可选：逐词 VTT 输出路径（如 assets/tintin/vo-1.vtt）' },
      },
      output: output({ segments: { type: 'string', description: 'JSON：segments[].words[]' }, words: { type: 'number' }, vtt_path: { type: 'string' } }),
      timeoutMs: 660_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '转写音视频', rawInput: { file: String(args?.file || '') } }),
      execute: run(async (args, exec) => {
        const file = resolveInPath(exec, args.file)
        if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
        const raw = await multipartPost('/whisper/transcribe', [
          { name: 'file', path: file },
          { name: 'fmt', value: 'json' },
          { name: 'mode', value: 'raw' },
          { name: 'language', value: String(args.language || 'zh') },
        ], 640_000)
        const parsed = Buffer.isBuffer(raw) ? (() => { try { return JSON.parse(raw.toString('utf8')) } catch { return null } })() : raw
        const segments = Array.isArray(parsed?.segments) ? parsed.segments : []
        const words = segments.reduce((total, segment) => total + (Array.isArray(segment?.words) ? segment.words.length : 0), 0)
        let vttPath = ''
        if (args.vtt) {
          const target = uniquePath(resolveOutPath(exec, args.vtt))
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, wordTimedVtt(segments), 'utf8')
          vttPath = target
        }
        return { ok: true, segments: jsonText({ text: parsed?.text || '', segments }), words, ...(vttPath ? { vtt_path: vttPath } : {}) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_beatmap',
      description: '分析本地音频的节拍/段落/卡点（bpm、beats、downbeats、bars、structure、percussion_hits、smart_cuts），用于卡点剪辑。异步任务会自动轮询。返回服务端 JSON。',
      parameters: {
        file: { type: 'string', required: true, description: '本地音频路径（absolute 或相对影片项目）' },
        count: { type: 'number', description: '期望卡点数（可选）' },
        min_duration: { type: 'number', description: '最短片段秒数（可选）' },
        max_duration: { type: 'number', description: '最长片段秒数（可选）' },
      },
      output: output({ result: { type: 'string', description: 'JSON：节拍与卡点' } }),
      timeoutMs: 660_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '音频卡点分析', rawInput: { file: String(args?.file || '') } }),
      execute: run(async (args, exec) => {
        const file = resolveInPath(exec, args.file)
        if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
        const parts = [{ name: 'file', path: file }]
        if (args.count !== undefined) parts.push({ name: 'count', value: String(Number(args.count)) })
        if (args.min_duration !== undefined) parts.push({ name: 'min_duration', value: String(Number(args.min_duration)) })
        if (args.max_duration !== undefined) parts.push({ name: 'max_duration', value: String(Number(args.max_duration)) })
        const raw = await multipartPost('/audio/beatmap', parts, 120_000)
        const parsed = Buffer.isBuffer(raw) ? (() => { try { return JSON.parse(raw.toString('utf8')) } catch { return null } })() : raw
        const finished = await maybeTask(parsed, { timeoutMs: 600_000 })
        return { ok: true, result: jsonText(finished.body) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_bgm',
      description: '生成背景音乐（服务端 MusicGen，器乐，3-60 秒），音频落到影片项目（默认 assets/tintin/bgm-<ts>.wav）。返回路径与时长。',
      parameters: {
        prompt: { type: 'string', required: true, description: '音乐描述（风格/情绪/乐器）' },
        style: { type: 'string', description: '风格标签（如 electronic/ambient/piano）' },
        duration: { type: 'number', description: '时长秒（3-60）' },
        out: { type: 'string', description: '输出路径；缺省 assets/tintin/bgm-<ts>.wav' },
      },
      output: output({ path: { type: 'string' }, duration: { type: 'number' }, url: { type: 'string' } }),
      timeoutMs: 360_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '生成背景音乐', rawInput: { prompt: String(args?.prompt || '') } }),
      execute: run(async (args, exec) => {
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('prompt 必填')
        const body = { prompt, style: String(args.style || 'auto'), ...(args.duration === undefined ? {} : { duration: Number(args.duration) }) }
        const response = (await httpRequest('POST', '/audio/gen/bgm', { body, timeout: 330_000 }))?.data
        const url = String(asObj(response)?.url || '')
        if (!url) throw new Error(`服务端未返回 url：${jsonText(response).slice(0, 200)}`)
        const out = String(args.out || join('assets', 'tintin', `bgm-${stamp()}${extensionOf(url)}`))
        const path = await download(url, resolveOutPath(exec, out))
        return { ok: true, path, duration: Number(asObj(response)?.duration) || 0, url }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_sfx',
      description: '生成音效（服务端 AudioLDM2），音频落到影片项目（默认 assets/tintin/sfx-<ts>.wav）。返回路径与时长。',
      parameters: {
        prompt: { type: 'string', required: true, description: '音效描述（如 ui click / whoosh / riser）' },
        duration: { type: 'number', description: '时长秒' },
        out: { type: 'string', description: '输出路径；缺省 assets/tintin/sfx-<ts>.wav' },
      },
      output: output({ path: { type: 'string' }, duration: { type: 'number' }, url: { type: 'string' } }),
      timeoutMs: 360_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '生成音效', rawInput: { prompt: String(args?.prompt || '') } }),
      execute: run(async (args, exec) => {
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('prompt 必填')
        const body = { prompt, ...(args.duration === undefined ? {} : { duration: Number(args.duration) }) }
        const response = (await httpRequest('POST', '/audio/gen/sfx', { body, timeout: 330_000 }))?.data
        const url = String(asObj(response)?.url || '')
        if (!url) throw new Error(`服务端未返回 url：${jsonText(response).slice(0, 200)}`)
        const out = String(args.out || join('assets', 'tintin', `sfx-${stamp()}${extensionOf(url)}`))
        const path = await download(url, resolveOutPath(exec, out))
        return { ok: true, path, duration: Number(asObj(response)?.duration) || 0, url }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_stock_images',
      description: '搜索在线素材图/视频（Pexels/Pixabay）。可把前 N 张图下载到影片项目（默认 assets/tintin/stock/）。用于需要真实照片但不做 AI 生成画面时。',
      parameters: {
        query: { type: 'string', required: true, description: '搜索词' },
        kind: { type: 'string', description: 'image（默认）或 video' },
        per: { type: 'number', description: '返回条数 1-30，默认 8' },
        download: { type: 'number', description: '下载前 N 条到项目（默认 0）' },
        out_dir: { type: 'string', description: '下载目录；缺省 assets/tintin/stock' },
      },
      output: output({ items: { type: 'string', description: 'JSON 数组：url/thumb/width/height/author' }, paths: { type: 'string', description: 'JSON 数组：下载到的本地路径' } }),
      timeoutMs: 300_000,
      isConcurrencySafe: () => true,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '搜索在线素材', rawInput: { query: String(args?.query || '') } }),
      execute: run(async (args, exec) => {
        const query = String(args.query || '').trim()
        if (!query) throw new Error('query 必填')
        const body = { query, kind: String(args.kind || 'image'), per: Math.max(1, Math.min(30, Number(args.per) || 8)) }
        const response = (await httpRequest('POST', '/material/stock_search', { body, timeout: 60_000 }))?.data
        const items = (Array.isArray(response?.items) ? response.items : []).map((item) => ({
          url: String(item?.url || ''), thumb: String(item?.thumb || ''), width: Number(item?.width) || 0, height: Number(item?.height) || 0, author: String(item?.author || ''),
        })).filter((item) => item.url)
        const wanted = Math.max(0, Math.min(items.length, Number(args.download) || 0))
        const paths = []
        if (wanted > 0) {
          const dir = String(args.out_dir || join('assets', 'tintin', 'stock'))
          for (let index = 0; index < wanted; index += 1) {
            const item = items[index]
            const target = resolveOutPath(exec, join(dir, `stock-${stamp()}-${index + 1}${extensionOf(item.url)}`))
            paths.push(await download(item.url, target))
          }
        }
        return { ok: true, items: jsonText(items), paths: jsonText(paths) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_image_reverse',
      description: '反推图片提示词（服务端 vision）。传本地图片路径（或素材库 material_id），返回服务端识别出的提示词/描述。',
      parameters: {
        file: { type: 'string', description: '本地图片路径（absolute 或相对影片项目）' },
        material_id: { type: 'number', description: '素材库条目 id（与 file 二选一）' },
      },
      output: output({ result: { type: 'string', description: '服务端 JSON/文本' } }),
      timeoutMs: 180_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '反推图片提示词', rawInput: {} }),
      execute: run(async (args, exec) => {
        if (!args.file && args.material_id === undefined) throw new Error('file 或 material_id 必填')
        const parts = []
        if (args.file) parts.push({ name: 'file', path: resolveInPath(exec, args.file) })
        if (args.material_id !== undefined) parts.push({ name: 'material_id', value: String(Number(args.material_id)) })
        const raw = await multipartPost('/prompt/image', parts, 150_000)
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : jsonText(raw)
        return { ok: true, result: text }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_comfyui',
      description: '提交 ComfyUI 工作流（服务端 /comfyui/run）。workflow_file 指向工作流 JSON，或 workflow_json 直接给对象。异步结果自动轮询；返回服务端结果（通常含输出文件 URL）。',
      parameters: {
        workflow_file: { type: 'string', description: '工作流 JSON 文件路径（absolute 或相对影片项目）' },
        workflow_json: { type: 'string', description: '工作流 JSON 文本（与 workflow_file 二选一）' },
      },
      output: output({ result: { type: 'string', description: '服务端 JSON' } }),
      timeoutMs: 660_000,
      isConcurrencySafe: () => false,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '提交 ComfyUI 工作流', rawInput: {} }),
      execute: run(async (args, exec) => {
        let workflow = null
        if (args.workflow_json) workflow = JSON.parse(String(args.workflow_json))
        else if (args.workflow_file) workflow = JSON.parse(readFileSync(resolveInPath(exec, args.workflow_file), 'utf8'))
        if (!asObj(workflow)) throw new Error('workflow 必须是 JSON 对象')
        const response = (await httpRequest('POST', '/comfyui/run', { body: { workflow }, timeout: 600_000 }))?.data
        const finished = await maybeTask(response, { timeoutMs: 600_000 })
        return { ok: true, result: jsonText(finished.body) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_task_status',
      description: '查询 TinTin 服务端统一任务状态（/tasks/unified/{id}）：status/progress/result/error。异步能力超时后用它在之后继续查。',
      parameters: {
        task_id: { type: 'string', required: true, description: '任务 id' },
      },
      output: output({ status: { type: 'string' }, result: { type: 'string', description: 'JSON：任务结果（完成时）' } }),
      timeoutMs: 60_000,
      isConcurrencySafe: () => true,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '查询服务端任务', rawInput: { task_id: String(args?.task_id || '') } }),
      execute: run(async (args) => {
        const id = String(args.task_id || '').trim()
        if (!id) throw new Error('task_id 必填')
        const body = (await httpRequest('GET', `/tasks/unified/${encodeURIComponent(id)}`, { timeout: 30_000 }))?.data
        return { ok: true, status: taskStatusOf(body) || 'unknown', result: jsonText(body) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'tintin_capabilities',
      description: '读取 TinTin 服务端能力注册表（GET /agent/registry，39 项：llm/tts/asr/音乐/音效/素材/视频剪辑/数字人/ComfyUI/即梦等），可按关键词过滤。用于发现本工具集没直接封装的高级能力。',
      parameters: {
        filter: { type: 'string', description: '关键词（匹配 id/name/description，不区分大小写）' },
      },
      output: output({ count: { type: 'number' }, capabilities: { type: 'string', description: 'JSON 数组：id/name/method/path/sync/input_schema' } }),
      timeoutMs: 60_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', kind: 'execute', title: '读取服务端能力注册表', rawInput: {} }),
      execute: run(async (args) => {
        const body = (await httpRequest('GET', '/agent/registry', { timeout: 30_000 }))?.data
        const all = Array.isArray(body?.capabilities) ? body.capabilities : []
        const needle = String(args.filter || '').trim().toLowerCase()
        const list = (needle
          ? all.filter((item) => `${item?.id} ${item?.name} ${item?.description}`.toLowerCase().includes(needle))
          : all
        ).map((item) => ({
          id: item?.id, name: item?.name, method: item?.method, path: item?.path, sync: item?.sync, input_schema: item?.input_schema,
        }))
        return { ok: true, count: list.length, capabilities: jsonText(list) }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
  ]
}
