// OpenFilm host wiring (2026-10-18 用户裁决 A/独立窗口): the pieces index.js
// composes — asset sync (skill + provider service) and the Studio channel.
// Kept here so the host entry stays within its locked line baseline (铁律 4:
// 自己功能增长走提取付账).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncProvidersFile } from './providers-seed.js'
import { resolveOpenfilmRuntime, startStudio } from './studio-runtime.js'
import { syncBundledSkill } from './skill-sync.js'

/** This package's root (lib/openfilm/ → ../../). */
const bundleRoot = fileURLToPath(new URL('../../', import.meta.url))
const skillSource = join(bundleRoot, 'resources', 'skills', 'openfilm', 'SKILL.md')

/**
 * One idempotent sync of the two bundled artifacts: the skill (into
 * <DSH_HOME>/skills/openfilm, managed marker) and the `tintin` custom service
 * (into ~/.openfilm/providers.json, current server.url). Never throws — an
 * OpenFilm problem must not take the session bridge down.
 * @param {{ getServerUrl: () => string, logger?: { info: Function, warn: Function } }} options
 */
export function createOpenfilmSync({ getServerUrl, logger = console }) {
  return () => {
    const dshHome = process.env.DSH_HOME
    if (dshHome) {
      const skill = syncBundledSkill({ dshHome, sourcePath: skillSource })
      if (skill.status === 'installed' || skill.status === 'updated') logger.info('tintin-bundle: openfilm skill %s at %s', skill.status, skill.path)
      else if (skill.status === 'error') logger.warn('tintin-bundle: openfilm skill sync failed: %s', skill.error)
    }
    let serverUrl = ''
    try { serverUrl = getServerUrl() } catch { serverUrl = '' }
    if (!serverUrl) return
    try {
      const seeded = syncProvidersFile({ homeDir: homedir(), serverUrl })
      if (seeded.changed) logger.info('tintin-bundle: openfilm service seeded at %s', seeded.path)
    } catch (error) {
      logger.warn('tintin-bundle: openfilm provider seed failed: %s', error?.message ?? error)
    }
  }
}

/**
 * `openfilm:studio` — start (or attach to) Studio and return the address the
 * desktop shell opens in its own window. The CLI detaches Studio and would
 * otherwise open the system browser; startStudio sets OPENFILM_NO_BROWSER=1.
 * @param {{ sync: () => void }} options
 */
export function createOpenfilmChannels({ sync }) {
  return {
    'openfilm:studio': async () => {
      try {
        sync()
        const runtime = resolveOpenfilmRuntime({ env: process.env, bundleDir: bundleRoot })
        if (!runtime) {
          return { error: 'OpenFilm 运行时未安装：请重装 TinTin 安装包（或先运行 node dsh-tintin-bundle/scripts/fetch-openfilm-runtime.mjs）' }
        }
        const run = await startStudio({ runtime, homeDir: homedir() })
        return { url: run.url, origin: run.origin }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
