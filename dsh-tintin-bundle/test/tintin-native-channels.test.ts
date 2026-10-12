// test/tintin-native-channels.test.ts — montage 域本地原生通道 CJS→ESM 搬运回归
// （packages/tintin-bundle/lib/montage：ffmpeg-gate / voice-ipc / final-ipc）。
// 只断言「通道表存在 + 参数校验/纯函数可测行为 + 注入面（httpRequest/
// isExpectedOfflineError）接线」；需要真实 ffmpeg/剪映目录/服务端的重链路
// （final:mix 真合成、jianying:export 落盘、jytpl:sync 上传）走真实启动验收
// （npm run dev 后 curl /tintin/ipc/<channel>），不在单测范围。
import { describe, expect, it } from 'vitest'
import { createFfmpegGateApi, parseFfmpegInfo } from '../lib/montage/ffmpeg-gate.js'
import { createMontageVoiceApi } from '../lib/montage/voice-ipc.js'
import { createMontageFinalApi } from '../lib/montage/final-ipc.js'
import { isExpectedOfflineError } from '../lib/server-proxy.js'

type Entry = (args: unknown[], ctx?: { emit?: (event: Record<string, unknown>) => void }) => Promise<unknown> | unknown
type ChannelTable = Record<string, Entry>

// 通道表按名取件：缺失即失败（铁律 7——失败要带准确通道名，不静默）。
function mustChannel(table: ChannelTable, name: string): Entry {
  const entry = table[name]
  if (!entry) throw new Error(`missing native channel: ${name}`)
  return entry
}

interface DepsOverrides {
  data?: unknown
  err?: Error
}

// 注入面桩：记录 httpRequest 调用，data/err 可按用例覆写。
function makeDeps(overrides: DepsOverrides = {}) {
  const calls: Array<{ method: string; url: string }> = []
  const deps = {
    async httpRequest(method: string, url: string) {
      calls.push({ method, url })
      if (overrides.err) throw overrides.err
      return {
        data: overrides.data ?? {},
        status: 200,
        headers: {},
        raw: Buffer.from('{}'),
      }
    },
    isExpectedOfflineError,
    getServerUrl: () => 'http://127.0.0.1:8766',
  }
  return { deps, calls }
}

function offlineError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8766'), { code: 'ECONNREFUSED' })
}

describe('ffmpeg-gate native channels', () => {
  it('registers exactly the 8 source channels (probe/probeDuration/cut/embedCover/ensurePlayable/extractAudio/extractAudioCached/extractFrames)', () => {
    const api = createFfmpegGateApi({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' })
    expect(Object.keys(api).sort()).toEqual([
      'ffmpeg:cut', 'ffmpeg:embedCover', 'ffmpeg:ensurePlayable', 'ffmpeg:extractAudio',
      'ffmpeg:extractAudioCached', 'ffmpeg:extractFrames', 'ffmpeg:probe', 'ffmpeg:probeDuration',
    ])
  })

  it('parseFfmpegInfo parses the packaged ffmpeg -i stderr shape (source-comment fixture)', () => {
    // 样本取自源 ffmpeg-gate.js 头注的实测输出（resources/bin/ffmpeg.exe，2026-09-11）；
    // 解析按行匹配——尺寸/帧率必须与 "Stream #… Video:" 同行（真实输出即单行）。
    const info = parseFfmpegInfo(
      'Duration: 00:00:01.00, start: 0.000000, bitrate: 104 kb/s\n' +
      '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 480x854 [SAR 1:1 DAR 240:427], 12 kb/s, 29.97 fps, 29.97 tbr, 11988 tbn (default)\n' +
      '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp\n',
    )
    expect(info).toEqual({ duration: 1, width: 480, height: 854, fps: 29.97, video: 'h264', audio: 'aac' })
  })

  it('ffmpeg:probeDuration falls back to ffmpeg stderr parsing and returns 0 for a missing file without spawning', async () => {
    // ffprobePath 非绝对路径（未随包分发）→ 跳过 ffprobe；文件不存在 →
    // probeDurationViaFfmpeg 直接 resolve(0)，不触碰二进制。
    const api = createFfmpegGateApi({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' })
    const probeDuration = mustChannel(api, 'ffmpeg:probeDuration')
    await expect(probeDuration(['Z:\\__tintin_missing__.mp4'], {})).resolves.toBe(0)
  })
})

describe('voice-ipc native channels', () => {
  it('registers the 12 source channels', () => {
    const { deps } = makeDeps()
    const api = createMontageVoiceApi(deps)
    expect(Object.keys(api).sort()).toEqual([
      'fancy:ensurePreviews', 'fancy:listTemplates', 'fancy:serverTemplates', 'textfx:serverTemplates',
      'voice:cloneBatch', 'voice:cloneBatchStop', 'voice:dubVideos', 'voice:exportAudio',
      'voice:fontFile', 'voice:fonts', 'voice:scanDir', 'voice:subtitleStyles',
    ])
  })

  it('voice:subtitleStyles proxies GET /subtitle_styles and unwraps {styles:[...]}', async () => {
    const { deps, calls } = makeDeps({ data: { styles: [{ id: 'std_bottom', name: '底部标准' }] } })
    const api = createMontageVoiceApi(deps)
    const subtitleStyles = mustChannel(api, 'voice:subtitleStyles')
    await expect(subtitleStyles([], {})).resolves.toEqual({ styles: [{ id: 'std_bottom', name: '底部标准' }] })
    expect(calls).toEqual([{ method: 'GET', url: '/subtitle_styles' }])
  })

  it('voice:subtitleStyles returns null on expected offline errors (renderer falls back to local presets)', async () => {
    const { deps } = makeDeps({ err: offlineError() })
    const api = createMontageVoiceApi(deps)
    const subtitleStyles = mustChannel(api, 'voice:subtitleStyles')
    await expect(subtitleStyles([], {})).resolves.toBeNull()
  })

  it('fancy:listTemplates degrades to empty template list when no fancy assets dir resolves', async () => {
    const { deps } = makeDeps()
    const api = createMontageVoiceApi(deps)
    const listTemplates = mustChannel(api, 'fancy:listTemplates')
    // 无 TINTIN_FANCY_DIR / resourcesPath / dev resources 目录 → 加载器返回空表，
    // 渲染层回退服务端模板（fancy:serverTemplates），不报错。
    await expect(listTemplates([], {})).resolves.toEqual({ templates: [], previews: {} })
  })

  it('voice:cloneBatch rejects an empty task list with the source validation message', async () => {
    const { deps } = makeDeps()
    const api = createMontageVoiceApi(deps)
    const cloneBatch = mustChannel(api, 'voice:cloneBatch')
    await expect(cloneBatch([{}], {})).resolves.toEqual({ error: 'voice:cloneBatch requires tasks[]' })
  })
})

describe('final-ipc native channels', () => {
  it('registers the 12 source channels plus the jianying-audio-sync trio, the jyfonts trio and the local-montage quintet', () => {
    const { deps } = makeDeps()
    const api = createMontageFinalApi(deps)
    expect(Object.keys(api).sort()).toEqual([
      'bgm:downloadUrl', 'editor:exportJianyingPackage', 'final:collectOutputs', 'final:findSrt',
      'final:listResults', 'final:mix', 'final:readTiming', 'jianying:export', 'jyaudio:setEnabled',
      'jyaudio:status', 'jyaudio:syncNow', 'jyfonts:scan', 'jyfonts:serverList', 'jyfonts:upload',
      // jytpl:install（2026-09-30：文字模板预设「服务端→本机剪映」自动安装）
      'jytpl:deleteServer', 'jytpl:install', 'jytpl:list', 'jytpl:sync', 'lut:list',
      // 本地 montage 族（Step2-4 工作包宿主侧：裁边/拼接/成片校验/坏片删除/清缓存）
      'montage:clearCache', 'montage:concatClips', 'montage:deleteBadFinal', 'montage:trimEdgeClips', 'montage:validateFinal',
    ])
  })

  it('final:mix rejects an empty task list with the source validation message', async () => {
    const { deps } = makeDeps()
    const api = createMontageFinalApi(deps)
    const mix = mustChannel(api, 'final:mix')
    // 空 tasks 走「本地合成」链路的最前置参数校验：不触 fs/ffmpeg/服务端。
    await expect(mix([{}], {})).resolves.toEqual({ error: 'final:mix requires tasks[]' })
  })

  it('final:mix validates before any progress emission (no emit sink needed in P0 sync mode)', async () => {
    const { deps } = makeDeps()
    const api = createMontageFinalApi(deps)
    const mix = mustChannel(api, 'final:mix')
    const events: Array<Record<string, unknown>> = []
    await expect(mix([{ progressChannel: 'test-progress' }], { emit: (e) => events.push(e) }))
      .resolves.toEqual({ error: 'final:mix requires tasks[]' })
    expect(events).toEqual([]) // 校验失败在首次 emit 之前
  })

  it('jianying:export fails fast on a missing videoPath (exporter guard, no fs/ffmpeg touched)', async () => {
    const { deps } = makeDeps()
    const api = createMontageFinalApi(deps)
    const exportChannel = mustChannel(api, 'jianying:export')
    await expect(exportChannel([{}], {})).resolves.toEqual({ success: false, message: '视频文件不存在' })
  })

  it('jyaudio:status is reachable through the ipcMain-shape adapter (jianying-audio-sync registration)', async () => {
    const { deps } = makeDeps()
    const api = createMontageFinalApi(deps)
    const status = mustChannel(api, 'jyaudio:status')
    const r = await status([], {})
    // 2026-10-11 用户裁决（409 风暴）：自动同步默认关闭
    expect(r).toMatchObject({ enabled: false, running: false })
  })
})
