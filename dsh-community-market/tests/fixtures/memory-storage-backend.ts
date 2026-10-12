import type { KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/**
 * A `per-record` storage backend whose medium is a plain string map, so one
 * medium can be handed to two consecutive Host contexts and genuinely
 * round-trip through JSON. `@deepseek-ai/dsh-storage-json` is not installable
 * in this workspace, and an in-memory backend that stored live objects would
 * quietly pass on state that no real medium could carry.
 */
export class MemoryMedium {
  /** Document path → serialized document. */
  readonly documents = new Map<string, string>()

  /** Every document path currently present, for assertions about backups. */
  paths(): string[] {
    return [...this.documents.keys()].sort()
  }

  /** Overwrite one record document verbatim, to stage corruption on the medium. */
  writeRaw(unit: string, table: string, key: string, text: string): void {
    this.documents.set(`${unit}/${table}/${key}`, text)
  }
}

const SAFE_KEY = /^[a-zA-Z0-9_-]+$/u

interface StoredRecord {
  readonly version: number
  readonly value: unknown
}

class MemoryKvUnit implements KvUnit {
  private closed = false

  constructor(
    private readonly medium: MemoryMedium,
    private readonly descriptor: KvUnitDescriptor,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new Error(`unit '${this.descriptor.name}' is closed`)
  }

  private recordPath(table: string, key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`unsafe record key '${key}'`)
    if (!this.descriptor.tables.includes(table)) throw new Error(`undeclared table '${table}'`)
    return `${this.descriptor.name}/${table}/${key}`
  }

  private get globalPath(): string {
    return `${this.descriptor.name}/global`
  }

  private accepts(version: number): boolean {
    return version === this.descriptor.version
      || (this.descriptor.compatibleVersions ?? []).includes(version)
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>, global: unknown }> {
    this.assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) tables[table] = {}
    const prefix = `${this.descriptor.name}/`
    for (const [path, text] of this.medium.documents) {
      if (!path.startsWith(prefix) || path === this.globalPath) continue
      const [table, key] = path.slice(prefix.length).split('/')
      if (table === undefined || key === undefined) continue
      const bucket = tables[table]
      if (bucket === undefined) continue
      let stored: StoredRecord
      try {
        stored = JSON.parse(text) as StoredRecord
      } catch {
        // A per-record medium treats an unreadable document as absent.
        continue
      }
      if (!this.accepts(stored.version)) continue
      bucket[key] = stored.value
    }
    const globalText = this.medium.documents.get(this.globalPath)
    let global: unknown = null
    if (globalText !== undefined) {
      try {
        global = (JSON.parse(globalText) as StoredRecord).value
      } catch {
        global = null
      }
    }
    return { tables, global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    const stored: StoredRecord = { version: this.descriptor.version, value }
    this.medium.documents.set(this.recordPath(table, key), JSON.stringify(stored))
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    this.medium.documents.delete(this.recordPath(table, key))
  }

  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    const path = this.recordPath(table, key)
    const text = this.medium.documents.get(path)
    if (text === undefined) throw new Error(`no document at ${path}`)
    const moved = `${path}.bak`
    this.medium.documents.set(moved, text)
    this.medium.documents.delete(path)
    return moved
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) throw new Error(`unit '${this.descriptor.name}' has no global slot`)
    const stored: StoredRecord = { version: this.descriptor.version, value }
    this.medium.documents.set(this.globalPath, JSON.stringify(stored))
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

/**
 * Build a backend over one medium.
 * @param medium - the shared document map; reuse it to simulate a restart.
 * @returns the backend, ready for `ctx.storage.backend.register`.
 */
export function createMemoryBackend(medium: MemoryMedium): StorageBackend {
  const open = new Set<string>()
  return {
    kv: {
      async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
        if (open.has(descriptor.name)) throw new Error(`unit '${descriptor.name}' is already open`)
        open.add(descriptor.name)
        const unit = new MemoryKvUnit(medium, descriptor)
        const close = unit.close.bind(unit)
        unit.close = async () => {
          open.delete(descriptor.name)
          await close()
        }
        return unit
      },
    },
    async close(): Promise<void> {
      open.clear()
    },
  }
}
