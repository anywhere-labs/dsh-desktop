// OpenFilm projects library (2026-10-18 用户裁决：默认目录改为本客户端默认目录).
// OpenFilm keeps the person's chosen new-projects folder in ~/.openfilm/prefs.json
// (`projectsFolder`, read fresh by Studio and the CLI; OPENFILM_LIBRARY is only
// the fallback default). Seeding it here points the integrated Studio — including
// the already-running desktop app's Studio — at the TinTin workspace the agent
// already works in, so films the agent writes show up where the person opens them.
// A folder the person chose themselves is never replaced.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** The preferences file shared by every OpenFilm on this computer: ~/.openfilm/prefs.json. */
export const openfilmPrefsPath = (homeDir) => join(String(homeDir || ''), '.openfilm', 'prefs.json')

/**
 * Point OpenFilm's new-projects library at `libraryDir` when it has no choice of
 * its own. A value this integration set before (`tintinProjectsFolder` marker) is
 * migrated to the new target; a folder the person chose themselves is kept.
 * Returns `{ status, path, folder }`: 'installed' (written), 'current' (already
 * there), 'kept' (the person chose another folder — untouched), or 'invalid'
 * (no absolute library dir).
 * @param {{ homeDir: string, libraryDir: string }} options
 */
export function syncOpenfilmLibrary({ homeDir, libraryDir, prefsPath }) {
  const target = String(libraryDir || '').trim()
  if (!isAbsolute(target)) return { status: 'invalid', path: prefsPath || openfilmPrefsPath(homeDir), folder: target }
  const folder = resolve(target)
  const path = prefsPath || openfilmPrefsPath(homeDir)
  let prefs = {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prefs = parsed
  } catch { /* absent or broken: start from an empty document */ }
  const chosen = typeof prefs.projectsFolder === 'string' ? prefs.projectsFolder.trim() : ''
  const ours = typeof prefs.tintinProjectsFolder === 'string' ? prefs.tintinProjectsFolder.trim() : ''
  if (chosen && !(ours && resolve(chosen) === resolve(ours))) {
    return { status: resolve(chosen) === folder ? 'current' : 'kept', path, folder: chosen }
  }
  if (chosen && ours && resolve(chosen) === resolve(ours) && resolve(chosen) === folder) {
    return { status: 'current', path, folder }
  }
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(folder, { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify({ ...prefs, projectsFolder: folder, tintinProjectsFolder: folder }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  return { status: 'installed', path, folder }
}
