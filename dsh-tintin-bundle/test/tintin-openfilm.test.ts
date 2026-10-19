// test/tintin-openfilm.test.ts — OpenFilm 服务端驱动接缝回归
// （lib/openfilm/*：providers.json 注入、Studio 地址解析/运行时定位、技能同步）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeTinTinService, syncProvidersFile, TINTIN_SERVICE_ID } from '../lib/openfilm/providers-seed.js'
import {
  lastStudioProject, parseStudioAddress, parseStudioProject, readStudioRun, resolveOpenfilmRuntime, seedStudioRecents, studioEnv, studioPageUrl,
} from '../lib/openfilm/studio-runtime.js'
import { MANAGED_MARKER, syncBundledSkill } from '../lib/openfilm/skill-sync.js'
import { syncOpenfilmLibs, THREE_FILES, threeLibDir } from '../lib/openfilm/libs-sync.js'
import { syncOpenfilmLibrary } from '../lib/openfilm/library-sync.js'
import { createOpenfilmChannels } from '../lib/openfilm/plugin.js'

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

describe('libs-sync（离线 three.js）', () => {
  const seedRuntime = (version = '0.184.0') => {
    const root = tempDir()
    const src = join(root, 'openfilm-libs', 'three')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'VERSION'), `${version}\n`)
    for (const rel of THREE_FILES) {
      mkdirSync(join(src, rel, '..'), { recursive: true })
      writeFileSync(join(src, rel), `// ${rel} ${version}`)
    }
    return root
  }

  it('首次安装、再次 current、版本变化重装', () => {
    const home = tempDir()
    const runtimeRoot = seedRuntime()
    const first = syncOpenfilmLibs({ dshHome: home, runtimeRoot })
    expect(first.status).toBe('installed')
    expect(readFileSync(join(threeLibDir(home), 'three.module.js'), 'utf8')).toContain('three.module.js')
    expect(syncOpenfilmLibs({ dshHome: home, runtimeRoot }).status).toBe('current')
    const bumped = seedRuntime('0.185.0')
    expect(syncOpenfilmLibs({ dshHome: home, runtimeRoot: bumped }).status).toBe('installed')
    expect(readFileSync(join(threeLibDir(home), 'VERSION'), 'utf8').trim()).toBe('0.185.0')
  })

  it('运行时未拉取时返回 missing-source，不落任何文件', () => {
    const home = tempDir()
    const result = syncOpenfilmLibs({ dshHome: home, runtimeRoot: tempDir() })
    expect(result.status).toBe('missing-source')
    expect(() => readFileSync(join(threeLibDir(home), 'three.module.js'))).toThrow()
  })
})

describe('library-sync（项目默认目录）', () => {
  const prefsOf = (home) => JSON.parse(readFileSync(join(home, '.openfilm', 'prefs.json'), 'utf8'))

  it('无选择时写入客户端默认目录、创建目录、保留其他键', () => {
    const home = tempDir()
    const library = join(tempDir(), 'tintin-workspace')
    mkdirSync(join(home, '.openfilm'), { recursive: true })
    writeFileSync(join(home, '.openfilm', 'prefs.json'), JSON.stringify({ proxies: { on: true }, projectsFolder: null }))
    const result = syncOpenfilmLibrary({ homeDir: home, libraryDir: library })
    expect(result.status).toBe('installed')
    expect(result.folder).toBe(resolve(library))
    expect(existsSync(library)).toBe(true)
    const prefs = prefsOf(home)
    expect(prefs.projectsFolder).toBe(resolve(library))
    expect(prefs.proxies).toEqual({ on: true })
    expect(syncOpenfilmLibrary({ homeDir: home, libraryDir: library }).status).toBe('current')
  })

  it('本集成设过的旧值可迁移到新目标，用户自选不覆盖', () => {
    const home = tempDir()
    mkdirSync(join(home, '.openfilm'), { recursive: true })
    writeFileSync(join(home, '.openfilm', 'prefs.json'), JSON.stringify({ projectsFolder: 'C:\old\ws', tintinProjectsFolder: 'C:\old\ws' }))
    const next = join(tempDir(), 'openfilm')
    expect(syncOpenfilmLibrary({ homeDir: home, libraryDir: next }).status).toBe('installed')
    expect(prefsOf(home).projectsFolder).toBe(resolve(next))
    expect(prefsOf(home).tintinProjectsFolder).toBe(resolve(next))
  })

  it('用户已选其他目录时不覆盖', () => {
    const home = tempDir()
    mkdirSync(join(home, '.openfilm'), { recursive: true })
    writeFileSync(join(home, '.openfilm', 'prefs.json'), JSON.stringify({ projectsFolder: 'D:\my-films' }))
    expect(syncOpenfilmLibrary({ homeDir: home, libraryDir: join(tempDir(), 'ws') }).status).toBe('kept')
    expect(prefsOf(home).projectsFolder).toBe('D:\my-films')
  })

  it('非绝对路径拒绝', () => {
    expect(syncOpenfilmLibrary({ homeDir: tempDir(), libraryDir: 'relative/path' }).status).toBe('invalid')
  })
})



describe('parseStudioProject', () => {
  it('读 CLI 的 project 行（含空格路径）', () => {
    const out = ['project  D:\My Films\launch video', 'Studio   http://127.0.0.1:4788/open?key=x', ''].join('\n')
    expect(parseStudioProject(out)).toBe('D:\My Films\launch video')
    expect(parseStudioProject('no project here')).toBeNull()
  })
})

describe('lastStudioProject / seedStudioRecents', () => {
  it('取最近打开且仍存在的项目，否则 null', () => {
    const home = tempDir()
    const project = join(tempDir(), 'film')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(home, 'studio.json'), JSON.stringify({ recent: [{ path: project }, { path: 'D:/gone/film' }] }))
    expect(lastStudioProject(home)).toBe(project)
    expect(lastStudioProject(tempDir())).toBeNull()
    writeFileSync(join(home, 'studio.json'), JSON.stringify({ recent: [{ path: 'D:/gone/film' }] }))
    expect(lastStudioProject(home)).toBeNull()
  })

  it('隔离 home 首次从共享 home 种入 recent，已有则保留', () => {
    const source = tempDir()
    const target = tempDir()
    const project = join(tempDir(), 'film')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(source, 'studio.json'), JSON.stringify({ recent: [{ id: 'a', path: project, openedAt: 1 }] }))
    const seeded = seedStudioRecents({ studioHome: target, sourceHome: source })
    expect(seeded.status).toBe('seeded')
    expect(JSON.parse(readFileSync(join(target, 'studio.json'), 'utf8')).recent[0].path).toBe(project)
    expect(seedStudioRecents({ studioHome: target, sourceHome: source }).status).toBe('kept')
  })

  it('共享 home 无可用项目时不写', () => {
    const target = tempDir()
    expect(seedStudioRecents({ studioHome: target, sourceHome: tempDir() }).status).toBe('empty')
    expect(() => readFileSync(join(target, 'studio.json'))).toThrow()
  })
})

describe('openfilm project files / import channels', () => {
  const channels = createOpenfilmChannels({ sync: () => {} })
  const makeProject = () => {
    const project = tempDir()
    writeFileSync(join(project, 'film.html'), '<section></section>')
    mkdirSync(join(project, 'assets'), { recursive: true })
    writeFileSync(join(project, 'assets', 'a.png'), 'png')
    mkdirSync(join(project, 'pages'), { recursive: true })
    writeFileSync(join(project, 'pages', 'title.html'), '<p>x</p>')
    mkdirSync(join(project, '.film', 'cache'), { recursive: true })
    writeFileSync(join(project, '.film', 'cache', 'x.png'), 'x')
    mkdirSync(join(project, 'node_modules'), { recursive: true })
    writeFileSync(join(project, 'node_modules', 'x.js'), 'x')
    return project
  }

  it('lists film project files, skipping .film/node_modules', async () => {
    const project = makeProject()
    const result = await channels['openfilm:projectFiles']([{ project }])
    const paths = result.files.map((file) => file.path)
    expect(result.pages.map((page) => page.path)).toEqual(['film.html'])
    expect(result.pages[0].size).toBeGreaterThan(0)
    expect(paths).toContain('assets/a.png')
    expect(paths).toContain('pages/title.html')
    expect(result.files.find((file) => file.path === 'assets/a.png').size).toBe(3)
    expect(paths.some((file) => file.startsWith('.film'))).toBe(false)
    expect(paths.some((file) => file.startsWith('node_modules'))).toBe(false)
  })

  it('imports into assets/upload with a unique name', async () => {
    const project = makeProject()
    const source = join(tempDir(), 'logo.png')
    writeFileSync(source, 'logo')
    const first = await channels['openfilm:importFile']([{ project, sourcePath: source, name: 'logo.png' }])
    expect(first.path).toBe('assets/upload/logo.png')
    expect(existsSync(join(project, 'assets', 'upload', 'logo.png'))).toBe(true)
    const second = await channels['openfilm:importFile']([{ project, sourcePath: source, name: 'logo.png' }])
    expect(second.path).toBe('assets/upload/logo-2.png')
  })

  it('rejects a folder that is not a film project', async () => {
    const result = await channels['openfilm:projectFiles']([{ project: tempDir() }])
    expect(result.error).toMatch(/film\.html/)
  })
})

describe('openfilm skills channel', () => {
  it('merges native skills with the server registry and installed state', async () => {
    const home = tempDir()
    mkdirSync(join(home, 'skills', 'installed-one'), { recursive: true })
    writeFileSync(join(home, 'skills', 'installed-one', 'SKILL.md'), '---\nname: installed-one\ndescription: x\n---\n\n# body\n')
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const calls: string[] = []
    const channels = createOpenfilmChannels({
      sync: () => {},
      httpRequest: async (method: string, path: string) => {
        calls.push(`${method} ${path}`)
        return { data: { ok: true, skills: [
          { id: 'installed-one', name: '本地技能', description: '已安装的服务端技能' },
          { id: 'remote-one', name: '服务端技能', description: '未安装' },
        ] } }
      },
    })
    try {
      const result = await channels['openfilm:skills']([])
      expect(calls).toEqual(['GET /skills'])
      expect(Array.isArray(result.native)).toBe(true)
      if (result.native.length) {
        expect(result.native[0].name).toBeTruthy()
        expect(result.native[0].cover).toMatch(/openfilm-skill-covers/)
      }
      expect(result.server.find((skill: any) => skill.id === 'installed-one')).toMatchObject({ installed: true, name: '本地技能' })
      expect(result.server.find((skill: any) => skill.id === 'remote-one')).toMatchObject({ installed: false })
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('returns an empty server group without httpRequest', async () => {
    const result = await createOpenfilmChannels({ sync: () => {} })['openfilm:skills']([])
    expect(result.server).toEqual([])
  })
})
