// TinTin host channel table: the <namespace>:<method> handlers the
// window.tintin polyfill dispatches to. Kept apart from index.js so the host
// entry stays inside its locked line baseline (iron rule 4); the factory takes
// the host bridge seam it used to close over.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path'
import { installSkillPackage } from './skills-install.js'
import { mergeConfigDocs, mergeTintinConfigStore, readTintinConfigStore, stripEmptyObjectLeaves } from './tintin-config-store.js'
import { API_ENDPOINTS } from './server-proxy.js'
import { createFfmpegGateApi } from './montage/ffmpeg-gate.js'
import { createMontageVoiceApi } from './montage/voice-ipc.js'
import { createMontageFinalApi } from './montage/final-ipc.js'
import { preprocessTtsKeepingPause } from './montage/voice-tts-logic.js'
import { createRembgApi, createAudioArchiveApi, createVsrApi, createTtsUploadSampleApi } from './media-proxy.js'
import { createContextTaskApi, defaultWorkspaceDir } from './context-task.js'
import { createYtdlpApi } from './ytdlp.js'
import { createOpenfilmChannels } from './openfilm/plugin.js'

/**
 * Build the native channel table.
 * @param {object} deps - Host bridge seam captured from apply().
 * @returns {Record<string, (args: unknown[]) => unknown>}
 */
export function createChannelTable(deps) {
  const {
    ctx, config, httpRequest, getServerUrl, getMachineId, getBinDir, resolveBinary,
    resolveCacheDir, ytdlpBin, multipartPost, audioMimeOf, isExpectedOfflineError,
    montageDeps, syncOpenfilmAssets, mediaUnlocked, MEDIA_UNLOCK_CAP, VIDEO_MIME,
  } = deps
  void defaultWorkspaceDir

  const nativeChannels = {
    ...createFfmpegGateApi({ ffmpegPath: resolveBinary('ffmpeg'), ffprobePath: resolveBinary('ffprobe') }),
    ...createMontageVoiceApi(montageDeps),
    ...createMontageFinalApi(montageDeps),
    // rembg:submit — 图像抠图（SRC media-proxy-ipc.js 逐字段移植，见 lib/media-proxy.js）：
    // multipart POST /matting 同步回 PNG 二进制，宿主落盘原图同目录返 {path, bytes}。
    ...createRembgApi({
      multipartPost,
      isExpectedOfflineError,
      log: (tag, msg) => ctx.logger.info('tintin-bundle: %s %s', tag, msg),
    }),
    // audio:downloadTemp / audio:archiveGen / audio:bgmUpload — 音频生成域
    // （2026-09-25 随音频生成卡移植，SRC server-proxy.js:938-1032 契约，见 lib/media-proxy.js）
    // vsr:remove — 去水印字幕（去水印字幕卡链路）
    ...createVsrApi({ multipartPost, isExpectedOfflineError }),
    ...createAudioArchiveApi({
      httpRequest,
      getServerUrl,
      multipartPost,
      isExpectedOfflineError,
      tmpDir: tmpdir(),
    }),
    // ytdlp:status/probe/download/saveAs — 参考视频下载门（SRC ytdlp-gate.js 移植，
    // 见 lib/ytdlp.js）。cookies 从壳层交接目录读（<DSH_HOME>/tintin/browser/cookies），
    // 进度事件不落桥（阻塞到终态）。ffmpeg/ffprobe 经 resolveBinary 注入（归一化）。
    ...createYtdlpApi({
      ytdlpPath: ytdlpBin,
      ffmpegPath: resolveBinary('ffmpeg'),
      ffprobePath: resolveBinary('ffprobe'),
      ffmpegDir: getBinDir() || '',
      cookiesDir: () => join(process.env.DSH_HOME || '', 'tintin', 'browser', 'cookies'),
      cacheDir: resolveCacheDir,
      log: (...a) => ctx.logger.info('tintin-bundle:', ...a),
      warn: (...a) => ctx.logger.warn('tintin-bundle:', ...a),
    }),
    // context:writeTask — 会话上下文条 → 工作区 task.json（WP-5b，2026-09-25
    // 用户裁决：不改 dsh 底层，业务上下文经 UI 层注入）。工厂见 lib/context-task.js
    // （可测：test/tintin-context-task.test.ts）；工作区目录与 /tintin/media
    // 白名单根同源同值。
    ...createContextTaskApi({
      resolveWorkspaceDir: defaultWorkspaceDir,
      log: (...a) => ctx.logger.info('tintin-bundle:', ...a),
      warn: (...a) => ctx.logger.warn('tintin-bundle:', ...a),
    }),
    ...createOpenfilmChannels({ sync: syncOpenfilmAssets }),
    ...createTtsUploadSampleApi({ multipartPost, isExpectedOfflineError, audioMimeOf, samplesPath: API_ENDPOINTS.tts.voicesSamples }),
    // asr:transcribe — POST /whisper/transcribe（multipart: file 必填 +
    // language/fmt；契约无 {url} JSON 分支——url 时先 GET 取回字节再上传，
    // SRC 2026-09-06 422 修复口径）。p.format 兼容映射 fmt。
    'asr:transcribe': async (args) => {
      const p = args?.[0] ?? {}
      try {
        if (!p.audio && !p.url) throw new Error('asr:transcribe missing `audio` Blob 或 `url` 字段（二选一）')
        const fields = []
        if (p.language) fields.push({ name: 'language', value: String(p.language) })
        const fmt = p.fmt || p.format
        if (fmt) fields.push({ name: 'fmt', value: String(fmt) })
        if (p.word_timestamps !== undefined) fields.push({ name: 'word_timestamps', value: String(Boolean(p.word_timestamps)) })
        let filePart
        if (p.audio) {
          const filePath = p.audio.path ?? (typeof p.audio === 'string' ? p.audio : '')
          if (!filePath) throw new Error('asr:transcribe 的 audio 缺少本地路径')
          filePart = { name: 'file', path: filePath, contentType: audioMimeOf(filePath) }
        } else {
          const res = await httpRequest('GET', String(p.url), { timeout: 60000 })
          const buf = res.raw ?? (Buffer.isBuffer(res.data) ? res.data : null)
          if (!buf || !buf.length) throw new Error('样本音频下载失败：响应非音频数据')
          const ct = String(res.headers?.['content-type'] ?? '').split(';')[0].trim()
          const ext = extname(String(p.url).split('?')[0]) || (ct.includes('mpeg') ? '.mp3' : '.wav')
          filePart = { name: 'file', buffer: buf, filename: `sample${ext.toLowerCase()}`, contentType: ct || audioMimeOf(ext) }
        }
        return await multipartPost(API_ENDPOINTS.asr.transcribe, [...fields, filePart])
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // env:serverPing — 服务端连通探测+地址回显（SRC env-ipc.js pingServer 契约 {online,url,status?,latencyMs?}，永不 reject）；渲染层经它拿媒体直连基址。
    'env:serverPing': async () => {
      const url = getServerUrl()
      const started = Date.now()
      try {
        const res = await httpRequest('GET', '/', { timeout: 3000 })
        return { online: true, url, status: res.status, latencyMs: Date.now() - started }
      } catch (err) {
        return { online: false, url }
      }
    },
    // env:getMachineId — 机器码（SRC env-ipc.js env:getMachineId 契约：
    // {ok,machineId}，异常 {ok:false,machineId:'',error}）。产品资料域以它拼
    // /api/product-library/clients/<machine_id> 请求路径——与 httpRequest 注入的
    // X-Machine-ID 头同源同值（index.js 顶部同一个 getMachineId 闭包）。
    'env:getMachineId': () => {
      try {
        return { ok: true, machineId: String(getMachineId() || '') }
      } catch (err) {
        return { ok: false, machineId: '', error: err instanceof Error ? err.message : String(err) }
      }
    },
    // env:downloadsDir — 系统下载文件夹路径。args[0] 给文件名时返回去重后的完整
    // 目标路径（已存在则追加 (n)，浏览器下载同名口径）；缺省返回目录本身。
    // 纯 node USERPROFILE 拼接（宿主子进程无 electron，dialog/showSaveDialog 类
    // 通道在此上下文拿不到——2026-10-12 实障）。供「下载直落下载文件夹」类按钮。
    'env:downloadsDir': (args) => {
      try {
        const dir = join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads')
        const name = String(args?.[0] ?? '').replace(/[\\/]/g, '')
        if (!name) {
          mkdirSync(dir, { recursive: true })
          return { dir }
        }
        const ext = extname(name)
        const stem = name.slice(0, name.length - ext.length)
        let candidate = join(dir, name)
        for (let n = 1; existsSync(candidate); n++) candidate = join(dir, `${stem}(${n})${ext}`)
        return { path: candidate }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // env:cacheDir — 缓存目录解析（2026-09-24 用户裁决：恢复原客户端「更改」能力）。
    // 优先级：设置 local.cacheDir（通用设置·本地配置卡「更改」写入）> 默认本机
    // 工作区目录 Documents/tintin-workspace；由宿主保证目录存在。
    'env:cacheDir': () => {
      const dir = resolveCacheDir()
      try { mkdirSync(dir, { recursive: true }) } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
      return { dir }
    },
    // config:store — TinTin 自有配置存储读写（2026-09-28）。0.1.7 的设置服务拒写 overlay 插入的宿主条目
    // （"overridden by a home patch"），设置卡/首启向导持久化一律走这里（<DSH_HOME>/tintin/config.json）；桥接解析链
    // 第二档即时读到。get 返回合并视图（自有存储 ∪ profile config，后者优先）——与 server-proxy 解析链同序。
    'config:get': () => ({
      value: mergeConfigDocs(readTintinConfigStore(process.env.DSH_HOME) ?? {}, stripEmptyObjectLeaves(config) ?? {}),
    }),
    'config:merge': (args) => {
      const patch = args?.[0]
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'config:store:merge requires an object patch' }
      try {
        return { value: mergeTintinConfigStore(process.env.DSH_HOME, patch) }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // shell:openItem — 系统默认方式打开文件/目录（SRC main.js shell.openPath；harness 子进程无 electron shell，
    // 按平台落 start/open/xdg-open）。Windows 用 `cmd /c start "" <path>`（首个带引号参数是窗口标题须空占位——
    // explorer <path> 部分场景静默无效）。每次调用落 harness.log（2026-09-24 用户报障点击无反应）。
    'shell:openItem': (args) => {
      const p = String(args?.[0] ?? '')
      if (!p) return { error: 'shell:openItem requires path' }
      try {
        if (!existsSync(p)) {
          ctx.logger.warn('shell:openItem: 路径不存在 %s', p)
          return { error: `路径不存在: ${p}` }
        }
        ctx.logger.info('shell:openItem -> %s', p)
        if (process.platform === 'win32') {
          const child = spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore' })
          child.on('error', (e) => ctx.logger.warn('shell:openItem spawn error: %s', e.message))
          child.unref()
        } else if (process.platform === 'darwin') {
          spawn('open', [p], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref()
        }
        return { ok: true }
      } catch (err) {
        ctx.logger.warn('shell:openItem failed: %s', err instanceof Error ? err.message : String(err))
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // shell:revealInFolder — 在系统文件管理器中定位文件（SRC main.js:
    // shell.showItemInFolder）。Windows `explorer /select,"<path>"`、macOS
    // `open -R`；Linux 无选中语义退化为打开所在目录。每次调用落 harness.log。
    'shell:revealInFolder': (args) => {
      const raw = String(args?.[0] ?? '')
      if (!raw) return { error: 'shell:revealInFolder requires path' }
      // explorer /select 只认反斜杠路径：正斜杠（渲染层拼 savePath 的产物）会
      // 静默回退到资源管理器默认视图，不定位到目标（2026-10-09 实障）
      const p = normalize(raw)
      try {
        if (!existsSync(p)) {
          ctx.logger.warn('shell:revealInFolder: 路径不存在 %s', p)
          return { error: `路径不存在: ${p}` }
        }
        ctx.logger.info('shell:revealInFolder -> %s', p)
        if (process.platform === 'win32') {
          const child = spawn('explorer.exe', [`/select,${p}`], { detached: true, stdio: 'ignore' })
          child.on('error', (e) => ctx.logger.warn('shell:revealInFolder spawn error: %s', e.message))
          child.unref()
        } else if (process.platform === 'darwin') {
          spawn('open', ['-R', p], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn('xdg-open', [dirname(p)], { detached: true, stdio: 'ignore' }).unref()
        }
        return { ok: true }
      } catch (err) {
        ctx.logger.warn('shell:revealInFolder failed: %s', err instanceof Error ? err.message : String(err))
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // 注意：本 bundle 运行于 Harness 子进程（纯 node），require('electron') 拿到
    // 的是二进制路径字符串而非 API——dialog/showSaveDialog 类原生能力在此上下文
    // 不可用（2026-10-12 两次实障：裸 require ReferenceError / 解构 undefined）。
    // 原生保存对话框由桌面壳 preload 桥 dshDesktopSaveFilePicker 承担（见
    // dsh-plugin-desktop-tintin/src/preload.ts）；「下载直落下载文件夹」场景走
    // env:downloadsDir + tts:saveAudio（fromPath 复制）。
    // env:clearCache — 清空固定缓存目录内容（保留目录本身）。被占用的条目
    // force 删除失败即跳过。
    'env:clearCache': () => {
      const home = process.env.DSH_HOME
      if (!home) return { error: 'DSH_HOME 未设置' }
      const dir = join(home, 'tintin', 'cache')
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // media:unlock — 见上方 mediaUnlocked 注记。契约：绝对路径、必须存在的
    // 单个文件；成功 {ok:true}、失败 {error}（永不 reject，fire-and-forget 调用点）。
    'media:unlock': (args) => {
      const p = String(args?.[0] ?? '')
      if (!p || !isAbsolute(p)) return { error: 'media:unlock requires absolute path' }
      try {
        if (!existsSync(p) || !statSync(p).isFile()) return { error: `路径不存在或不是文件: ${p}` }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
      if (!mediaUnlocked.has(p)) {
        if (mediaUnlocked.size >= MEDIA_UNLOCK_CAP) {
          const oldest = mediaUnlocked.values().next().value
          if (oldest !== undefined) mediaUnlocked.delete(oldest)
        }
        mediaUnlocked.add(p)
      }
      return { ok: true }
    },
    // dialog:collectVideos — 递归收集目录内视频文件（SRC main.js:808 逐字移植，
    // 2026-09-24 用户报障：拖入文件夹只进文件夹本身——polyfill 的 collectVideos
    // 此前是恒 [] 的占位，渲染层回退把目录路径当素材推入）。契约：{root, exts,
    // limit} → 绝对路径数组；跳过隐藏/系统/混剪派生目录；自然序排序。
    'dialog:collectVideos': (args) => {
      const params = args?.[0] ?? {}
      const root = params?.root || ''
      if (!root || !existsSync(root) || !statSync(root).isDirectory()) return []
      const exts = new Set(
        (params?.exts || ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm', '.m4v'])
          .map((e) => (e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase()))
      )
      const limit = Math.min(Number(params?.limit) || 500, 5000)
      const derivedDirs = new Set(params?.skipDirs || [
        'splits', 'output', 'outputs', 'final', 'dubbed', 'bgm', 'temp', 'montage_cache',
      ])
      const found = []
      const walk = (dir) => {
        if (found.length >= limit) return
        let entries
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
        for (const ent of entries) {
          if (found.length >= limit) return
          const full = join(dir, ent.name)
          if (ent.isDirectory()) {
            // 跳过隐藏/系统目录与混剪派生目录
            if (ent.name.startsWith('.') || ent.name.startsWith('$')) continue
            if (derivedDirs.has(ent.name.toLowerCase())) continue
            walk(full)
          } else if (ent.isFile()) {
            const ext = extname(ent.name).toLowerCase()
            if (exts.has(ext)) found.push(full)
          }
        }
      }
      walk(root)
      found.sort((a, b) => {
        const natKey = (p) => {
          const base = basename(p).toLowerCase()
          const parts = base.split(/(\d+)/)
          return [dirname(p).toLowerCase(), ...parts.map((s, i) => (i % 2 ? String(Number(s)).padStart(10, '0') : s))]
        }
        const ka = natKey(a)
        const kb = natKey(b)
        const len = Math.max(ka.length, kb.length)
        for (let i = 0; i < len; i++) {
          const cmp = String(ka[i] || '').localeCompare(String(kb[i] || ''), undefined, { numeric: true })
          if (cmp !== 0) return cmp
        }
        return 0
      })
      return found.slice(0, limit)
    },
    // montage:split — 智能镜头分割上传（SRC server-proxy.js:845 逐字段移植）。
    // skills:install — 客户端技能包安装（2026-10-16 用户裁决：安装升级=芯片注册+真技能包落盘一体）
    'skills:install': async (args) => {
      const id = String(args?.[0] ?? '').trim()
      if (!id) return { error: 'skills:install: requires skill id' }
      return installSkillPackage(id, getServerUrl(), process.env.DSH_HOME || '')
    },
    // montage:split — 2026-09-24 报障「422 Expected UploadFile received str」：渲染层把 {path} 包装对象塞进 multipart 的 file 字段而服务端要真实文件流——宿主读盘组装（file 必填，material_id/clip_url 二选一兼容）。
    'montage:split': async (args) => {
      const p = args?.[0] ?? {}
      try {
        const hasFile = !!p.file
        const hasMat = !!p.material_id
        const hasUrl = !!p.clip_url
        if ((hasFile ? 1 : 0) + (hasMat ? 1 : 0) + (hasUrl ? 1 : 0) !== 1) {
          throw new Error('montage:split 需要且仅需要一个来源：file / material_id / clip_url 三选一')
        }
        const parts = []
        if (p.file !== undefined) {
          const fp = p.file?.path ?? (typeof p.file === 'string' ? p.file : '')
          if (!fp) throw new Error('montage:split 的 file 缺少本地路径')
          parts.push({ name: 'file', path: fp, contentType: VIDEO_MIME[extname(fp).toLowerCase()] || 'video/mp4' })
        }
        if (p.material_id !== undefined) parts.push({ name: 'material_id', value: String(p.material_id) })
        if (p.clip_url !== undefined) parts.push({ name: 'clip_url', value: String(p.clip_url) })
        if (p.threshold !== undefined) parts.push({ name: 'threshold', value: String(p.threshold) })
        if (p.min_scene_len !== undefined) parts.push({ name: 'min_scene_len', value: String(p.min_scene_len) })
        if (p.dedup !== undefined) parts.push({ name: 'dedup', value: String(Boolean(p.dedup)) })
        if (p.dedup_threshold !== undefined) parts.push({ name: 'dedup_threshold', value: String(p.dedup_threshold) })
        if (p.product_mode !== undefined) parts.push({ name: 'product_mode', value: String(Boolean(p.product_mode)) })
        if (p.analyze !== undefined) parts.push({ name: 'analyze', value: String(Boolean(p.analyze)) })
        if (p.image_duration !== undefined) parts.push({ name: 'image_duration', value: String(p.image_duration) })
        // 分割含逐帧分析，耗时长；超时对齐 SRC multipartUpload 宽松口径
        return await multipartPost(API_ENDPOINTS.montage.split, parts, 600000)
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // ── liveclip 本地文件 I/O 域（SRC liveclip-ipc.js 整体移植：渲染层策略 +
    //  宿主无决策文件操作。导出字幕 SRT 定位/写入、资产存在性探测、选择池判重
    //  hash 都走这里——2026-09-24 用户报障导出被阻断的根因即 fileExists 未落地）──
    'liveclip:fileExists': (args) => {
      const p = String(args?.[0]?.path || '')
      if (!p) return { error: '缺少 path' }
      try {
        return { ok: true, exists: existsSync(p) && statSync(p).size > 0 }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    'liveclip:writeTextFile': (args) => {
      const p = args?.[0] ?? {}
      try {
        const ext = extname(String(p.path || '')).toLowerCase()
        if (!['.srt', '.txt'].includes(ext)) return { error: '仅支持 .srt/.txt 字幕文件' }
        const content = typeof p.content === 'string' ? p.content : ''
        if (!content) return { error: '缺少字幕内容' }
        mkdirSync(dirname(p.path), { recursive: true })
        writeFileSync(p.path, content, 'utf8')
        return { ok: true, path: p.path }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    'liveclip:hashFile': (args) => {
      const p = String(args?.[0]?.path || '')
      if (!p) return { error: '缺少 path' }
      if (!existsSync(p)) return { error: '文件不存在' }
      try {
        const hash = createHash('md5')
        hash.update(readFileSync(p))
        return { ok: true, path: p, hash: hash.digest('hex') }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    'liveclip:writeTempText': (args) => {
      const p = args?.[0] ?? {}
      try {
        const base = basename(String(p.basename || ''))
        if (!base || base === '.' || base === '..' || /[\\/]/.test(base)) return { error: '非法文件名' }
        if (!base.toLowerCase().endsWith('.srt')) return { error: '临时字幕仅支持 .srt' }
        const content = typeof p.content === 'string' ? p.content : ''
        if (!content) return { error: '缺少字幕内容' }
        const filePath = join(tmpdir(), base)
        writeFileSync(filePath, content, 'utf8')
        return { path: filePath }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    'liveclip:writeImageFile': (args) => {
      const p = args?.[0] ?? {}
      try {
        const ext = extname(String(p.path || '')).toLowerCase()
        if (!['.jpg', '.jpeg', '.png'].includes(ext)) return { error: '仅支持 .jpg/.jpeg/.png 封面文件' }
        const buf = Buffer.from(String(p.base64 || '').replace(/^data:[^,]*,/, ''), 'base64')
        if (!buf.length) return { error: '缺少图片数据' }
        mkdirSync(dirname(p.path), { recursive: true })
        writeFileSync(p.path, buf)
        return { ok: true, path: p.path }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    // ── tts / audio 域补链（2026-09-24 声音克隆移植）────────────────────────
    // tts:generate — POST /indextts/tts（SRC media-proxy-ipc.js:151 契约：text 必填
    // + sample_id/prompt_audio/engine/ref_text/lang/duration_factor/emo_text/emo_alpha/resp；
    // 任务队列排队 + 推理耗时长，超时 300s）。调用方（声音克隆）固定 resp:'json' →
    // 响应为 JSON；二进制 WAV 模式会撑爆 JSON 桥，显式拒绝并提示。
    'tts:generate': async (args) => {
      const p = args?.[0] ?? {}
      try {
        if (!p.text) throw new Error('tts:generate missing `text`')
        // 2026-09-28 用户架构约束：所有声音克隆文案强制过归一化（读音标注/数字转
        // 中文/大写拆分），与口播配音 postTts 同一口径——此前 text 原样透传，
        // "Blue VO!CE" 被逐字母读。
        const text = preprocessTtsKeepingPause(String(p.text))
        const body = {
          text,
          ...(p.sample_id ? { sample_id: p.sample_id } : {}),
          ...(p.prompt_audio ? { prompt_audio: p.prompt_audio } : {}),
          ...(p.engine ? { engine: String(p.engine) } : {}),
          ...(p.ref_text ? { ref_text: String(p.ref_text) } : {}),
          ...(p.lang ? { lang: p.lang } : {}),
          ...(p.duration_factor !== undefined ? { duration_factor: p.duration_factor } : {}),
          ...(p.emo_text ? { emo_text: p.emo_text } : {}),
          ...(p.emo_alpha !== undefined ? { emo_alpha: p.emo_alpha } : {}),
          ...(p.resp ? { resp: p.resp } : {}),
        }
        const res = await httpRequest('POST', API_ENDPOINTS.tts.indextts, { body, timeout: 300000 })
        if (Buffer.isBuffer(res.data)) return { error: '二进制 WAV 响应不支持：请使用 resp=json 模式' }
        return res.data
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // tts:saveAudio — base64 音频落盘 / fromPath 复制（SRC media-proxy-ipc.js:233；
    // 相对路径解析基准由 userData 改为 $DSH_HOME——harness 子进程无 electron app）
    'tts:saveAudio': (args) => {
      const { base64, savePath, fromPath } = args?.[0] ?? {}
      try {
        if (!savePath || (!base64 && !fromPath)) throw new Error('tts:saveAudio requires `savePath` and `base64`/`fromPath`')
        const home = process.env.DSH_HOME
        const resolveRooted = (p) => {
          const s = String(p || '')
          return isAbsolute(s) ? s : join(home || '', s)
        }
        const target = resolveRooted(savePath)
        const dir = dirname(target)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        if (fromPath) copyFileSync(resolveRooted(fromPath), target)
        else writeFileSync(target, Buffer.from(String(base64), 'base64'))
        return target
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    // audio:libraryUpload — multipart file+category+tags（SRC server-proxy.js:955）
    'audio:libraryUpload': async (args) => {
      const p = args?.[0] ?? {}
      try {
        if (!p.filePath) throw new Error('audio:libraryUpload requires filePath')
        if (!existsSync(p.filePath)) throw new Error(`文件不存在: ${p.filePath}`)
        return await multipartPost(API_ENDPOINTS.audio.libraryUpload, [
          { name: 'file', path: p.filePath, contentType: audioMimeOf(p.filePath) },
          { name: 'category', value: String(p.category || '') },
          { name: 'tags', value: String(p.tags || '') },
        ])
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // server:downloadResult — 服务端文件下载落盘（SRC server-proxy.js:545；超时 600s
    // 对齐原版长任务产物）。位置参数 [path, savePath]（preload downloadResult 契约）。
    'server:downloadResult': async (args) => {
      const [path, savePath] = args ?? []
      try {
        const res = await httpRequest('GET', String(path || ''), { timeout: 600000 })
        const dir = dirname(String(savePath))
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        writeFileSync(String(savePath), res.raw)
        return savePath
      } catch (err) {
        return isExpectedOfflineError(err) ? null : { error: err?.message ?? String(err) }
      }
    },
    // env:log — renderer business log relay (C-6 closure, 2026-09-23).
    // Source chain: clientError → env:log → logger.logError → main.log 落盘
    // + hooks auto-POST /api/logs/upload. Here: ctx.logger lands harness.log
    // via log-bridge; error level additionally reports to the service merge
    // endpoint (silent failure — logging must never block business, 铁律 7).
    'env:log': (args) => {
      const e = args?.[0]
      const level = e?.level === 'error' ? 'error' : (e?.level === 'warn' ? 'warn' : 'info')
      const tag = String(e?.tag ?? 'renderer').slice(0, 120)
      const text = String(e?.message ?? '').slice(0, 500)
      ctx.logger[level](`[tintin:${tag}] ${text}${e?.stack ? '\n' + String(e.stack).slice(0, 20000) : ''}`)
      if (level === 'error') {
        void httpRequest('POST', '/api/logs/upload', {
          body: { level, event: tag, message: text, ...(e?.stack ? { stack: String(e.stack).slice(0, 20000) } : {}), client_ts: new Date().toISOString() },
        }).catch((err) => ctx.logger.warn('tintin-bundle: error report upload failed: %s', err?.message ?? err))
      }
      return { ok: true }
    },
  }

  return nativeChannels
}
