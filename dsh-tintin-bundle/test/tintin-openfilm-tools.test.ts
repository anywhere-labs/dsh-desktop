// test/tintin-openfilm-tools.test.ts — OpenFilm 媒体工具层回归
// （lib/openfilm-tools.js：URL 归一化/落盘路径/任务状态/逐词 VTT + 工具执行）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  absoluteUrl, createOpenfilmMediaTools, extensionOf, resolveInPath, resolveOutPath,
  taskIdOf, taskStatusOf, uniquePath, wordTimedVtt,
} from '../lib/openfilm-tools.js'

const tmpDirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tintin-oftools-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fakeExec = (cwd) => ({ agent: { session: { header: { meta: { cwd } } } } })

describe('openfilm-tools helpers', () => {
  it('absoluteUrl 处理相对/绝对地址', () => {
    expect(absoluteUrl('http://s:8000/', '/output/a.wav')).toBe('http://s:8000/output/a.wav')
    expect(absoluteUrl('http://s:8000', 'output/a.wav')).toBe('http://s:8000/output/a.wav')
    expect(absoluteUrl('http://s:8000', 'https://x/a.wav')).toBe('https://x/a.wav')
    expect(absoluteUrl('http://s:8000', '')).toBe('')
  })

  it('extensionOf 按 URL 或 content-type 推断', () => {
    expect(extensionOf('/output/a.wav?x=1')).toBe('.wav')
    expect(extensionOf('', 'audio/wav')).toBe('.wav')
    expect(extensionOf('', 'video/mp4')).toBe('.mp4')
    expect(extensionOf('', 'image/jpeg')).toBe('.jpg')
    expect(extensionOf('', 'application/octet-stream')).toBe('.bin')
  })

  it('输出/输入路径：绝对照用，相对按会话 cwd', () => {
    const cwd = tempDir()
    expect(resolveOutPath(fakeExec(cwd), 'assets/tintin/a.wav')).toBe(join(cwd, 'assets/tintin/a.wav'))
    expect(resolveOutPath(fakeExec(cwd), 'D:/x/a.wav')).toBe('D:/x/a.wav')
    expect(() => resolveOutPath({}, 'relative.wav')).toThrow(/绝对路径/)
    expect(resolveInPath(fakeExec(cwd), 'assets/in.wav')).toBe(join(cwd, 'assets/in.wav'))
  })

  it('uniquePath 不覆盖已有文件', () => {
    const dir = tempDir()
    const first = join(dir, 'a.wav')
    writeFileSync(first, 'x')
    expect(uniquePath(first)).toBe(join(dir, 'a-2.wav'))
  })

  it('任务 id/状态兼容嵌套响应', () => {
    expect(taskIdOf({ id: 't1' })).toBe('t1')
    expect(taskIdOf({ data: { task_id: 't2' } })).toBe('t2')
    expect(taskStatusOf({ status: 'Running' })).toBe('running')
    expect(taskStatusOf({ data: { state: 'completed' } })).toBe('completed')
  })

  it('wordTimedVtt 生成逐词内联时间戳', () => {
    const vtt = wordTimedVtt([{ start: 0, end: 2, words: [{ word: '你', start: 0.2 }, { word: '好', start: 0.6 }] }])
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.000')
    expect(vtt).toContain('你<00:00:00.600>好')
  })
})

describe('createOpenfilmMediaTools', () => {
  const factory = (overrides = {}) => {
    const downloads = []
    const calls = []
    const tools = createOpenfilmMediaTools({
      getServerUrl: () => 'http://192.168.111.31:8000',
      httpRequest: async (method, path, options) => {
        calls.push({ method, path, options })
        if (path === '/voice/samples') return { data: { items: [{ id: 7, name: '老怀', audio_url: '/voice/samples/7/audio' }] } }
        if (path === '/indextts/qwen3/voices') return { data: { speakers: ['vivian', 'aiden'] } }
        if (path === '/indextts/tts') return { data: { audio_url: '/output/tts/a.wav', sample_rate: 22050 } }
        if (path === '/audio/gen/bgm') return { data: { url: 'http://192.168.111.31:8000/output/audio/b.wav', duration: 8 } }
        if (path === '/tasks/unified/t1') return { data: { status: 'completed', result: { bpm: 123 } } }
        if (path === '/generate/image') return { data: { task_id: 'g-img', poll: '/tasks/unified/g-img' } }
        if (path === '/generate/video') return { data: { task_id: 'g-vid', poll: '/tasks/unified/g-vid' } }
        if (path === '/tasks/unified/g-img') return { data: { id: 'g-img', status: 'completed', result: { output_url: '/output/gen/x.png', output_path: '/output/gen/x.png', width: 1024, height: 768, seed_used: 42, engine: 'comfygen', job_id: 'j-img' } } }
        if (path === '/tasks/unified/g-vid') return { data: { id: 'g-vid', status: 'failed', error: 'comfygen 422 契约错位' } }
        if (path === '/agent/registry') return { data: { capabilities: [{ id: 'tts_voice_clone', name: 'TTS', method: 'POST', path: '/indextts/tts', sync: true }] } }
        return { data: {} }
      },
      multipartPost: async (path) => {
        calls.push({ method: 'MULTIPART', path })
        if (path === '/whisper/transcribe') return { segments: [{ start: 0, end: 1.2, text: '你好', words: [{ word: '你', start: 0.1, end: 0.4 }, { word: '好', start: 0.4, end: 0.9 }] }] }
        return { id: 't1', status: 'queued' }
      },
      fetchFile: async (url, target) => { downloads.push({ url, target }); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, 'media') },
      ...overrides,
    })
    return { tools, calls, downloads }
  }
  const tool = (tools, name) => tools.find((item) => item.name === name)

  it('tintin_voices 汇总样本与预置音色', async () => {
    const { tools } = factory()
    const result = await tool(tools, 'tintin_voices').execute({}, fakeExec(tempDir()))
    expect(result.ok).toBe(true)
    expect(result.samples).toContain('"id":7')
    expect(result.speakers).toBe('vivian, aiden')
  })

  it('tintin_generate_image 提交→轮询→落盘，载荷只带语义参数', async () => {
    const cwd = tempDir()
    const { tools, calls, downloads } = factory()
    const result = await tool(tools, 'tintin_generate_image').execute({ prompt: '一只橘猫坐在窗台', aspect: '16:9' }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    const post = calls.find((c) => c.path === '/generate/image')
    expect(post.options.body).toEqual({ prompt: '一只橘猫坐在窗台', aspect: '16:9' })
    expect(downloads[0].url).toBe('http://192.168.111.31:8000/output/gen/x.png')
    expect(result.file).toBe(downloads[0].target)
    expect(existsSync(result.file)).toBe(true)
    expect(result.engine).toBe('comfygen')
    expect(result.job_id).toBe('j-img')
    expect(result.width).toBe(1024)
  })

  it('tintin_generate_image 校验 prompt 并透传超时', async () => {
    const { tools } = factory()
    const bad = await tool(tools, 'tintin_generate_image').execute({ prompt: '' }, fakeExec(tempDir()))
    expect(bad.ok).toBe(false)
    expect(String(bad.error)).toMatch(/prompt 必填/)
    const { calls } = factory()
    void calls
  })

  it('tintin_generate_video 提交（resolution/duration 透传）并如实上报失败', async () => {
    const cwd = tempDir()
    const { tools, calls } = factory()
    const result = await tool(tools, 'tintin_generate_video').execute({ prompt: '海浪拍打礁石', resolution: '720p', duration: 5 }, fakeExec(cwd))
    expect(result.ok).toBe(false)
    expect(String(result.error)).toMatch(/comfygen 422/)
    const post = calls.find((c) => c.path === '/generate/video')
    expect(post.options.body).toEqual({ prompt: '海浪拍打礁石', resolution: '720p', duration: 5 })
  })

  it('tintin_tts 合成并落盘（默认 assets/tintin）', async () => {
    const cwd = tempDir()
    const { tools } = factory()
    const result = await tool(tools, 'tintin_tts').execute({ text: '你好', sample_id: 7 }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    expect(result.path.startsWith(join(cwd, 'assets', 'tintin'))).toBe(true)
    expect(existsSync(result.path)).toBe(true)
    expect(result.sample_rate).toBe(22050)
  })

  it('tintin_tts 缺音色时明确报错', async () => {
    const { tools } = factory()
    const result = await tool(tools, 'tintin_tts').execute({ text: '你好' }, fakeExec(tempDir()))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('音色')
  })

  it('tintin_asr 返回逐词并写 VTT', async () => {
    const cwd = tempDir()
    mkdirSync(join(cwd, 'assets'), { recursive: true })
    writeFileSync(join(cwd, 'assets', 'vo.wav'), 'x')
    const { tools } = factory()
    const result = await tool(tools, 'tintin_asr').execute({ file: 'assets/vo.wav', vtt: 'assets/vo.vtt' }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    expect(result.words).toBe(2)
    expect(result.vtt_path).toBe(join(cwd, 'assets', 'vo.vtt'))
    expect(readFileSync(result.vtt_path, 'utf8')).toContain('你<00:00:00.400>好')
  })

  it('tintin_bgm 下载绝对 URL 并返回时长', async () => {
    const cwd = tempDir()
    const { tools, downloads } = factory()
    const result = await tool(tools, 'tintin_bgm').execute({ prompt: '轻快电子', duration: 8 }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    expect(result.duration).toBe(8)
    expect(downloads[0].url).toContain('/output/audio/b.wav')
    expect(existsSync(result.path)).toBe(true)
  })

  it('tintin_task_status 返回状态与结果', async () => {
    const { tools } = factory()
    const result = await tool(tools, 'tintin_task_status').execute({ task_id: 't1' }, fakeExec(tempDir()))
    expect(result.ok).toBe(true)
    expect(result.status).toBe('completed')
    expect(result.result).toContain('"bpm":123')
  })

  it('tintin_download 相对服务端路径落盘到项目，扩展名取自 url', async () => {
    const cwd = tempDir()
    const { tools, downloads } = factory()
    const result = await tool(tools, 'tintin_download').execute({ url: '/montage/split/clip/49c0fd11ba9b/shot_001.mp4' }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    expect(downloads[0].url).toBe('http://192.168.111.31:8000/montage/split/clip/49c0fd11ba9b/shot_001.mp4')
    expect(result.path.endsWith('.mp4')).toBe(true)
    expect(result.path.startsWith(join(cwd, 'assets', 'tintin', 'dl-'))).toBe(true)
    expect(existsSync(result.path)).toBe(true)
  })

  it('tintin_download 指定 out 落盘到指定相对路径', async () => {
    const cwd = tempDir()
    const { tools, downloads } = factory()
    const result = await tool(tools, 'tintin_download').execute({ url: 'https://example.com/a.mp3', out: 'assets/download/clip-02.mp3' }, fakeExec(cwd))
    expect(result.ok).toBe(true)
    expect(result.path).toBe(join(cwd, 'assets', 'download', 'clip-02.mp3'))
    expect(downloads[0].url).toBe('https://example.com/a.mp3')
  })

  it('tintin_capabilities 过滤注册表', async () => {
    const { tools } = factory()
    const result = await tool(tools, 'tintin_capabilities').execute({ filter: 'tts' }, fakeExec(tempDir()))
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(result.capabilities).toContain('tts_voice_clone')
  })
})
