// A 轴工具层（2026-10-21 用户裁决）：编导只产出时间线 JSON，由这两个工具确定性
// 地完成「编译成项目」与「渲染成片」。一次调用取代过去近百次 shell 往返。
//
//   film_compile { timeline }  → 校验 → 落素材 → 写 film.html / 字幕 vtt（可反复调用）
//   film_render  { out?, fps?} → 本地 Chromium+ffmpeg 渲染成片（服务端渲染留作可选通道）
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { compileTimeline, validateTimeline, assetSourceOf } from './film-timeline.js'
import { resolveOpenfilmRuntime, studioEnv } from './openfilm/studio-runtime.js'

const errText = (error) => (error instanceof Error ? error.message : String(error))
const jsonText = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }
const render = (_args, value) => [{ type: 'text', text: jsonText(value) }]
const output = (properties) => ({
  schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' }, ...properties } },
  render,
})
const run = (fn, onError) => async (args, exec) => {
  try { return await fn(args ?? {}, exec) } catch (error) { return onError(error) }
}

/** 会话工作目录（影片项目根）。 */
function projectDirOf(exec, args) {
  const explicit = String(args?.project || '').trim()
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)
  const cwd = exec?.agent?.session?.header?.meta?.cwd
  return typeof cwd === 'string' && cwd.length ? cwd : ''
}

/** 时间线参数可以是对象、JSON 字符串或项目内文件路径。 */
function timelineOf(args, project) {
  const raw = args?.timeline
  if (raw && typeof raw === 'object') return raw
  const text = String(raw ?? '').trim()
  if (!text) throw new Error('timeline 必填：传时间线 JSON 对象，或项目内 .json 文件路径')
  if (/\.json$/i.test(text)) {
    const file = isAbsolute(text) ? text : join(project, text)
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  return JSON.parse(text)
}

/**
 * @param {{
 *   httpRequest?: (method: string, path: string, options?: Record<string, unknown>) => Promise<{ data?: unknown }>,
 *   getServerUrl?: () => string,
 *   log?: (...args: unknown[]) => void,
 *   warn?: (...args: unknown[]) => void,
 *   env?: Record<string, string | undefined>,
 * }} deps
 */
export function createOpenfilmFilmTools({ httpRequest, getServerUrl, log = () => {}, warn = () => {}, env = process.env } = {}) {
  const baseUrl = () => String(getServerUrl?.() || '').replace(/\/+$/, '')

  const fetchToFile = async (url, target) => {
    mkdirSync(dirname(target), { recursive: true })
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${url}`)
    writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  }

  const stageAsset = async (project, rel, source) => {
    const target = join(project, ...rel.split('/'))
    if (!target.startsWith(join(project, 'assets'))) throw new Error(`素材路径越界：${rel}`)
    if (source.kind === 'local') {
      const file = isAbsolute(source.value) ? source.value : join(project, source.value)
      if (!existsSync(file)) throw new Error(`本地素材不存在：${source.value}`)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(file, target)
      return
    }
    if (source.kind === 'url') { await fetchToFile(source.value, target); return }
    const base = baseUrl()
    if (!base) throw new Error('服务端地址未配置：无法下载 material 素材')
    await fetchToFile(`${base}/material/serve?material_id=${encodeURIComponent(source.value)}`, target)
  }

  return [
    {
      name: 'film_compile',
      description: [
        '把结构化时间线编译成影片项目（film.html + assets）。这是编辑影片的唯一正确方式——不要用 pwsh 一条条改片段。',
        '时间线格式：{version:1, resolution:"1920x1080", tracks:[{kind:"video", clips:[{asset, at, in?, out?, speed?}]},',
        '{kind:"voice|music|sfx", clips:[{asset, at, in?, out?, volume?}]}, {kind:"subtitle", cues:[{at, to, text}]}]}。',
        'asset 支持 material:<id>（服务端素材）、http(s) URL、本地路径。校验失败会返回 errors，按提示改 JSON 再调用。',
      ].join(''),
      parameters: {
        timeline: { type: 'object', required: true, description: '时间线 JSON 对象（或项目内 .json 文件路径）' },
        project: { type: 'string', description: '影片项目目录；缺省用会话工作目录' },
      },
      output: output({
        project: { type: 'string' }, assets: { type: 'number' }, subtitle: { type: 'string' }, warnings: { type: 'string' }, errors: { type: 'string' },
      }),
      timeoutMs: 600_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '编译时间线', rawInput: { tracks: Array.isArray(args?.timeline?.tracks) ? args.timeline.tracks.length : '?' } }),
      execute: run(async (args, exec) => {
        const project = projectDirOf(exec, args)
        if (!project) throw new Error('找不到影片项目：请在影片项目目录里调用，或传 project')
        if (!existsSync(join(project, 'film.html'))) throw new Error(`不是影片项目（缺 film.html）：${project}`)
        const doc = timelineOf(args, project)
        const check = validateTimeline(doc)
        if (!check.ok) {
          warn('film_compile: invalid timeline', check.errors.slice(0, 3).join(' / '))
          return { ok: false, errors: check.errors.slice(0, 20), assets: 0 }
        }
        const compiled = compileTimeline(doc)
        if (!compiled.ok) return { ok: false, errors: compiled.errors.slice(0, 20), assets: 0 }
        for (const asset of compiled.assets) {
          await stageAsset(project, asset.rel, asset.source)
        }
        if (compiled.subtitle) {
          const target = join(project, ...compiled.subtitle.rel.split('/'))
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, compiled.subtitle.vtt)
        }
        writeFileSync(join(project, 'film.html'), compiled.html)
        log('film_compile: project compiled', project, compiled.assets.length, 'assets')
        return {
          ok: true,
          project,
          assets: compiled.assets.length,
          ...(compiled.subtitle ? { subtitle: compiled.subtitle.rel } : {}),
          ...(compiled.warnings.length ? { warnings: compiled.warnings.join('；') } : {}),
        }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
    {
      name: 'film_render',
      description: [
        '把当前影片项目渲染成 mp4（本机 Chromium+ffmpeg，几十秒到几分钟）。',
        '先 film_compile 再 render；可用 openfilm look 检查画面。需要服务端渲染时改用 openfilm render 的远端通道（暂未开放）。',
      ].join(''),
      parameters: {
        out: { type: 'string', description: '输出文件名（项目内，缺省与 film.html 同级、同名的 .mp4）' },
        fps: { type: 'number', description: '帧率（缺省 30）' },
        timeout_ms: { type: 'number', description: '渲染超时毫秒（默认 900000）' },
        project: { type: 'string', description: '影片项目目录；缺省用会话工作目录' },
      },
      output: output({ path: { type: 'string' }, output: { type: 'string' }, ms: { type: 'number' } }),
      timeoutMs: 960_000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({ card: 'generic', kind: 'execute', title: '渲染成片', rawInput: { out: String(args?.out || '') } }),
      execute: run(async (args, exec) => {
        const project = projectDirOf(exec, args)
        if (!project) throw new Error('找不到影片项目：请在影片项目目录里调用，或传 project')
        if (!existsSync(join(project, 'film.html'))) throw new Error(`不是影片项目（缺 film.html）：${project}`)
        const runtime = resolveOpenfilmRuntime({ env, bundleDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
        if (!runtime) throw new Error('OpenFilm 运行时未安装：请重装 TinTin 安装包')
        const argv = [runtime.cli, 'render']
        if (args.out) argv.push(String(args.out))
        if (args.fps) argv.push('--fps', String(args.fps))
        const started = Date.now()
        const result = await new Promise((resolveFn, rejectFn) => {
          const child = spawn(runtime.node, argv, { cwd: project, env: studioEnv(runtime, env), windowsHide: true })
          let stdout = ''
          let stderr = ''
          const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, Number(args.timeout_ms) || 900_000)
          child.stdout?.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 200_000) stdout = stdout.slice(-100_000) })
          child.stderr?.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 200_000) stderr = stderr.slice(-100_000) })
          child.on('error', (error) => { clearTimeout(timer); rejectFn(error) })
          child.on('close', (code) => {
            clearTimeout(timer)
            if (code === 0) resolveFn({ stdout, stderr })
            else rejectFn(new Error(`openfilm render 退出码 ${String(code)}：${(stderr || stdout).trim().slice(-600)}`))
          })
        })
        const match = /([^\s"'\\/]+\.mp4)/i.exec(result.stdout) || /([^\s"'\\/]+\.mp4)/i.exec(result.stderr)
        const path = match ? join(project, match[1]) : ''
        log('film_render: rendered', project, Date.now() - started, 'ms')
        return {
          ok: true,
          ...(path && existsSync(path) ? { path } : {}),
          output: (result.stdout || result.stderr).trim().slice(-1200),
          ms: Date.now() - started,
        }
      }, (error) => ({ ok: false, error: errText(error) })),
    },
  ]
}
