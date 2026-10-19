// OpenFilm host wiring (2026-10-18 用户裁决：服务端驱动 + 侧栏内嵌视图): the
// pieces index.js composes — asset/library sync and the Studio channel. Kept
// here so the host entry stays within its locked line baseline (铁律 4:
// 自己功能增长走提取付账).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultWorkspaceDir } from '../context-task.js'
import { syncProvidersAt, syncProvidersFile } from './providers-seed.js'
import { lastStudioProject, resolveOpenfilmRuntime, seedStudioRecents, startStudio, tintinStudioHome } from './studio-runtime.js'
import { syncBundledSkill } from './skill-sync.js'
import { syncOpenfilmLibs } from './libs-sync.js'
import { syncOpenfilmLibrary } from './library-sync.js'

/** This package's root (lib/openfilm/ → ../../). */
const bundleRoot = fileURLToPath(new URL('../../', import.meta.url))
const skillSource = join(bundleRoot, 'resources', 'skills', 'openfilm', 'SKILL.md')
/** 新建影片的默认库：客户端默认目录下的 OpenFilm/Projects（用户裁决 2026-10-18）。 */
const libraryDir = () => join(defaultWorkspaceDir(), 'OpenFilm', 'Projects')

/**
 * One idempotent sync of the bundled artifacts: the skill (into
 * <DSH_HOME>/skills/openfilm, managed marker), the `tintin` custom service
 * (into ~/.openfilm/providers.json, current server.url), three.js libs, and
 * the new-projects library (~/.openfilm/prefs.json → the TinTin workspace).
 * Never throws — an OpenFilm problem must not take the session bridge down.
 * @param {{ getServerUrl: () => string, logger?: { info: Function, warn: Function } }} options
 */
export function createOpenfilmSync({ getServerUrl, logger = console }) {
  return () => {
    const dshHome = process.env.DSH_HOME
    if (dshHome) {
      const skill = syncBundledSkill({ dshHome, sourcePath: skillSource })
      if (skill.status === 'installed' || skill.status === 'updated') logger.info('tintin-bundle: openfilm skill %s at %s', skill.status, skill.path)
      else if (skill.status === 'error') logger.warn('tintin-bundle: openfilm skill sync failed: %s', skill.error)
      const runtime = resolveOpenfilmRuntime({ env: process.env, bundleDir: bundleRoot })
      if (runtime) {
        const libs = syncOpenfilmLibs({ dshHome, runtimeRoot: runtime.root })
        if (libs.status === 'installed') logger.info('tintin-bundle: openfilm libs synced to %s', libs.path)
      }
    }
    const studioHome = tintinStudioHome()
    const seededRecents = seedStudioRecents({ studioHome, sourceHome: join(homedir(), '.openfilm'), log: (message) => logger.info('tintin-bundle: openfilm %s', message) })
    if (seededRecents.status === 'seeded') logger.info('tintin-bundle: openfilm recent projects seeded (%d)', seededRecents.count)
    // The agent's CLI (`openfilm open/get`) must reach the same isolated Studio
    // the embedded view shows and the client library. Child shells inherit these.
    if (!process.env.OPENFILM_HOME) process.env.OPENFILM_HOME = studioHome
    if (!process.env.OPENFILM_STUDIO_PORT) process.env.OPENFILM_STUDIO_PORT = '4788'
    if (!process.env.OPENFILM_LIBRARY) process.env.OPENFILM_LIBRARY = libraryDir()
    for (const [homeDir, prefsPath] of [[homedir(), undefined], [studioHome, join(studioHome, 'prefs.json')]]) {
      const library = syncOpenfilmLibrary({ homeDir, libraryDir: libraryDir(), prefsPath })
      if (library.status === 'installed') logger.info('tintin-bundle: openfilm projects library → %s', library.folder)
    }
    let serverUrl = ''
    try { serverUrl = getServerUrl() } catch { serverUrl = '' }
    if (!serverUrl) return
    try {
      const seeded = syncProvidersFile({ homeDir: homedir(), serverUrl })
      const isolated = syncProvidersAt({ filePath: join(studioHome, 'providers.json'), serverUrl })
      if (seeded.changed || isolated.changed) logger.info('tintin-bundle: openfilm service seeded at %s', isolated.path)
    } catch (error) {
      logger.warn('tintin-bundle: openfilm provider seed failed: %s', error?.message ?? error)
    }
  }
}

/**
 * `openfilm:studio` — start (or attach to) Studio and return the address the
 * embedded view loads in its iframe. The CLI detaches Studio and would
 * otherwise open the system browser; startStudio sets OPENFILM_NO_BROWSER=1.
 * OPENFILM_LIBRARY makes a freshly started Studio use the TinTin workspace even
 * before prefs.json is read (the sync above also seeds prefs for a running one).
 * @param {{ sync: () => void }} options
 */

const PROJECT_FILE_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.vtt', '.srt', '.ttf', '.otf'])
const PROJECT_SKIP = new Set(['.film', '.git', 'node_modules', '.cache'])

/** The film project a renderer names must actually be one (film.html at its root). */
function requireFilmProject(project) {
  const dir = String(project || '').trim()
  if (!isAbsolute(dir)) throw new Error('项目路径必须是绝对路径')
  if (!existsSync(join(dir, 'film.html'))) throw new Error('不是影片项目（缺少 film.html）')
  return dir
}

/** Relative paths of a film project's files the chat can mention (@), shallow-bounded. */
function listProjectFiles(project, limit = 300) {
  const root = requireFilmProject(project)
  const files = []
  const walk = (dir, depth) => {
    if (files.length >= limit || depth > 4) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= limit) return
      if (PROJECT_SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!PROJECT_FILE_EXT.has(extname(entry.name).toLowerCase())) continue
      files.push({ path: full.slice(root.length + 1).replace(/\\/g, '/'), size: statSync(full).size })
    }
  }
  walk(root, 0)
  return files
}

/** Copy/import one file into <project>/assets/upload, returning its project-relative path. */
function importProjectFile(project, { sourcePath, base64, name } = {}) {
  const root = requireFilmProject(project)
  const source = String(sourcePath || '').trim()
  const stem = basename(source || String(name || 'upload'))
  const safe = stem.replace(/[\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 120) || 'upload'
  const dir = join(root, 'assets', 'upload')
  mkdirSync(dir, { recursive: true })
  const ext = extname(safe)
  const base = ext ? safe.slice(0, -ext.length) : safe
  let target = join(dir, safe)
  for (let index = 2; existsSync(target) && index < 1000; index += 1) target = join(dir, `${base}-${index}${ext}`)
  if (source) {
    if (!existsSync(source)) throw new Error('源文件不存在：' + source)
    copyFileSync(source, target)
  } else if (base64) {
    writeFileSync(target, Buffer.from(String(base64), 'base64'))
  } else {
    throw new Error('缺少 sourcePath 或 base64')
  }
  return 'assets/upload/' + basename(target)
}

/** Frontmatter name/description of one SKILL.md (single-line fields). */
function readSkillMeta(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
    const field = (key) => {
      const match = new RegExp('^' + key + ':\\s*(.+)', 'm').exec(block)
      return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : ''
    }
    return { name: field('name'), description: field('description') }
  } catch { return { name: '', description: '' } }
}

/**
 * Renderer channels: Studio address, the project's @ files, file import, and
 * the skills drawer (native OpenFilm skills + the TinTin server registry).
 * `httpRequest` is the host's authenticated server call; without it the server
 * group comes back empty instead of failing the drawer.
 * @param {{ sync: () => void, httpRequest?: (method: string, path: string, options?: object) => Promise<any> }} options
 */
export function createOpenfilmChannels({ sync, httpRequest }) {
  return {
    'openfilm:skills': async () => {
      try {
        const runtime = resolveOpenfilmRuntime({ env: process.env, bundleDir: bundleRoot })
        const native = []
        if (runtime) {
          const skillsDir = join(runtime.root, 'openfilm', 'node_modules', 'openfilm', 'skills')
          const cacheDir = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'tintin', 'cache', 'openfilm-skill-covers') : ''
          let entries = []
          try { entries = readdirSync(skillsDir, { withFileTypes: true }) } catch { entries = [] }
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const dir = join(skillsDir, entry.name)
            const meta = readSkillMeta(join(dir, 'SKILL.md'))
            let manifest = null
            try { manifest = JSON.parse(readFileSync(join(dir, 'openfilm.json'), 'utf8')) } catch { manifest = null }
            const name = String(manifest?.title?.['zh-CN'] || manifest?.title?.en || meta.name || '')
            if (!name) continue
            let cover = ''
            const coverFile = join(dir, String(manifest?.cover || 'cover.jpg'))
            if (cacheDir && existsSync(coverFile)) {
              try {
                mkdirSync(cacheDir, { recursive: true })
                cover = join(cacheDir, `${entry.name}.jpg`)
                if (!existsSync(cover)) copyFileSync(coverFile, cover)
              } catch { cover = '' }
            }
            native.push({
              id: entry.name,
              name,
              description: String(manifest?.summary?.['zh-CN'] || manifest?.summary?.en || meta.description || ''),
              kind: String(manifest?.kind || ''),
              order: Number(manifest?.order) || 100,
              cover,
            })
          }
          native.sort((left, right) => left.order - right.order)
        }
        const dshHome = process.env.DSH_HOME || ''
        let server = []
        if (typeof httpRequest === 'function') {
          try {
            const response = await httpRequest('GET', '/skills', { timeout: 8_000 })
            const list = Array.isArray(response?.data?.skills) ? response.data.skills : []
            server = list.map((skill) => {
              const installed = Boolean(dshHome && skill.id && existsSync(join(dshHome, 'skills', String(skill.id), 'SKILL.md')))
              const meta = installed ? readSkillMeta(join(dshHome, 'skills', String(skill.id), 'SKILL.md')) : null
              return {
                id: String(skill.id || ''),
                name: String(skill.name || skill.id || ''),
                description: String(skill.description || ''),
                installed,
                skillName: meta?.name || String(skill.name || skill.id || ''),
              }
            })
          } catch { server = [] }
        }
        return { native, server }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    'openfilm:projectFiles': async (args) => {
      try {
        const payload = args?.[0] ?? {}
        const files = listProjectFiles(payload.project)
        return { files }
      } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    },
    'openfilm:importFile': async (args) => {
      try {
        const payload = args?.[0] ?? {}
        const path = importProjectFile(payload.project, payload)
        return { path, project: payload.project }
      } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    },
    'openfilm:studio': async () => {
      try {
        sync()
        const runtime = resolveOpenfilmRuntime({ env: process.env, bundleDir: bundleRoot })
        if (!runtime) {
          return { error: 'OpenFilm 运行时未安装：请重装 TinTin 安装包（或先运行 node dsh-tintin-bundle/scripts/fetch-openfilm-runtime.mjs）' }
        }
        const run = await startStudio({
          runtime,
          homeDir: homedir(),
          folder: lastStudioProject(tintinStudioHome()),
          env: { ...process.env, OPENFILM_LIBRARY: libraryDir() },
        })
        return { url: run.url, origin: run.origin, project: run.project }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
