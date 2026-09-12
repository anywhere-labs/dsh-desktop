import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { businessEventSchema, type BusinessEvent } from './contracts.js'
import type { EventStore } from './ledger.js'

export const SUPPORTED_SCHEMA_VERSIONS = ['event.v1'] as const
export const DEFAULT_SCHEMA_VERSION = 'event.v1'

class SchemaVersionError extends Error {
  constructor(line: number, version: unknown) {
    super(`unsupported event schema version "${String(version)}" at line ${line}; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`)
    this.name = 'SchemaVersionError'
  }
}

function parseLine(line: string, index: number, allowed: readonly string[]): BusinessEvent {
  if (!line) throw new Error(`empty event log line ${String(index + 1)}`)
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch (cause) {
    throw new Error(`invalid event log line ${String(index + 1)}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`invalid event log line ${String(index + 1)}: not an object`)
  const version = (parsed as { readonly schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'string' || !allowed.includes(version)) throw new SchemaVersionError(index + 1, version)
  return businessEventSchema.parse(parsed)
}

function sanitizeTenant(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function readLines(filePath: string, allowed: readonly string[]): readonly BusinessEvent[] {
  if (!existsSync(filePath)) return []
  const raw = readFileSync(filePath, 'utf8')
  if (!raw) return []
  return raw.split('\n').filter(Boolean).map((line, index) => parseLine(line, index, allowed))
}

/** Single JSONL event store with schema-version validation on read. */
export class JsonlEventStore implements EventStore {
  constructor(readonly filePath: string, readonly allowedSchemaVersions: readonly string[] = SUPPORTED_SCHEMA_VERSIONS) {}

  read(): readonly BusinessEvent[] {
    return readLines(this.filePath, this.allowedSchemaVersions)
  }

  append(event: BusinessEvent): void {
    parseLine(JSON.stringify(event), 0, this.allowedSchemaVersions)
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
  }
}

/** Tenant-partitioned JSONL store: one file per tenant, plus schema-version validation. */
export class PartitionedJsonlEventStore implements EventStore {
  constructor(readonly baseDir: string, readonly allowedSchemaVersions: readonly string[] = SUPPORTED_SCHEMA_VERSIONS) {}

  private partition(event: { readonly tenantId: string }): string {
    return join(this.baseDir, `${sanitizeTenant(event.tenantId)}.events.jsonl`)
  }

  read(): readonly BusinessEvent[] {
    if (!existsSync(this.baseDir)) return []
    const events: BusinessEvent[] = []
    for (const name of readdirSync(this.baseDir).filter(name => name.endsWith('.events.jsonl')).sort()) {
      events.push(...readLines(join(this.baseDir, name), this.allowedSchemaVersions))
    }
    return events
  }

  append(event: BusinessEvent): void {
    parseLine(JSON.stringify(event), 0, this.allowedSchemaVersions)
    const file = this.partition(event)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
  }
}
