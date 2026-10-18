// test/tintin-openfilm.test.ts — OpenFilm 服务端驱动接缝回归
// （lib/openfilm/*：providers.json 注入、Studio 地址解析/运行时定位、技能同步）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeTinTinService, syncProvidersFile, TINTIN_SERVICE_ID } from '../lib/openfilm/providers-seed.js'
import {
  parseStudioAddress, readStudioRun, resolveOpenfilmRuntime, studioEnv, studioPageUrl,
} from '../lib/openfilm/studio-runtime.js'
import { MANAGED_MARKER, syncBundledSkill } from '../lib/openfilm/skill-sync.js'

const tmpDirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tintin-openfilm-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('providers-seed', () => {
  it('注入 tintin 自定义服务，保留 keys/use/model 与其他服务', () => {
    const doc = mergeTinTinService({
      keys: { elevenlabs: 'sk-x' },
      use: { tts: 'elevenlabs' },
      model: { tts: 'eleven_v3' },
      custom: [{ id: 'my-whisper', name: 'My Whisper', url: 'http://local:9000', auth: 'Authorization: Bearer {key}', note: 'asr' }],
      futureField: true,
    }, 'http://192.168.111.31:8000/')
    expect(doc.keys).toEqual({ elevenlabs: 'sk-x' })
    expect(doc.use).toEqual({ tts: 'elevenlabs' })
    expect(doc.model).toEqual({ tts: 'eleven_v3' })
    expect(doc.futureField).toBe(true)
    expect(doc.custom).toHaveLength(2)
    const tintin = doc.custom.find((s) => s.id === TINTIN_SERVICE_ID)
    expect(tintin.url).toBe('http://192.168.111.31:8000')
    expect(tintin.name).toBe('TinTin 服务端')
    expect(String(tintin.note)).toContain('/indextts/tts')
    expect(doc.custom.find((s) => s.id === 'my-whisper').url).toBe('http://local:9000')
  })

  it('重复注入不重复、改 URL 生效、服务自带 key 与未知字段保留', () => {
    const first = mergeTinTinService({}, 'http://a:1')
    const withKey = {
      ...first,
      custom: first.custom.map((s) => ({ ...s, key: 'person-key', extra: 'kept' })),
    }
    const second = mergeTinTinService(withKey, 'http://b:2')
    expect(second.custom).toHaveLength(1)
    expect(second.custom[0].url).toBe('http://b:2')
    expect(second.custom[0].key).toBe('person-key')
    expect(second.custom[0].extra).toBe('kept')
  })

  it('syncProvidersFile 落盘到 ~/.openfilm/providers.json，第二次为 no-op', () => {
    const home = tempDir()
    const first = syncProvidersFile({ homeDir: home, serverUrl: 'http://192.168.111.31:8000' })
    expect(first.changed).toBe(true)
    const stored = JSON.parse(readFileSync(first.path, 'utf8'))
    expect(stored.custom[0].id).toBe(TINTIN_SERVICE_ID)
    const second = syncProvidersFile({ homeDir: home, serverUrl: 'http://192.168.111.31:8000' })
    expect(second.changed).toBe(false)
  })
})

describe('studio-runtime', () => {
  it('parseStudioAddress 只收本机地址', () => {
    const line = 'Studio   http://127.0.0.1:4747/open?key=abc&to=%2Fprojects%2F1'
    expect(parseStudioAddress(line)).toBe('http://127.0.0.1:4747/open?key=abc&to=%2Fprojects%2F1')
    expect(parseStudioAddress('Studio   http://localhost:5000/open?key=x')).toBe('http://localhost:5000/open?key=x')
    expect(parseStudioAddress('Studio   http://evil.example:4747/open?key=x')).toBeNull()
    expect(parseStudioAddress('no address here')).toBeNull()
  })

  it('studioPageUrl 用 key 拼页面地址', () => {
    expect(studioPageUrl({ origin: 'http://127.0.0.1:4747', key: 'k 1' }))
      .toBe('http://127.0.0.1:4747/open?key=k%201')
    expect(studioPageUrl(null)).toBe('')
  })

  it('readStudioRun 读 ~/.openfilm/run.json', () => {
    const home = tempDir()
    mkdirSync(join(home, '.openfilm'), { recursive: true })
    writeFileSync(join(home, '.openfilm', 'run.json'), JSON.stringify({ pid: 42, origin: 'http://127.0.0.1:4747', filmOrigin: 'http://localhost:4748', key: 'abc' }))
    expect(readStudioRun(home)).toEqual({ origin: 'http://127.0.0.1:4747', key: 'abc', pid: 42 })
    expect(readStudioRun(tempDir())).toBeNull()
  })

  it('resolveOpenfilmRuntime 从 TINTIN_BIN_DIR 的上一级定位运行时', () => {
    const root = tempDir()
    mkdirSync(join(root, 'openfilm', 'bin'), { recursive: true })
    mkdirSync(join(root, 'openfilm', 'node_modules', 'openfilm', 'bin'), { recursive: true })
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    writeFileSync(join(root, 'openfilm', 'bin', nodeName), '')
    writeFileSync(join(root, 'openfilm', 'node_modules', 'openfilm', 'bin', 'openfilm.mjs'), '')
    const runtime = resolveOpenfilmRuntime({ env: { TINTIN_BIN_DIR: join(root, 'bin') } })
    expect(runtime?.root).toBe(root)
    expect(runtime?.browsers).toBeNull()
    expect(resolveOpenfilmRuntime({ env: {} })).toBeNull()
    // Its own Studio home and port: the official OpenFilm app keeps ~/.openfilm
    // and port 4747, and its native page paints black in a plain window.
    const env = studioEnv(runtime, { DSH_HOME: join(root, 'dsh') })
    expect(env.OPENFILM_NO_BROWSER).toBe('1')
    expect(env.OPENFILM_HOME).toBe(join(root, 'dsh', 'openfilm-studio'))
    expect(env.OPENFILM_STUDIO_PORT).toBe('4788')
    expect(studioEnv(runtime, { OPENFILM_HOME: join(root, 'custom'), OPENFILM_STUDIO_PORT: '5000' })).toMatchObject({
      OPENFILM_HOME: join(root, 'custom'),
      OPENFILM_STUDIO_PORT: '5000',
    })
  })
})

describe('skill-sync', () => {
  const source = (dir) => {
    const path = join(dir, 'source.md')
    writeFileSync(path, `---\nname: openfilm\n---\n${MANAGED_MARKER}\nbody`)
    return path
  }

  it('缺失时安装、相同则 current、我们改过则 updated', () => {
    const home = tempDir()
    const dir = tempDir()
    const src = source(dir)
    expect(syncBundledSkill({ dshHome: home, sourcePath: src }).status).toBe('installed')
    expect(syncBundledSkill({ dshHome: home, sourcePath: src }).status).toBe('current')
    writeFileSync(src, `---\nname: openfilm\n---\n${MANAGED_MARKER}\nnew body`)
    expect(syncBundledSkill({ dshHome: home, sourcePath: src }).status).toBe('updated')
  })

  it('同名但非本插件管理的技能不覆盖', () => {
    const home = tempDir()
    const dir = tempDir()
    const src = source(dir)
    const target = join(home, 'skills', 'openfilm')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '---\nname: openfilm\n---\nperson wrote this')
    expect(syncBundledSkill({ dshHome: home, sourcePath: src }).status).toBe('skipped')
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('person wrote this')
  })
})
