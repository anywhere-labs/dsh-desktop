/** Changes to the configured catalog sources: add, remove, reorder and select, persisted in one transaction. */

import { randomUUID } from 'node:crypto'
import type { CatalogSourceManifest } from '../contracts/index.js'
import { parseCatalogSource, validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogHttpClient } from '../contracts/types.js'
import type { MarketBuiltInProvider, MarketSourceMutation } from '../api-types.js'
import { restrictedHttpClient } from '../network/restricted-http.js'
import { assertStandardSourceTrustRoot } from '../adapters/standard-http.js'
import { BUILT_IN_PROVIDERS } from '../catalog/service.js'
import { PersistentCatalogSourceStore } from '../catalog/source-store.js'
import type { MarketStateStore } from '../catalog/state-store.js'

export function viewBuiltIns(): readonly MarketBuiltInProvider[] {
  return BUILT_IN_PROVIDERS.map(provider => ({ ...provider }))
}

export async function readStandardSourceManifest(
  manifestUrl: string,
  signal: AbortSignal,
  http: CatalogHttpClient = restrictedHttpClient,
): Promise<CatalogSourceManifest> {
  const url = new URL(manifestUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('manifest URL must use credential-free standard HTTPS port 443')
  }
  const response = await http.getJson(url.href, signal, { allowedOrigin: url.origin })
  const manifest = parseCatalogSource(response.value)
  assertStandardSourceTrustRoot(url.href, response.finalUrl, manifest.transport.endpoint)
  return manifest
}

async function mutateSources(
  state: MarketStateStore,
  mutation: MarketSourceMutation,
  signal: AbortSignal,
  onUnavailable?: (sourceRecordId: string) => void,
  readManifest: (
    manifestUrl: string,
    signal: AbortSignal,
  ) => Promise<CatalogSourceManifest> = readStandardSourceManifest,
): Promise<void> {
  signal.throwIfAborted()
  const store = new PersistentCatalogSourceStore(state)
  const records = [...await store.load()]
  const unavailableSourceRecordIds = new Set<string>()
  const nextOrder = records.reduce((maximum, record) => Math.max(maximum, record.order), -1) + 1
  const builtInKey = mutation.action === 'add-builtin' ? mutation.key : undefined
  if (builtInKey !== undefined) {
    const provider = BUILT_IN_PROVIDERS.find(candidate => candidate.key === builtInKey)
    if (provider === undefined) throw new Error('built-in source unavailable')
    if (records.some(record => record.builtInProviderKey === builtInKey)) throw new Error('source already added')
    records.push({
      sourceRecordId: randomUUID(),
      registrationKind: 'built-in',
      adapterId: provider.adapterId,
      providerId: provider.providerId,
      builtInProviderKey: builtInKey,
      enabled: false,
      order: nextOrder,
    })
  } else if (mutation.action === 'add-standard') {
    const manifest = await readManifest(mutation.manifestUrl, signal)
    signal.throwIfAborted()
    if (records.some(record => record.manifestUrl === mutation.manifestUrl)) throw new Error('source already added')
    records.push({
      sourceRecordId: randomUUID(),
      registrationKind: 'user-added',
      adapterId: 'market.standard-http-v1',
      providerId: manifest.providerId,
      manifestUrl: mutation.manifestUrl,
      manifest,
      enabled: false,
      order: nextOrder,
    })
  } else if (mutation.action === 'select' || mutation.action === 'remove') {
    const index = records.findIndex(record => record.sourceRecordId === mutation.sourceRecordId)
    if (index < 0) throw new Error('source not found')
    if (mutation.action === 'remove') {
      unavailableSourceRecordIds.add(records[index]!.sourceRecordId)
      records.splice(index, 1)
      records.sort((left, right) => left.order - right.order)
      records.forEach((record, order) => { records[order] = { ...record, order } })
    } else {
      for (const [recordIndex, record] of records.entries()) {
        const enabled = record.sourceRecordId === mutation.sourceRecordId
        if (record.enabled && !enabled) unavailableSourceRecordIds.add(record.sourceRecordId)
        records[recordIndex] = { ...record, enabled }
      }
    }
  } else if (mutation.action === 'move') {
    const ordered = [...records].sort((left, right) => left.order - right.order)
    const index = ordered.findIndex(record => record.sourceRecordId === mutation.sourceRecordId)
    if (index < 0) throw new Error('source not found')
    const targetIndex = mutation.direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= ordered.length) throw new Error('source cannot move further')
    const current = ordered[index]!
    const target = ordered[targetIndex]!
    const currentRecordIndex = records.findIndex(record => record.sourceRecordId === current.sourceRecordId)
    const targetRecordIndex = records.findIndex(record => record.sourceRecordId === target.sourceRecordId)
    records[currentRecordIndex] = { ...current, order: target.order }
    records[targetRecordIndex] = { ...target, order: current.order }
  } else {
    throw new Error('source mutation is invalid')
  }
  validateLocalSourceRecords(records)
  signal.throwIfAborted()
  await store.save(records)
  for (const sourceRecordId of unavailableSourceRecordIds) onUnavailable?.(sourceRecordId)
}

export function createMarketSourceMutator(
  state: MarketStateStore,
  onUnavailable?: (sourceRecordId: string) => void,
  readManifest?: (manifestUrl: string, signal: AbortSignal) => Promise<CatalogSourceManifest>,
): (
  mutation: MarketSourceMutation,
  signal: AbortSignal,
) => Promise<void> {
  let tail = Promise.resolve()
  return (mutation, signal) => {
    const pending = tail.then(async () => {
      signal.throwIfAborted()
      await mutateSources(state, mutation, signal, onUnavailable, readManifest)
    })
    tail = pending.catch(() => {})
    return pending
  }
}
