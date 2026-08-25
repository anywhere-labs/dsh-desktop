import { describe, expect, it, vi } from 'vitest'
import {
  createDsh1024StoreAdapter,
  DSH_1024STORE_ADAPTER_ID,
  DSH_1024STORE_ENDPOINT,
  DSH_1024STORE_KEY,
  DSH_1024STORE_PROVIDER_ID,
} from '../src/adapters/dsh-1024store.js'
import { CatalogNetworkError } from '../src/network/restricted-http.js'
import type { CatalogHttpClient, CatalogFetchContext, LocalSourceRecord } from '../src/contracts/index.js'

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: DSH_1024STORE_KEY,
  enabled: true,
  order: 0,
}

function rawItem(index: number): Record<string, unknown> {
  const suffix = String(index).padStart(3, '0')
  return {
    id: `example/plugin-${suffix}`,
    name: `Plugin ${suffix}`,
    owner: 'example',
    url: `https://github.com/example/plugin-${suffix}`,
    category: index % 2 === 0 ? 'tools' : 'ui',
    description: { en: `Plugin ${suffix} summary.`, zh: `插件 ${suffix} 摘要。` },
    stars: 10 - index,
    installMethods: [{
      kind: 'npm',
      spec: `dsh-plugin-${suffix}`,
      verification: 'verified',
      code: 'repository_backlink',
      requiresBuildAllowance: false,
      revision: `1.0.${index}`,
    }],
  }
}

function catalogResponse(packages: readonly unknown[], meta: Record<string, unknown> = {}): {
  value: unknown
  finalUrl: string
} {
  return {
    value: { meta: { generatedAt: '2026-08-18T00:00:00.000Z', ...meta }, packages },
    finalUrl: DSH_1024STORE_ENDPOINT,
  }
}

function context(getJson: CatalogHttpClient['getJson']): CatalogFetchContext {
  const controller = new AbortController()
  return {
    source,
    signal: controller.signal,
    http: { getJson },
    media: { register: vi.fn(() => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') },
  }
}

function noSleep(): (delayMs: number, signal: AbortSignal) => Promise<void> {
  return vi.fn(async () => {})
}

function adapter() {
  return createDsh1024StoreAdapter({
    retryBaseDelayMs: 0,
    sleep: noSleep(),
    random: () => 0,
  })
}

describe('1024Store adapter against the capped v1 listing', () => {
  it('scans a partial catalog whose provider total exceeds the capped packages array', async () => {
    const packages = [rawItem(0), rawItem(1)]
    const getJson = vi.fn(async () => catalogResponse(packages, { total: 7 }))

    const snapshots = await adapter().scanCatalog!({}, context(getJson))

    const items = snapshots.flatMap(snapshot => snapshot.items)
    expect(items).toHaveLength(2)
    expect(snapshots.every(snapshot => snapshot.page.total === 2)).toBe(true)
  })

  it('tolerates a provider total below the received count by distrusting the metadata', async () => {
    const getJson = vi.fn(async () => catalogResponse([rawItem(0), rawItem(1), rawItem(2)], { total: 2 }))

    const snapshots = await adapter().scanCatalog!({}, context(getJson))

    const items = snapshots.flatMap(snapshot => snapshot.items)
    expect(items).toHaveLength(3)
    expect(snapshots.every(snapshot => snapshot.page.total === 3)).toBe(true)
    expect(getJson).toHaveBeenCalledOnce()
  })

  it('keeps advertising the provider total on complete fetch queries with locally bounded cursors', async () => {
    const packages = [rawItem(0), rawItem(1), rawItem(2)]
    const getJson = vi.fn(async () => catalogResponse(packages, { total: 4120 }))
    const ctx = context(getJson)

    const first = await adapter().fetch({ limit: 2 }, ctx)
    expect(first.items).toHaveLength(2)
    expect(first.page).toEqual({ total: 4120, nextCursor: '2' })

    const second = await adapter().fetch({ limit: 2, cursor: '2' }, ctx)
    expect(second.items).toHaveLength(1)
    expect(second.page).toEqual({ total: 4120 })

    const scoped = await adapter().fetch({ limit: 2, q: 'plugin' }, ctx)
    expect(scoped.page.total).toBe(3)
  })

  it('retries transient transport failures and succeeds on a later attempt', async () => {
    const ok = catalogResponse([rawItem(0)])
    const getJson = vi.fn(async () => {
      if (getJson.mock.calls.length === 1) throw new CatalogNetworkError('timeout')
      return ok
    })
    const sleep = noSleep()

    const snapshots = await createDsh1024StoreAdapter({
      retryBaseDelayMs: 100,
      sleep,
      random: () => 1,
    }).scanCatalog!({}, context(getJson))

    expect(snapshots.flatMap(snapshot => snapshot.items)).toHaveLength(1)
    expect(getJson).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(100, expect.any(AbortSignal))
  })

  it('gives up after the attempt budget and surfaces the last transport failure', async () => {
    const getJson = vi.fn(async () => {
      throw new CatalogNetworkError('http')
    })

    await expect(adapter().fetch({}, context(getJson))).rejects.toThrow('catalog request failed: http')
    expect(getJson).toHaveBeenCalledTimes(3)
  })

  it('does not retry deterministic refusals such as an origin-changing redirect', async () => {
    const getJson = vi.fn(async () => {
      throw new CatalogNetworkError('redirect')
    })

    await expect(adapter().fetch({}, context(getJson))).rejects.toThrow('catalog request failed: redirect')
    expect(getJson).toHaveBeenCalledOnce()
  })

  it('propagates an abort raised while waiting between retries', async () => {
    const getJson = vi.fn(async () => {
      throw new CatalogNetworkError('timeout')
    })
    const sleep = vi.fn(async (_delayMs: number, signal: AbortSignal) => {
      signal.throwIfAborted()
      throw new Error('sleep must reject when the scan is aborted')
    })

    await expect(createDsh1024StoreAdapter({ sleep }).fetch({}, context(getJson)))
      .rejects.toThrow()
    expect(getJson).toHaveBeenCalledOnce()
  })

  it('still rejects duplicate item ids during a scan', async () => {
    const packages = [rawItem(0), rawItem(0)]
    const getJson = vi.fn(async () => catalogResponse(packages))

    await expect(adapter().scanCatalog!({}, context(getJson)))
      .rejects.toThrow('1024Store catalog contains duplicate item IDs')
  })
})
