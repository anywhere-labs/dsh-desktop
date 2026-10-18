// media-proxy.js — 服务端媒体域原生通道（rembg 图像抠图）
// 对照 SRC desktop/main/media-proxy-ipc.js:22-45 逐字段移植（A8 跟进制：
// 搬运基线 SRC 9ca9050，2026-09-25）。ipcMain 壳剥离，通道表由 index.js
// 注入 multipartPost（宿主读盘组 multipart，浏览器读不了 {path} 本地文件）。
//
// rembg:submit — POST /matting（multipart：file+model，同步回 PNG 二进制），
// 落盘原图同目录 `{原名}_matting.png`（对齐 vsr 自动保存口径），返 {path, bytes}；
// 离线 → null、其余失败 → {error}（IpcError 形态）。
// 契约注记（2026-09-07 服务端实装口径）：旧 /rembg/matting 异步任务模式从未
// 实装；旧实现把 image 裸字符串路径当文本字段发，服务端根本收不到图片。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// 图片扩展名 → multipart Content-Type（FastAPI UploadFile 按扩展名识别，
// 与 index.js 的 VIDEO_MIME/audioMimeOf 同口径）。
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
}

/** 抠图结果落盘路径：原图同目录、剥扩展名 + `_matting.png`（SRC 口径） */
export function mattingOutPath(imagePath) {
  return String(imagePath).replace(/\.[^.\\/]+$/, '') + '_matting.png'
}

export function createRembgApi({ multipartPost, isExpectedOfflineError, log = () => {} }) {
  return {
    'rembg:submit': async (args) => {
      const p = args?.[0] ?? {}
      try {
        if (!p.image || typeof p.image !== 'string') throw new Error('rembg:submit missing `image` 本地路径')
        const ext = (p.image.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase()
        const parts = [{ name: 'file', path: p.image, contentType: IMAGE_MIME[ext] ?? 'application/octet-stream' }]
        if (p.model) parts.push({ name: 'model', value: String(p.model) })
        // 服务端同步抠图可能数十秒（大图/重模型），超时对齐 montage:split 的 600s 上限
        const buf = await multipartPost('/matting', parts, 600000)
        if (!Buffer.isBuffer(buf)) {
          // 服务端错误响应（JSON）会被 multipartPost 解析后原样返回
          const detail = buf && typeof buf === 'object' ? JSON.stringify(buf).slice(0, 200) : String(buf).slice(0, 200)
          throw new Error(detail || '服务端未返回图片数据')
        }
        const outPath = mattingOutPath(p.image)
        writeFileSync(outPath, buf)
        log('rembg', `matting saved: ${outPath} (${buf.length}B)`)
        return { path: outPath, bytes: buf.length }
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
  }
}

// ── 音频生成域（2026-09-25 随音频生成卡移植，SRC server-proxy.js:938-1032 契约）──
// 三通道共同点：渲染层无请求/落盘能力，下载与 multipart 上传收拢到宿主；
// 相对 URL 先拼当前服务端基址（原 /output/ 改写 fixGenUrls 的渲染层等价物是
// useAudioGen.toAbsolute，此处对下载源做同样解析）。离线 → null、其余 → {error}。

/** Content-Type → 扩展名（archiveGen 的判定链；对齐 SRC _ext_from_content_type） */
function extFromContentType(ct, fallback) {
  if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) return '.mp3'
  if (ct.includes('audio/wav') || ct.includes('audio/x-wav')) return '.wav'
  if (ct.includes('audio/ogg')) return '.ogg'
  if (ct.includes('audio/mp4')) return '.m4a'
  if (ct.includes('audio/aac')) return '.aac'
  if (ct.includes('audio/flac')) return '.flac'
  return String(fallback || '.mp3')
}

/** 相对路径 → 绝对 URL（http 原样；相对拼当前服务端基址，对齐 SRC 两 handler 前置段） */
function resolveServerUrl(getServerUrl, url) {
  let u = String(url || '')
  if (!u) throw new Error('requires url')
  if (!/^https?:/i.test(u)) {
    u = String(getServerUrl()).replace(/\/$/, '') + (u.startsWith('/') ? u : '/' + u)
  }
  return u
}

// vsr:remove — 视频去水印字幕（SRC media-proxy-ipc.js vsr:remove 一比一，基线 9ca9050）：
// multipart file+可选八参（inpaint_mode/sub_areas/purpose/watermark_text/mode/
// mask_dilate/mask_expand_y/sttn_max_load_num，sub_areas='' 表示智能识别）；
// 5xx/422 细节透出（对照原客户端「服务端返回 {status}: {text[:300]}」口径）。
// 进度事件不落桥（同族口径）。offline → null、其余失败 → {error}。
export function createVsrApi({ multipartPost, isExpectedOfflineError }) {
  return {
    'vsr:remove': async (args) => {
      const p = (args && args[0]) || {}
      try {
        if (!p.video) throw new Error('vsr:remove missing `video`')
        const parts = []
        // { path } 包装 → multipartPost 按本地路径读文件（字段名必须为 file）
        if (typeof p.video === 'string') parts.push({ name: 'file', path: p.video })
        else if (p.video && p.video.path) parts.push({ name: 'file', path: p.video.path })
        else throw new Error('vsr:remove 的 video 需为本地路径')
        if (p.inpaint_mode) parts.push({ name: 'inpaint_mode', value: String(p.inpaint_mode) })
        if (p.sub_areas !== undefined && p.sub_areas !== null) parts.push({ name: 'sub_areas', value: String(p.sub_areas) })
        if (p.purpose) parts.push({ name: 'purpose', value: String(p.purpose) })
        if (p.watermark_text) parts.push({ name: 'watermark_text', value: String(p.watermark_text) })
        if (p.mode) parts.push({ name: 'mode', value: String(p.mode) })
        if (p.mask_dilate !== undefined) parts.push({ name: 'mask_dilate', value: String(p.mask_dilate) })
        if (p.mask_expand_y !== undefined) parts.push({ name: 'mask_expand_y', value: String(p.mask_expand_y) })
        if (p.sttn_max_load_num !== undefined) parts.push({ name: 'sttn_max_load_num', value: String(p.sttn_max_load_num) })
        try {
          return await multipartPost('/vsr/remove', parts)
        } catch (err) {
          if (err && err.status) {
            const detail = err.response ? JSON.stringify(err.response).slice(0, 300) : ''
            throw new Error(detail ? ('服务端返回 ' + err.status + ': ' + detail) : ('服务端返回 ' + err.status))
          }
          throw err
        }
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: (err && err.message) || String(err) }
      }
    },
  }
}

export function createAudioArchiveApi({ httpRequest, getServerUrl, multipartPost, isExpectedOfflineError, tmpDir }) {
  return {
    // audio:downloadTemp — 下载服务端音频到临时目录（原 GUI 侧 requests.get 落临时
    // 目录后上传入库的收拢版；ext 按 Content-Type 判定 wav/mpeg|mp3，否则 defaultExt
    // ——BGM 默认 .mp3、音效默认 .wav 与原版一致）。
    'audio:downloadTemp': async (args) => {
      const p = args?.[0] ?? {}
      try {
        const u = resolveServerUrl(getServerUrl, p.url)
        const res = await httpRequest('GET', u, { timeout: 60000 })
        const ct = String(res.headers?.['content-type'] || '')
        let ext = String(p.defaultExt || '.mp3')
        if (ct.includes('wav')) ext = '.wav'
        else if (ct.includes('mpeg') || ct.includes('mp3')) ext = '.mp3'
        const dir = join(tmpDir, 'tintin_ai_audio')
        mkdirSync(dir, { recursive: true })
        const dest = join(dir, `${String(p.prefix || 'ai_audio_')}${process.pid}${ext}`)
        writeFileSync(dest, Buffer.from(res.raw || ''))
        return { path: dest, contentType: ct }
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // audio:archiveGen — PR#4 条目14：AI 生成音频归档到客户端本地（下载 url → 按
    // Content-Type 定扩展名 → 落盘 basePath + ext（basePath 不含扩展名，归档目录
    // outputs/ai_audio 由渲染层拼好）；生成即可离线播放/取用，不依赖服务端 URL）。
    'audio:archiveGen': async (args) => {
      const p = args?.[0] ?? {}
      try {
        const u = resolveServerUrl(getServerUrl, p.url)
        const base = String(p.basePath || '')
        if (!base) throw new Error('audio:archiveGen requires basePath')
        const res = await httpRequest('GET', u, { timeout: 60000 })
        const ct = String(res.headers?.['content-type'] || '')
        const raw = Buffer.from(res.raw || '')
        if (!raw.length) throw new Error('服务端返回空内容')
        const dest = base + extFromContentType(ct, p.defaultExt)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, raw)
        return { path: dest }
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // audio:bgmUpload ← POST /audio/bgm/upload，multipart file+style/scene/mood/tags
    // （2026-09-04 服务端契约更新：tag 字段移除——旧「tag=AI生成」写法作废；服务端
    // 固定 category='配乐'，style 承接剪映风格标签语义，候选源 GET /audio/bgm/tags）。
    'audio:bgmUpload': async (args) => {
      const p = args?.[0] ?? {}
      try {
        if (!p.filePath) throw new Error('audio:bgmUpload requires filePath')
        if (!existsSync(p.filePath)) throw new Error(`文件不存在: ${p.filePath}`)
        return await multipartPost('/audio/bgm/upload', [
          { name: 'file', path: String(p.filePath) },
          { name: 'style', value: String(p.style || '') },
          { name: 'tags', value: String(p.tags || '') },
          { name: 'scene', value: String(p.scene || '') },
          { name: 'mood', value: String(p.mood || '') },
        ])
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
  }
}

// tts:uploadSample — multipart POST /voice/samples（file 音频 + name 必填 +
// text 可选）。载荷是渲染层的 {path} 包装，本地读盘在这里完成；离线 → null、
// 其余失败 → {error}（IpcError 形态）。从 index.js 提取（铁律 4 付账）。
export function createTtsUploadSampleApi({ multipartPost, isExpectedOfflineError, audioMimeOf, samplesPath }) {
  return {
    'tts:uploadSample': async (args) => {
      const p = args?.[0] ?? {}
      try {
        const filePath = p.file?.path ?? (typeof p.file === 'string' ? p.file : '')
        if (!filePath) throw new Error('tts:uploadSample requires `file`')
        if (!p.name || !String(p.name).trim()) throw new Error('tts:uploadSample requires `name`')
        return await multipartPost(samplesPath, [
          { name: 'file', path: filePath, contentType: audioMimeOf(filePath) },
          { name: 'name', value: String(p.name).trim() },
          ...(p.text ? [{ name: 'text', value: String(p.text) }] : []),
        ])
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
  }
}
