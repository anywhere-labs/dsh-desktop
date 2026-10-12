import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { stringify } from 'yaml'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import { activateMarketDurableState, marketDomainSpec } from '../src/catalog/domain.js'
import { PersistentCatalogSourceStore } from '../src/catalog/source-store.js'
import { DeferredMarketStateStore, type MarketCatalogCache } from '../src/catalog/state-store.js'
import type { LocalSourceRecord } from '../src/contracts/index.js'
import { MemoryMedium, createMemoryBackend } from './fixtures/memory-storage-backend.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: 'dsh-1024store',
  enabled: true,
  order: 0,
}

const catalogCache: MarketCatalogCache = {
  version: 1,
  sourceRecordId: source.sourceRecordId,
  locale: 'en',
  savedAt: '2026-01-01T00:00:00.000Z',
  snapshot: { kind: 'fixture' } as never,
  categories: ['agents'],
  scannedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-02T00:00:00.000Z',
}

interface Boot {
  readonly ctx: Context
  readonly state: DeferredMarketStateStore
  readonly warnings: string[]
  dispose(): Promise<void>
}

/**
 * Bring up one Host context over a medium and activate market's durable state,
 * exactly as `apply` does once `storageDomain` resolves.
 */
async function bootMarketState(medium: MemoryMedium, profileHome?: string): Promise<Boot> {
  const ctx = new Context()
  const warnings: string[] = []
  Object.defineProperty(ctx, 'logger', {
    configurable: true,
    value: {
      warn: (message: string) => { warnings.push(message) },
      error: (message: string) => { warnings.push(message) },
      info: () => {},
    },
  })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', createMemoryBackend(medium))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  if (profileHome !== undefined) ctx.provide('profileContext', { home: profileHome, name: 'default' })
  const state = new DeferredMarketStateStore(message => { warnings.push(message) })
  const close = await activateMarketDurableState(ctx, state)
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await close()
  }
  cleanups.push(dispose)
  return { ctx, state, warnings, dispose }
}

async function temporaryHome(sections: Record<string, unknown>, fileName = 'settings.yaml'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-home-'))
  cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
  await writeFile(join(dir, fileName), stringify(sections), 'utf8')
  return dir
}

describe('community market durable state', () => {
  it('restores sources in a new Host context', async () => {
    const medium = new MemoryMedium()
    const first = await bootMarketState(medium)
    await new PersistentCatalogSourceStore(first.state).save([source])
    await first.dispose()

    const second = await bootMarketState(medium)
    expect(second.state.getSources()).toEqual([source])
    await expect(new PersistentCatalogSourceStore(second.state).load()).resolves.toEqual([source])
  })

  it('restores the catalog cache independently of the source registry', async () => {
    const medium = new MemoryMedium()
    const first = await bootMarketState(medium)
    await first.state.setSources([source])
    await first.state.setCatalogCache(catalogCache)
    await first.dispose()

    const second = await bootMarketState(medium)
    expect(second.state.getCatalogCache()).toEqual(catalogCache)
    expect(second.state.getSources()).toEqual([source])
  })

  it('keeps another consumer of the same medium intact while persisting market state', async () => {
    const siblingSpec = defineDomain({
      name: 'market_persistence_fixture',
      version: 1,
      layout: 'per-record',
      tables: { labels: domainTable<'only', { label: string }>(z.object({ label: z.string() })) },
    })
    const medium = new MemoryMedium()

    const first = await bootMarketState(medium)
    const firstSibling = await first.ctx.storageDomain.open(siblingSpec)
    await firstSibling.table('labels').put('only', { label: 'retained across restart' })
    await firstSibling.close()
    await new PersistentCatalogSourceStore(first.state).save([source])
    await first.dispose()

    const second = await bootMarketState(medium)
    const secondSibling = await second.ctx.storageDomain.open(siblingSpec)
    expect(secondSibling.table('labels').get('only')).toEqual({ label: 'retained across restart' })
    expect(second.state.getSources()).toEqual([source])
    await secondSibling.close()
  })

  it('survives a catalog cache record that is corrupt on the medium', async () => {
    const medium = new MemoryMedium()
    const first = await bootMarketState(medium)
    await first.state.setSources([source])
    await first.state.setCatalogCache(catalogCache)
    await first.dispose()

    medium.writeRaw(marketDomainSpec.name, 'catalog_cache', 'current', JSON.stringify({
      version: 1,
      value: { version: 1, sourceRecordId: 42 },
    }))

    const second = await bootMarketState(medium)
    // The registry is authoritative and still readable; the disposable cache is
    // moved aside rather than taking the whole domain down with it.
    expect(second.state.getSources()).toEqual([source])
    expect(second.state.getCatalogCache()).toBeUndefined()
    expect(medium.paths()).toContain(`${marketDomainSpec.name}/catalog_cache/current.bak`)
  })

  it('imports a pre-0.1.7 settings document exactly once', async () => {
    const home = await temporaryHome({ 'dsh-community-market': { sources: [source] } })
    const medium = new MemoryMedium()

    const first = await bootMarketState(medium, home)
    expect(first.state.getSources()).toEqual([source])
    await first.dispose()

    // The user then clears the registry. A second boot must respect that rather
    // than resurrecting the legacy document.
    const second = await bootMarketState(medium, home)
    await second.state.setSources([])
    await second.dispose()

    const third = await bootMarketState(medium, home)
    expect(third.state.getSources()).toEqual([])
  })

  it('imports from the file core renamed aside when it never adopted market settings', async () => {
    const home = await temporaryHome(
      { 'dsh-community-market': { sources: [source] } },
      'settings.yaml.imported',
    )
    const boot = await bootMarketState(new MemoryMedium(), home)
    expect(boot.state.getSources()).toEqual([source])
  })

  it('imports a document keyed by the Loader entry id', async () => {
    const home = await temporaryHome({ 'community-market': { sources: [source] } })
    const boot = await bootMarketState(new MemoryMedium(), home)
    expect(boot.state.getSources()).toEqual([source])
  })

  it('never lets a malformed legacy document block startup', async () => {
    const home = await temporaryHome({
      'dsh-community-market': { sources: [{ ...source, sourceRecordId: 'not-a-uuid' }] },
    })
    const boot = await bootMarketState(new MemoryMedium(), home)

    expect(boot.state.getSources()).toEqual([])
    expect(boot.warnings.some(line => line.includes('did not satisfy the local-source contract'))).toBe(true)
  })

  it('leaves a durable registry untouched when there is no legacy document', async () => {
    const home = await temporaryHome({ 'some-other-plugin': { label: 'unrelated' } })
    const medium = new MemoryMedium()
    const first = await bootMarketState(medium, home)
    await first.state.setSources([source])
    await first.dispose()

    const second = await bootMarketState(medium, home)
    expect(second.state.getSources()).toEqual([source])
  })

  it('releases the domain name when the owning effect disposes', async () => {
    const medium = new MemoryMedium()
    const boot = await bootMarketState(medium)
    await boot.dispose()
    // A second activation on the same facility would reject with `already-open`
    // if the caller had not closed the handle it owns.
    const reopened = await bootMarketState(medium)
    expect(reopened.state.isDurable).toBe(true)
  })
})
