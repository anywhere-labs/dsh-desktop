/** Compatibility agent presets for Sessions persisted under a renamed preset id. */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parse, stringify } from 'yaml'

/** The preset directory holding the alias presets the launcher materializes. */
export const COMPAT_PRESET_DIRNAME = 'agent-preset-compat'

/** The optional display-metadata file beside a preset's composition (`agent-presets/metadata`). */
const PRESET_METADATA_FILE = 'preset.yml'

/**
 * Preset ids a persisted Session may still carry, mapped to the shipped
 * preset that replaced them.
 *
 * Upstream renamed the PTC preset directory from `code` to `ptc` without a
 * compatibility alias — a deliberate pre-release stance recorded in the
 * rename's Agent Note — while a Session's header and `agentPreset`
 * projection keep the id it started with. Every Session created before the
 * rename therefore fails to resume against the renamed runtime with
 * `agent-presets: preset "code" not found`, and no upstream migration exists
 * to rewrite it. The launcher materializes each alias as a real preset
 * directory instead, so those Sessions mount the composition they always ran
 * and new Sessions keep choosing the renamed id.
 */
export const LEGACY_PRESET_ALIASES: Readonly<Record<string, string>> = {
  code: 'ptc',
}

export interface LegacyPresetAliasOptions {
  /** The shipped preset root the pinned runtime reads. */
  readonly shippedRoot: string
  /** Desktop-owned directory the alias presets are materialized into. */
  readonly compatRoot: string
}

/**
 * Copy one read-only preset tree using the ASAR-aware filesystem operations
 * Electron supports for directories and individual files.
 *
 * Electron's `cpSync` bridge tries to extract its source as one file. That
 * cannot represent a directory inside `app.asar`, while `readdirSync` and
 * `copyFileSync` retain Electron's normal virtual-filesystem semantics.
 */
function copyPresetTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true })
  const entries = readdirSync(source, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = join(entry.parentPath, entry.name)
    const targetPath = join(target, relative(source, sourcePath))
    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true })
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`dsh-plugin-desktop: shipped agent preset contains an unsupported entry at ${sourcePath}`)
    }
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)
  }
}

/**
 * Materialize one alias preset per renamed id that the shipped root no
 * longer supplies.
 *
 * Each alias is a verbatim copy of the shipped preset it points at — the
 * composition mounts exactly what the renamed preset mounts, and relative
 * references inside the preset directory (skills) travel with the copy —
 * with rewritten display metadata so a picker can tell the alias from the
 * preset it shadows. Copying from the shipped root on every preparation
 * keeps the alias in lock-step with the pinned runtime's composition, and
 * an id the shipped root supplies again (or never renamed) materializes
 * nothing, letting the shipped roster stand alone.
 * @param options - the shipped root to copy from and the desktop-owned root
 * to materialize into.
 * @returns the compat root to append after the shipped root, or undefined
 * when no alias is needed and the root must not be configured.
 */
export function materializeLegacyPresetAliases(options: LegacyPresetAliasOptions): string | undefined {
  const { shippedRoot, compatRoot } = options
  let materialized = false
  for (const [legacyId, shippedId] of Object.entries(LEGACY_PRESET_ALIASES)) {
    if (existsSync(join(shippedRoot, legacyId))) continue
    const source = join(shippedRoot, shippedId)
    if (!existsSync(source)) continue
    const target = join(compatRoot, legacyId)
    rmSync(target, { recursive: true, force: true })
    copyPresetTree(source, target)
    writeFileSync(join(target, PRESET_METADATA_FILE), aliasMetadata(source, legacyId, shippedId))
    materialized = true
  }
  return materialized ? compatRoot : undefined
}

/**
 * Display metadata that marks one materialized alias as a compatibility
 * preset.
 *
 * The display name trails the shipped preset's own so the two read as a pair
 * in a picker, while the description names the legacy id a resumed Session
 * carries. Reading the shipped metadata mirrors discovery's own tolerance:
 * an absent or unparsable file degrades to the shipped id, never to a failed
 * preparation.
 * @param source - shipped preset directory the alias was copied from.
 * @param legacyId - the preset id the alias restores.
 * @param shippedId - the shipped preset id the alias points at.
 * @returns the alias `preset.yml` document as YAML text.
 */
function aliasMetadata(source: string, legacyId: string, shippedId: string): string {
  let shippedName: string | undefined
  try {
    const parsed = parse(readFileSync(join(source, PRESET_METADATA_FILE), 'utf8')) as {
      name?: unknown
    } | null
    const name = parsed?.name
    if (typeof name === 'string' && name.trim() !== '') shippedName = name.trim()
  } catch {
    // Discovery degrades absent and unparsable metadata to no name; the alias degrades the same way.
  }
  const displayName = shippedName ?? shippedId
  return stringify({
    name: `${displayName}（兼容）`,
    description: `兼容别名：用于恢复以旧版 "${legacyId}" 预设创建的会话；新会话请选择 ${displayName}。`,
  })
}
