// Offline three.js for OpenFilm films (2026-10-18 用户裁决：例子依赖 jsDelivr
// 的 three.js 必须打包到客户端). The vendored closure lives in the runtime
// resources (tintin-resources/openfilm-libs/three, filled by
// fetch-openfilm-runtime.mjs); this module copies it to a stable, user-visible
// place — <DSH_HOME>/openfilm-libs/three — so the agent can copy it into a
// film's lib/ and point the page import map at local files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Package path → vendored path; the loaders' relative import (../libs/opentype) stays valid. */
export const THREE_FILES = [
  'three.module.js',
  'three.core.js',
  'addons/loaders/FontLoader.js',
  'addons/loaders/TTFLoader.js',
  'addons/libs/opentype.module.js',
  'LICENSE',
]

/** Where the agent finds the offline library: <DSH_HOME>/openfilm-libs/three. */
export const threeLibDir = (dshHome) => join(String(dshHome || ''), 'openfilm-libs', 'three')

/**
 * Copy the vendored three.js closure into <DSH_HOME>/openfilm-libs/three when
 * absent or on a version change. Returns `{ status, path }`:
 * 'installed' | 'current' | 'missing-source' (runtime not fetched yet).
 * @param {{ dshHome: string, runtimeRoot: string }} options
 */
export function syncOpenfilmLibs({ dshHome, runtimeRoot }) {
  const sourceRoot = join(String(runtimeRoot || ''), 'openfilm-libs', 'three')
  const targetRoot = threeLibDir(dshHome)
  const versionFile = join(sourceRoot, 'VERSION')
  if (!existsSync(versionFile) || !THREE_FILES.every((rel) => existsSync(join(sourceRoot, rel)))) {
    return { status: 'missing-source', path: targetRoot }
  }
  const version = readFileSync(versionFile, 'utf8').trim()
  const targetVersion = (() => { try { return readFileSync(join(targetRoot, 'VERSION'), 'utf8').trim() } catch { return '' } })()
  if (targetVersion === version && THREE_FILES.every((rel) => existsSync(join(targetRoot, rel)))) {
    return { status: 'current', path: targetRoot, version }
  }
  for (const rel of THREE_FILES) {
    const from = join(sourceRoot, rel)
    const to = join(targetRoot, rel)
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  writeFileSync(join(targetRoot, 'VERSION'), `${version}\n`)
  return { status: 'installed', path: targetRoot, version }
}
