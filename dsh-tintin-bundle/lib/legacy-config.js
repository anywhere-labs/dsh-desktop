// legacy-config — migrate the old TinTin client ("螺丝钉-电商智能体矩阵",
// appId com.tintin.electron.v3) config into the new harness settings seam.
// Scope per A2 裁决 (2026-09-23): config data only — server.url today; other
// domains (素材/草稿/任务/会话) are explicitly NOT migrated. Idempotent: once
// migrated, a marker in the new settings prevents re-reading the legacy file.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/** Keys we migrate, legacy config-store domain file → new settings path. */
const MIGRATIONS = [
  // All three observed server.json shapes flatten to one reader.
  { file: 'server.json', read: (j) => j?.url ?? j?.['server.url'] ?? j?.server_url, to: ['server', 'url'] },
]

/**
 * Locate the legacy config dir. The old client split-domain JSON lives under
 * <userData>/config; its userData used the package name (tintin-client-electron)
 * on this fleet — earlier packaged builds used the productName. First hit wins.
 * `appDataDir` is injected (testability); returns null when absent.
 */
export function findLegacyConfigDir(appDataDir) {
  if (!appDataDir) return null
  for (const dir of ['tintin-client-electron', '螺丝钉-电商智能体矩阵']) {
    const candidate = join(appDataDir, dir, 'config')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Read migratable values from the legacy config dir. Pure read, no writes.
 * Returns a flat list of { path, value } ops for the settings seam.
 * server.json shapes seen in the wild: {"server.url": "..."} flat dot-key,
 * plus nested {server:{url}} and server_url variants.
 */
export function readLegacyConfig(configDir) {
  const ops = []
  for (const m of MIGRATIONS) {
    const file = join(configDir, m.file)
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      const nested = raw && typeof raw === 'object' ? raw.server : undefined
      const value = m.read({ ...raw, ...(nested && typeof nested === 'object' ? nested : {}) })
      if (value) ops.push({ path: m.to, value })
    } catch { /* a malformed legacy file is skipped, not fatal */ }
  }
  return ops
}

/**
 * Plan the migration ops for the settings seam: legacy values that differ from
 * what is already configured. Pure; the caller applies via settings.mutate.
 */
export function planLegacyMigration(configDir, current) {
  return readLegacyConfig(configDir).filter(({ path, value }) => {
    const existing = path.reduce((acc, k) => (acc == null ? undefined : acc[k]), current)
    return existing !== value
  })
}

// ── 0.1.7 settings-yaml recovery ─────────────────────────────────────────────
// Harness 0.1.7 retired dsh-settings-file and renamed its store to
// <DSH_HOME>/settings.yaml.imported; the upstream migration carried only
// upstream namespaces (presets, llm-pi-ai, default-model) into the profile
// config and stranded TinTin's own tintin-bundle section (server.url /
// provisioned, local.cacheDir). Without it the server bridge silently falls
// back to the built-in deployment-server default (定制版=192.168.111.31:8000，
// 2026-10-12 裁决前为 127.0.0.1:8766 占位) and every business route 502s.
// Recovery = fill still-empty leaves from the renamed store, once.

/**
 * Read the stranded tintin-bundle section from the renamed settings store.
 * Pure read; null when the file or section is absent/malformed.
 */
export function readImportedTintinSection(importedPath) {
  try {
    if (!importedPath || !existsSync(importedPath)) return null
    const doc = load(readFileSync(importedPath, 'utf8'))
    const section = doc && typeof doc === 'object' ? doc['tintin-bundle'] : undefined
    return section && typeof section === 'object' ? section : null
  } catch { /* a malformed imported store is skipped, not fatal */ }
  return null
}

/** Flatten nested plain objects into dotted-leaf ops; non-plain values are skipped. */
function leafOps(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const path = [...prefix, key]
    if (value && typeof value === 'object' && !Array.isArray(value)) leafOps(value, path, out)
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out.push({ path, value })
  }
  return out
}

/**
 * Plan recovery ops: imported leaves whose current config counterpart is
 * unset (''/undefined). Never overwrites a value the user re-set after the
 * upgrade; idempotent once every leaf is filled. Pure.
 */
export function planImportedSettingsRecovery(section, current) {
  if (!section || typeof section !== 'object') return []
  return leafOps(section, [], []).filter(({ path }) => {
    const existing = path.reduce((acc, k) => (acc == null ? undefined : acc[k]), current)
    return existing === undefined || existing === ''
  })
}
