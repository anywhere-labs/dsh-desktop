import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { LocalSourceRecord } from '../contracts/types.js'
import { normalizeActiveSourceRecords } from './source-store.js'

/**
 * Section keys market's registry may sit under in a pre-0.1.7 `settings.yaml`.
 *
 * `dsh-community-market` is the namespace the old `ctx.settings.register` call
 * used (the package name). `community-market` is the Loader entry id, which is
 * what 0.1.7 keys settings entries by — the one mapping core's own legacy
 * importer would have needed and does not have.
 */
const LEGACY_SECTION_KEYS = ['dsh-community-market', 'community-market'] as const

/**
 * Files that can hold the pre-0.1.7 document, newest-first.
 *
 * Core's `SettingsForms` renames `settings.yaml` to `settings.yaml.imported`
 * before it attempts any section, and that rename runs after the Loader
 * settles — i.e. after market has applied. Market therefore cannot assume
 * either name is the live one and reads whichever it finds.
 */
const LEGACY_DOCUMENT_NAMES = ['settings.yaml', 'settings.yaml.imported'] as const

/** One recovered legacy registry and the file it came from. */
export interface LegacyMarketSources {
  readonly records: readonly LocalSourceRecord[]
  /** Optional npm install origin from the same pre-0.1.7 section. */
  readonly npmRegistry?: string
  readonly from: string
}

interface LegacySection {
  readonly sources?: readonly unknown[]
  readonly npmRegistry?: string
}

function extractSection(document: unknown, onWarn: (message: string) => void, path: string): LegacySection | undefined {
  if (typeof document !== 'object' || document === null) return undefined
  const sections = document as Record<string, unknown>
  for (const key of LEGACY_SECTION_KEYS) {
    const section = sections[key]
    if (typeof section !== 'object' || section === null) continue
    const record = section as Record<string, unknown>
    const sources = Array.isArray(record.sources) ? record.sources : undefined
    let npmRegistry: string | undefined
    if (typeof record.npmRegistry === 'string') npmRegistry = record.npmRegistry
    else if (record.npmRegistry !== undefined) {
      onWarn(`dsh-community-market: legacy npmRegistry in ${path} is not a string and was not migrated`)
    }
    if (sources === undefined && npmRegistry === undefined) continue
    return {
      ...(sources === undefined ? {} : { sources }),
      ...(npmRegistry === undefined ? {} : { npmRegistry }),
    }
  }
  return undefined
}

/**
 * Recover market's source registry from a pre-0.1.7 settings document.
 *
 * Every failure mode resolves to `undefined` rather than throwing: a missing
 * file, unparseable YAML, an absent market section, or records that no longer
 * satisfy the local-source contract. A one-time migration must never be able to
 * stop market from starting.
 *
 * The catalogue cache is deliberately not recovered. It expires after 24 hours
 * and regenerates on the first browse, so carrying a possibly-multi-megabyte
 * stale blob across the migration buys nothing. An optional `npmRegistry`
 * string in the same section is recovered; package verification still ignores it.
 * @param home - the harness home directory holding the legacy document.
 * @param onWarn - receives one line per recoverable problem.
 * @returns the recovered registry, or `undefined` when there is nothing to migrate.
 */
export async function readLegacyMarketSources(
  home: string,
  onWarn: (message: string) => void = () => {},
): Promise<LegacyMarketSources | undefined> {
  for (const name of LEGACY_DOCUMENT_NAMES) {
    const path = join(home, name)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    let section: LegacySection | undefined
    try {
      section = extractSection(parse(text), onWarn, path)
    } catch (cause) {
      onWarn(`dsh-community-market: could not parse ${path} while looking for legacy sources: ${
        cause instanceof Error ? cause.message : String(cause)
      }`)
      continue
    }
    if (section === undefined) continue
    let records: readonly LocalSourceRecord[] = []
    if (section.sources !== undefined && section.sources.length > 0) {
      try {
        records = normalizeActiveSourceRecords(section.sources as readonly LocalSourceRecord[])
        validateLocalSourceRecords(records)
      } catch (cause) {
        onWarn(`dsh-community-market: legacy sources in ${path} did not satisfy the local-source contract and were not migrated: ${
          cause instanceof Error ? cause.message : String(cause)
        }`)
        records = []
      }
    }
    const npmRegistry = section.npmRegistry === '' ? undefined : section.npmRegistry
    if (records.length === 0 && npmRegistry === undefined) continue
    return { records, ...(npmRegistry === undefined ? {} : { npmRegistry }), from: path }
  }
  return undefined
}
