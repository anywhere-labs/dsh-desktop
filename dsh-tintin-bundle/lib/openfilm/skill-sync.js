// Bundled OpenFilm skill installation (2026-10-18): the skill ships with the
// TinTin bundle; the harness discovers user-level skills in
// <DSH_HOME>/skills/<name>/SKILL.md (skill-filesystem, user-dsh rank). Copy it
// on startup when absent, and refresh it when the installed copy is one of ours
// (the managed marker). A skill the person wrote themselves is never touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const OPENFILM_SKILL_NAME = 'openfilm'
/** Our copies carry this line; its absence means the file is not ours to replace. */
export const MANAGED_MARKER = '<!-- tintin-managed: openfilm skill -->'

/** The destination path: <DSH_HOME>/skills/openfilm/SKILL.md. */
export const skillInstallPath = (dshHome) => join(String(dshHome || ''), 'skills', OPENFILM_SKILL_NAME, 'SKILL.md')

/**
 * Install or refresh the bundled skill. Returns `{ path, status }` where status
 * is 'installed' (absent → written), 'updated' (ours, content changed),
 * 'current' (ours, identical), 'skipped' (a different skill owns the name), or
 * 'error'.
 * @param {{ dshHome: string, sourcePath: string }} options
 */
export function syncBundledSkill({ dshHome, sourcePath }) {
  const path = skillInstallPath(dshHome)
  let source
  try {
    source = readFileSync(sourcePath, 'utf8')
  } catch (error) {
    return { path, status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
  let existing = null
  try { existing = readFileSync(path, 'utf8') } catch { /* absent */ }
  if (existing !== null) {
    if (existing === source) return { path, status: 'current' }
    if (!existing.includes(MANAGED_MARKER)) return { path, status: 'skipped' }
    try {
      writeFileSync(path, source, 'utf8')
      return { path, status: 'updated' }
    } catch (error) {
      return { path, status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, source, 'utf8')
    return { path, status: 'installed' }
  } catch (error) {
    return { path, status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

/** True when the bundled source is readable (packaging sanity). */
export const skillSourceExists = (sourcePath) => existsSync(sourcePath)
