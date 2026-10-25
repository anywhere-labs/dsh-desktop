// test/tintin-film-timeline.test.ts — A 轴编译器回归（2026-10-21 用户裁决：
// 大模型只产出时间线 JSON，客户端确定性编译成 OpenFilm 项目）。
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TIMELINE_VERSION, assetSourceOf, compileTimeline, validateTimeline, vttStamp,
} from '../lib/film-timeline.js'
import { createOpenfilmFilmTools } from '../lib/film-tools.js'

const TIMELINE = {
  version: 1,
  resolution: '1920x1080',
  fps: 30,
  tracks: [
    { kind: 'video', clips: [
      { asset: 'assets/intro.mp4', at: 0, in: 0, out: 3.2 },
      { asset: 'material:1343', at: 3.2, in: 1, out: 4.5 },
    ] },
    { kind: 'voice', clips: [{ asset: 'assets/vo.wav', at: 0 }] },
    { kind: 'music', clips: [{ asset: 'https://example.com/bgm.mp3', at: 0, volume: 0.3 }] },
    { kind: 'subtitle', cues: [
      { at: 0.2, to: 2.8, text: '第一句' },
      { at: 3.0, to: 5.5, text: '第二句' },
    ] },
  ],
}

describe('assetSourceOf', () => {
  it('material id / URL / 本地路径三态', () => {
    expect(assetSourceOf('material:abc')).toEqual({ kind: 'material', value: 'abc' })
    expect(assetSourceOf('https://s/x.mp4')).toEqual({ kind: 'url', value: 'https://s/x.mp4' })
    expect(assetSourceOf('assets/a.mp4')).toEqual({ kind: 'local', value: 'assets/a.mp4' })
    expect(assetSourceOf('material:')).toBeNull()
    expect(assetSourceOf('  ')).toBeNull()
  })
})

describe('validateTimeline', () => {
  it('合法时间线通过', () => {
    expect(validateTimeline(TIMELINE)).toEqual({ ok: true, errors: [] })
  })

  it('坏文档给出可直接回给模型的短句', () => {
    const bad = validateTimeline({ version: 9, tracks: [
      { kind: 'nope' },
      { kind: 'video', clips: [{ asset: '', at: -1, in: 5, out: 2 }] },
      { kind: 'subtitle', cues: [{ at: 2, to: 1, text: '' }] },
    ] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/version 必须是 1/)
    expect(bad.errors.join('\n')).toMatch(/kind 必须是/)
    expect(bad.errors.join('\n')).toMatch(/asset 必填/)
    expect(bad.errors.join('\n')).toMatch(/out 必须大于 in/)
    expect(bad.errors.join('\n')).toMatch(/text 必填/)
  })

  it('空 tracks 直接拒绝', () => {
    expect(validateTimeline({ tracks: [] }).errors).toContain('tracks 不能为空')
    expect(validateTimeline(null).errors).toContain('时间线必须是 JSON 对象')
  })
})

describe('compileTimeline', () => {
  it('生成 film.html：视频带 #t 区间、音频带音量、按轨成 section', () => {
    const out = compileTimeline(TIMELINE)
    expect(out.ok).toBe(true)
    expect(out.html).toContain('<meta name="viewport" content="width=1920, height=1080">')
    expect(out.html).toContain('<video src="assets/clip-1.mp4#t=0.000,3.200" at="0.000"></video>')
    expect(out.html).toContain('<video src="assets/clip-2.mp4#t=1.000,4.500" at="3.200"></video>')
    expect(out.html).toContain('<audio src="assets/audio-1.wav" at="0.000"></audio>')
    expect(out.html).toContain('<audio src="assets/audio-2.mp3" at="0.000" volume="0.3"></audio>')
    expect((out.html.match(/<section>/g) || []).length).toBe(3)
  })

  it('素材清单按出现顺序去重，来源类型正确', () => {
    const withDup = { version: 1, tracks: [
      { kind: 'video', clips: [
        { asset: 'assets/same.mp4', at: 0 },
        { asset: 'assets/same.mp4', at: 2 },
        { asset: 'material:9', at: 4 },
      ] },
    ] }
    const out = compileTimeline(withDup)
    expect(out.assets.map((a) => a.rel)).toEqual(['assets/clip-1.mp4', 'assets/clip-2.mp4'])
    expect(out.assets[0].source).toEqual({ kind: 'local', value: 'assets/same.mp4' })
    expect(out.assets[1].source).toEqual({ kind: 'material', value: '9' })
    expect((out.html.match(/assets\/clip-1\.mp4/g) || []).length).toBe(2)
  })

  it('字幕生成 WebVTT 并挂在首个音频旁边', () => {
    const out = compileTimeline(TIMELINE)
    expect(out.subtitle.rel).toBe('assets/audio-1.wav.vtt')
    expect(out.subtitle.vtt).toContain('WEBVTT')
    expect(out.subtitle.vtt).toContain('00:00:00.200 --> 00:00:02.800\n第一句')
    expect(out.subtitle.vtt).toContain('00:00:03.000 --> 00:00:05.500\n第二句')
  })

  it('无音频时字幕挂首个视频；两者都没有则给 warning', () => {
    const videoOnly = { version: 1, tracks: [
      { kind: 'video', clips: [{ asset: 'assets/a.mp4', at: 0 }] },
      { kind: 'subtitle', cues: [{ at: 0, to: 1, text: 'x' }] },
    ] }
    expect(compileTimeline(videoOnly).subtitle.rel).toBe('assets/clip-1.mp4.vtt')
    const noneMedia = { version: 1, tracks: [{ kind: 'subtitle', cues: [{ at: 0, to: 1, text: 'x' }] }] }
    const out = compileTimeline(noneMedia)
    expect(out.subtitle).toBeNull()
    expect(out.warnings.join('')).toMatch(/字幕被丢弃/)
  })

  it('编译失败时返回 errors 而不是抛错', () => {
    const out = compileTimeline({ tracks: [{ kind: 'video', clips: [{ at: 0 }] }] })
    expect(out.ok).toBe(false)
    expect(out.html).toBe('')
    expect(out.errors.join('')).toMatch(/asset 必填/)
  })

  it('page 轨：iframe 片段不落盘，保留设计自由度', () => {
    const out = compileTimeline({ version: 1, tracks: [
      { kind: 'page', clips: [{ asset: 'pages/intro.html', at: 0, duration: 3 }] },
      { kind: 'page', clips: [{ asset: 'pages/outro.html', at: 3.5 }] },
      { kind: 'video', clips: [{ asset: 'assets/a.mp4', at: 0 }] },
    ] })
    expect(out.ok).toBe(true)
    expect(out.html).toContain('<iframe src="pages/intro.html" at="0.000" duration="3.000"></iframe>')
    expect(out.html).toContain('<iframe src="pages/outro.html" at="3.500"></iframe>')
    expect(out.assets.map((a) => a.rel)).toEqual(['assets/clip-1.mp4'])
    expect(validateTimeline({ tracks: [{ kind: 'page', clips: [{ asset: 'pages/x.js', at: 0 }] }] }).errors.join('')).toMatch(/\.html/)
    expect(compileTimeline({ version: 1, tracks: [{ kind: 'page', clips: [{ asset: '../escape.html', at: 0 }] }] }).warnings.join('')).toMatch(/没有可播放的片段/)
  })

  it('vttStamp 支持毫秒与小时', () => {
    expect(vttStamp(0)).toBe('00:00:00.000')
    expect(vttStamp(62.35)).toBe('00:01:02.350')
    expect(vttStamp(3661.5)).toBe('01:01:01.500')
    expect(TIMELINE_VERSION).toBe(1)
  })
})

describe('film_compile / film_render 工具', () => {
  const tools = createOpenfilmFilmTools({ getServerUrl: () => 'http://127.0.0.1:8000' })
  const tool = (name) => tools.find((item) => item.name === name)
  const fakeExec = (cwd) => ({ agent: { session: { header: { meta: { cwd } } } } })

  it('两个工具在位，参数齐全', () => {
    expect(tools.map((t) => t.name)).toEqual(['film_compile', 'film_render'])
    expect(tool('film_compile').parameters.timeline.required).toBe(true)
    expect(typeof tool('film_render').execute).toBe('function')
  })

  it('film_compile 落素材/字幕/film.html，并可重复调用（幂等）', async () => {
    const project = mkdtempSync(join(tmpdir(), 'film-compile-'))
    writeFileSync(join(project, 'film.html'), '<body></body>')
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src', 'intro.mp4'), 'fake-video')
    writeFileSync(join(project, 'src', 'vo.wav'), 'fake-audio')
    const timeline = {
      version: 1, resolution: '1280x720',
      tracks: [
        { kind: 'video', clips: [{ asset: 'src/intro.mp4', at: 0, in: 0, out: 2 }] },
        { kind: 'voice', clips: [{ asset: 'src/vo.wav', at: 0 }] },
        { kind: 'subtitle', cues: [{ at: 0, to: 2, text: '你好' }] },
      ],
    }
    const first = await tool('film_compile').execute({ timeline }, fakeExec(project))
    expect(first.ok).toBe(true)
    expect(first.assets).toBe(2)
    expect(first.subtitle).toBe('assets/audio-1.wav.vtt')
    const html = readFileSync(join(project, 'film.html'), 'utf8')
    expect(html).toContain('assets/clip-1.mp4#t=0.000,2.000')
    expect(html).toContain('width=1280, height=720')
    expect(existsSync(join(project, 'assets', 'clip-1.mp4'))).toBe(true)
    expect(existsSync(join(project, 'assets', 'audio-1.wav.vtt'))).toBe(true)
    const second = await tool('film_compile').execute({ timeline }, fakeExec(project))
    expect(second.ok).toBe(true)
  })

  it('film_compile 对坏时间线返回 errors（模型据此改 JSON）', async () => {
    const project = mkdtempSync(join(tmpdir(), 'film-compile-bad-'))
    writeFileSync(join(project, 'film.html'), '<body></body>')
    const result = await tool('film_compile').execute({ timeline: { tracks: [{ kind: 'video', clips: [{ at: 0 }] }] } }, fakeExec(project))
    expect(result.ok).toBe(false)
    expect(result.errors.join('')).toMatch(/asset 必填/)
  })

  it('film_compile 拒绝非影片项目与缺失的本地素材', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'film-compile-empty-'))
    const notProject = await tool('film_compile').execute({ timeline: { tracks: [] } }, fakeExec(empty))
    expect(notProject.error).toMatch(/不是影片项目/)
    const project = mkdtempSync(join(tmpdir(), 'film-compile-missing-'))
    writeFileSync(join(project, 'film.html'), '<body></body>')
    const missing = await tool('film_compile').execute({ timeline: { version: 1, tracks: [{ kind: 'video', clips: [{ asset: 'nope.mp4', at: 0 }] }] } }, fakeExec(project))
    expect(missing.error).toMatch(/本地素材不存在/)
  })
})
