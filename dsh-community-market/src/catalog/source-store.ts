import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogSourceStore, LocalSourceRecord } from '../contracts/types.js'
import type { MarketStateStore } from './state-store.js'

/**
 * Reconcile legacy multi-enabled registries into the single active-source
 * model. The first enabled record by user order wins. An all-disabled registry
 * keeps its explicit no-selection state.
 */
export function normalizeActiveSourceRecords(
  records: readonly LocalSourceRecord[],
): readonly LocalSourceRecord[] {
  const ordered = [...records].sort((left, right) => left.order - right.order)
  const activeSourceRecordId = ordered.find(record => record.enabled)?.sourceRecordId
  return ordered.map(record => ({
    ...record,
    enabled: record.sourceRecordId === activeSourceRecordId,
  }))
}

/**
 * The catalogue's view of market's persisted registry. Validation stays here
 * rather than at the durable boundary: the storage schema answers "is this the
 * right shape", the local-source contract answers "is this a registry market is
 * willing to act on", and only the second one is allowed to reject.
 */
export class PersistentCatalogSourceStore implements CatalogSourceStore {
  constructor(private readonly state: MarketStateStore) {}

  async load(): Promise<readonly LocalSourceRecord[]> {
    const records = [...this.state.getSources()]
    validateLocalSourceRecords(records)
    return normalizeActiveSourceRecords(records)
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    await this.state.setSources(normalized)
  }
}

export class MemoryCatalogSourceStore implements CatalogSourceStore {
  private records: readonly LocalSourceRecord[] = []

  async load(): Promise<readonly LocalSourceRecord[]> {
    return this.records
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    this.records = normalized.map(record => ({ ...record }))
  }
}
