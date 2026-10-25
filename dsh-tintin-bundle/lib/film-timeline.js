// A 轴（2026-10-21 用户裁决）：大模型只产出结构化时间线 JSON，客户端确定性编译成
// OpenFilm 影片项目（film.html + assets）。禁止模型用 pwsh 逐条操作视频——上一场
// 会话因此产生 1025 次请求、992 次 shell 调用。
//
// 本模块是纯函数层：校验 + 编译（不碰磁盘、不发请求）。落盘与素材获取在 film-tools.js。
//
// 时间线文档（v1）：
//   {
//     version: 1,
//     resolution: "1920x1080",
//     fps: 30,                                  // 仅校验；Studio 项目设置里的帧率准
//     tracks: [
//       { kind: "video", clips: [{ asset, at, in?, out?, speed? }] },
//       { kind: "voice" | "music" | "sfx", clips: [{ asset, at, in?, out?, volume? }] },
//       { kind: "subtitle", cues: [{ at, to, text }] }
//     ]
//   }
// asset 三种形态：material:<id>（服务端素材库）、http(s) URL、本地路径（相对项目或绝对）。

export const TIMELINE_VERSION = 1
export const TRACK_KINDS = Object.freeze(['video', 'page', 'voice', 'music', 'sfx', 'subtitle'])
const AUDIO_KINDS = new Set(['voice', 'music', 'sfx'])
const MAX_CLIPS = 500
const MAX_CUES = 2000
const MAX_TEXT = 2000

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const round3 = (value) => Math.round(Number(value) * 1000) / 1000
const fixed3 = (value) => round3(value).toFixed(3)

/** 素材引用 → 来源描述：material id / 远程 URL / 本地路径。 */
export function assetSourceOf(asset) {
  const text = String(asset ?? '').trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return { kind: 'url', value: text }
  if (/^material:/i.test(text)) {
    const id = text.slice('material:'.length).trim()
    return id ? { kind: 'material', value: id } : null
  }
  return { kind: 'local', value: text }
}

/** 引用里的扩展名（去掉 query/hash），缺省按轨道类型给 .mp4/.wav。 */
function extensionOf(asset, fallback) {
  const clean = String(asset ?? '').split(/[?#]/)[0]
  const match = /\.[a-z0-9]{1,5}$/i.exec(clean)
  return match ? match[0].toLowerCase() : fallback
}

/**
 * 校验时间线文档。返回 `{ ok, errors }`：errors 是可以直接回给模型的短句，
 * 模型据此改 JSON（1–2 轮内收敛，而不是靠 992 次工具输出试错）。
 */
export function validateTimeline(doc) {
  const errors = []
  if (!isPlainObject(doc)) return { ok: false, errors: ['时间线必须是 JSON 对象'] }
  const version = doc.version === undefined ? TIMELINE_VERSION : doc.version
  if (version !== TIMELINE_VERSION) errors.push(`version 必须是 ${TIMELINE_VERSION}`)
  if (doc.resolution !== undefined && !/^\d{2,5}x\d{2,5}$/.test(String(doc.resolution))) errors.push('resolution 形如 "1920x1080"')
  if (doc.fps !== undefined && !(isFiniteNumber(doc.fps) && doc.fps > 0 && doc.fps <= 240)) errors.push('fps 必须是 0–240 的数字')
  if (!Array.isArray(doc.tracks) || doc.tracks.length === 0) {
    errors.push('tracks 不能为空')
    return { ok: false, errors }
  }
  let clips = 0
  let cues = 0
  for (const [trackIndex, track] of doc.tracks.entries()) {
    const where = `tracks[${trackIndex}]`
    if (!isPlainObject(track)) { errors.push(`${where} 必须是对象`); continue }
    if (!TRACK_KINDS.includes(track.kind)) { errors.push(`${where}.kind 必须是 ${TRACK_KINDS.join('/')}`); continue }
    if (track.kind === 'subtitle') {
      if (!Array.isArray(track.cues)) { errors.push(`${where}.cues 必须是数组`); continue }
      for (const [cueIndex, cue] of track.cues.entries()) {
        cues += 1
        const at = `${where}.cues[${cueIndex}]`
        if (!isPlainObject(cue)) { errors.push(`${at} 必须是对象`); continue }
        if (!isFiniteNumber(cue.at) || cue.at < 0) errors.push(`${at}.at 必须 ≥ 0`)
        if (!isFiniteNumber(cue.to) || cue.to <= (cue.at ?? 0)) errors.push(`${at}.to 必须大于 at`)
        if (typeof cue.text !== 'string' || !cue.text.trim()) errors.push(`${at}.text 必填`)
        else if (cue.text.length > MAX_TEXT) errors.push(`${at}.text 超过 ${MAX_TEXT} 字`)
      }
      continue
    }
    if (!Array.isArray(track.clips) || track.clips.length === 0) { errors.push(`${where}.clips 不能为空`); continue }
    for (const [clipIndex, clip] of track.clips.entries()) {
      clips += 1
      const at = `${where}.clips[${clipIndex}]`
      if (!isPlainObject(clip)) { errors.push(`${at} 必须是对象`); continue }
      if (!assetSourceOf(clip.asset)) errors.push(`${at}.asset 必填（material:<id> / URL / 本地路径）`)
      if (!isFiniteNumber(clip.at) || clip.at < 0) errors.push(`${at}.at 必须 ≥ 0`)
      if (clip.in !== undefined && !(isFiniteNumber(clip.in) && clip.in >= 0)) errors.push(`${at}.in 必须 ≥ 0`)
      if (clip.out !== undefined && !(isFiniteNumber(clip.out) && clip.out > (clip.in ?? 0))) errors.push(`${at}.out 必须大于 in`)
      if (clip.speed !== undefined && !(isFiniteNumber(clip.speed) && clip.speed > 0 && clip.speed <= 8)) errors.push(`${at}.speed 必须在 0–8`)
      if (clip.volume !== undefined && !(isFiniteNumber(clip.volume) && clip.volume >= 0 && clip.volume <= 2)) errors.push(`${at}.volume 必须在 0–2`)
      if (track.kind === 'page') {
        // 页面片段：编导自己写的 window.film 页面（设计自由在这里），时间线只负责编排
        if (!/\.html?$/i.test(String(clip.asset ?? ''))) errors.push(`${at}.asset 必须是项目内的 .html 页面`)
        if (clip.duration !== undefined && !(isFiniteNumber(clip.duration) && clip.duration > 0)) errors.push(`${at}.duration 必须 > 0`)
      }
    }
  }
  if (clips > MAX_CLIPS) errors.push(`片段总数超过 ${MAX_CLIPS}`)
  if (cues > MAX_CUES) errors.push(`字幕条数超过 ${MAX_CUES}`)
  return { ok: errors.length === 0, errors }
}

/** 秒 → WebVTT 时间码。 */
export function vttStamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

/**
 * 编译时间线 → `{ html, assets, subtitle, warnings }`。
 * - `assets`：按出现顺序去重的素材清单 `{ rel, source }`，落盘由 film-tools 负责
 * - `subtitle`：`{ rel, vtt }`，挂在首个音频片段（无音频则首个视频片段）旁边——
 *   OpenFilm 用「同名 .vtt」显示字幕
 * - 同名素材（同一本地路径/URL）只落一份，多个片段共用同一 `rel`
 */
export function compileTimeline(doc) {
  const check = validateTimeline(doc)
  if (!check.ok) return { ok: false, errors: check.errors, html: '', assets: [], subtitle: null, warnings: [] }
  const warnings = []
  const assets = []
  const relOf = new Map()
  const resolution = String(doc.resolution || '1920x1080')
  const [width, height] = resolution.split('x')
  const sections = []
  let videoSeq = 0
  let audioSeq = 0
  let firstAudioRel = ''
  let firstVideoRel = ''
  const cues = []

  const relFor = (asset, trackKind) => {
    const key = `${asset}`
    if (relOf.has(key)) return relOf.get(key)
    // 页面片段不落盘：页面本来就在项目里，时间线只引用它（保留设计自由度）
    if (trackKind === 'page') {
      const rel = String(asset).replace(/\\/g, '/').replace(/^\.\//, '')
      if (rel.split('/').includes('..')) return ''
      relOf.set(key, rel)
      return rel
    }
    const source = assetSourceOf(asset)
    if (!source) return ''
    const isVideo = trackKind === 'video'
    const fallback = isVideo ? '.mp4' : '.wav'
    const seq = isVideo ? (videoSeq += 1) : (audioSeq += 1)
    const rel = `assets/${isVideo ? 'clip' : 'audio'}-${seq}${extensionOf(asset, fallback)}`
    relOf.set(key, rel)
    assets.push({ rel, source })
    return rel
  }

  for (const track of doc.tracks) {
    if (track.kind === 'subtitle') {
      cues.push(...track.cues.map((cue) => ({ at: Number(cue.at), to: Number(cue.to), text: String(cue.text).trim() })))
      continue
    }
    const lines = []
    for (const clip of track.clips) {
      const rel = relFor(clip.asset, track.kind)
      if (!rel) continue
      if (track.kind === 'video') {
        if (!firstVideoRel) firstVideoRel = rel
        const hasRange = isFiniteNumber(clip.in) || isFiniteNumber(clip.out)
        const range = hasRange ? `#t=${fixed3(clip.in ?? 0)},${fixed3(clip.out ?? (clip.in ?? 0) + 5)}` : ''
        const attrs = [`src="${rel}${range}"`, `at="${fixed3(clip.at)}"`]
        if (clip.speed !== undefined) attrs.push(`speed="${round3(clip.speed)}"`)
        lines.push(`  <video ${attrs.join(' ')}></video>`)
      } else if (track.kind === 'page') {
        // 页面片段（film 格式的 <iframe>）：页面自己画，时间线给时间和时长
        const attrs = [`src="${rel}"`, `at="${fixed3(clip.at)}"`]
        if (clip.duration !== undefined) attrs.push(`duration="${fixed3(clip.duration)}"`)
        lines.push(`  <iframe ${attrs.join(' ')}></iframe>`)
      } else {
        if (!firstAudioRel) firstAudioRel = rel
        const attrs = [`src="${rel}"`, `at="${fixed3(clip.at)}"`]
        if (clip.in !== undefined) attrs.push(`in="${fixed3(clip.in)}"`)
        if (clip.out !== undefined) attrs.push(`out="${fixed3(clip.out)}"`)
        if (clip.volume !== undefined) attrs.push(`volume="${round3(clip.volume)}"`)
        lines.push(`  <audio ${attrs.join(' ')}></audio>`)
      }
    }
    if (lines.length) sections.push(`<section>\n${lines.join('\n')}\n</section>`)
  }

  let subtitle = null
  if (cues.length) {
    cues.sort((a, b) => a.at - b.at)
    const vtt = `WEBVTT\n\n${cues.map((cue) => `${vttStamp(cue.at)} --> ${vttStamp(cue.to)}\n${cue.text}`).join('\n\n')}\n`
    const attachTo = firstAudioRel || firstVideoRel
    if (attachTo) subtitle = { rel: `${attachTo}.vtt`, vtt }
    else warnings.push('时间线里有字幕但没有音频/视频片段，字幕被丢弃')
  }
  if (!sections.length) warnings.push('时间线没有可播放的片段')

  const html = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=${width}, height=${height}">`,
    '</head><body>',
    sections.join('\n'),
    '</body></html>',
    '',
  ].join('\n')
  return { ok: true, errors: [], html, assets, subtitle, warnings }
}
