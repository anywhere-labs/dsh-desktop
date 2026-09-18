import { describe, expect, it, vi } from 'vitest'
import {
  DSH_1024STORE_ADAPTER_ID,
  DSH_1024STORE_KEY,
  DSH_1024STORE_PROVIDER_ID,
  dsh1024StoreAdapter,
} from '../src/adapters/dsh-1024store.js'
import type { CatalogHttpClient, CatalogSnapshot, LocalSourceRecord } from '../src/contracts/index.js'

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: DSH_1024STORE_KEY,
  enabled: true,
  order: 0,
}

const baseItem = {
  id: 'omdsh-dev/DSH-better-sidebar',
  name: 'DSH Better Sidebar',
  owner: 'omdsh-dev',
  url: 'https://github.com/omdsh-dev/DSH-better-sidebar',
  category: 'ui',
  description: { en: 'A better sidebar.' },
  install: 'dsh plugin --profile web add dsh-better-sidebar',
  stars: 10,
}

function categoriesFor(items: readonly Record<string, unknown>[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const category = typeof item.category === 'string' ? item.category : 'unclassified'
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts].map(([id, count]) => ({ id, en: id, zh: id, count }))
}

function v2Page(
  plugins: readonly unknown[],
  options: {
    readonly page?: number
    readonly limit?: number
    readonly total?: number
    readonly catalogTotal?: number
    readonly categories?: readonly unknown[]
    readonly generatedAt?: string
  } = {},
) {
  const records = plugins.filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
  const limit = options.limit ?? 50
  const total = options.total ?? plugins.length
  const catalogTotal = options.catalogTotal ?? total
  return {
    plugins,
    page: options.page ?? 1,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    catalogTotal,
    categories: options.categories ?? categoriesFor(records),
    generatedAt: options.generatedAt ?? '2026-08-25T00:00:00.000Z',
    source: 'fixture',
  }
}

async function adapt(install: string, itemOverrides: Record<string, unknown> = {}) {
  const http: CatalogHttpClient = {
    getJson: vi.fn(async (url: string) => ({
      value: v2Page([{ ...baseItem, ...itemOverrides, install }]),
      finalUrl: url,
    })),
  }
  return await dsh1024StoreAdapter.fetch({}, {
    source,
    signal: new AbortController().signal,
    http,
    media: { register: () => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  })
}

describe('1024Store v2 install target normalization', () => {
  it.each([
    ['plain package', 'dsh plugin --profile web add dsh-better-sidebar', 'dsh-better-sidebar'],
    ['scoped package', 'dsh plugin --profile desktop add @scope/dsh-plugin', '@scope/dsh-plugin'],
    ['provider latest tag', 'dsh plugin --profile web add dsh1024@latest', 'dsh1024'],
  ] as const)('projects the npm identity from a %s without retaining the command', async (_label, install, name) => {
    const snapshot = await adapt(install)

    expect(snapshot.items[0]).toMatchObject({ package: { registry: 'npm', name } })
    expect(snapshot.items[0]).not.toHaveProperty('latestVersion')
    expect(JSON.stringify(snapshot)).not.toContain(install)
  })

  it.each([
    ['GitHub source', 'dsh plugin --profile web add github:omdsh-dev/DSH-better-sidebar'],
    ['build allowance', 'dsh plugin --profile web add --allow-build=sidebar dsh-better-sidebar'],
    ['extra argument', 'dsh plugin --profile web add dsh-better-sidebar extra'],
    ['shell syntax', 'dsh plugin --profile web add dsh-better-sidebar;whoami'],
    ['non-plugin command', 'dsh run dsh-better-sidebar'],
  ] as const)('keeps a %s command browse-only', async (_label, install) => {
    const snapshot = await adapt(install)

    expect(snapshot.items[0]).not.toHaveProperty('package')
    expect(snapshot.items[0]).not.toHaveProperty('latestVersion')
  })

  it.each([
    ['non-GitHub repository', { url: 'https://gitlab.example/omdsh-dev/DSH-better-sidebar' }],
    ['repository with extra path segments', { url: 'https://github.com/omdsh-dev/DSH-better-sidebar/releases' }],
    ['repository with credentials', { url: 'https://user@github.com/omdsh-dev/DSH-better-sidebar' }],
    ['repository with query text', { url: 'https://github.com/omdsh-dev/DSH-better-sidebar?tab=readme' }],
    ['control character in item id', { id: 'omdsh-dev/DSH-better-sidebar\u0000hidden' }],
  ] as const)('drops a catalog item with %s', async (_label, itemOverrides) => {
    const snapshot = await adapt('dsh plugin --profile web add dsh-better-sidebar', itemOverrides)

    expect(snapshot.items).toEqual([])
    expect(snapshot.page).toEqual({ total: 1 })
  })

  it('keeps the v2 directory remotely paginated and marks only direct npm targets installable', async () => {
    const catalog = Array.from({ length: 205 }, (_, index) => {
      const suffix = String(index).padStart(3, '0')
      return {
        ...baseItem,
        id: `example/plugin-${suffix}`,
        name: `Plugin ${suffix}`,
        owner: 'example',
        url: `https://github.com/example/plugin-${suffix}`,
        category: index % 2 === 0 ? 'tools' : 'ui',
        description: { en: `Plugin ${suffix} summary.`, zh: `插件 ${suffix} 摘要。` },
        stars: 205 - index,
        install: index % 4 === 0
          ? `dsh plugin --profile web add github:example/plugin-${suffix}`
          : `dsh plugin --profile web add dsh-plugin-${suffix}`,
      }
    })
    const categories = categoriesFor(catalog)
    const getJson = vi.fn(async (urlValue: string) => {
      const url = new URL(urlValue)
      const page = Number(url.searchParams.get('page'))
      const limit = Number(url.searchParams.get('limit'))
      const start = (page - 1) * limit
      return {
        value: v2Page(catalog.slice(start, start + limit), {
          page,
          limit,
          total: catalog.length,
          catalogTotal: catalog.length,
          categories,
        }),
        finalUrl: url.href,
      }
    })
    const register = vi.fn(() => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')

    const discovery = await dsh1024StoreAdapter.fetch({ limit: 100 }, {
      source,
      signal: new AbortController().signal,
      http: { getJson },
      media: { register },
    })
    expect(discovery.items).toHaveLength(100)
    expect(discovery.page).toEqual({ nextCursor: 'page:2', total: 205 })

    getJson.mockClear()
    register.mockClear()
    const snapshots: CatalogSnapshot[] = []
    let cursor: string | undefined
    do {
      const snapshot = await dsh1024StoreAdapter.fetch({
        limit: 200,
        locale: 'zh-CN',
        ...(cursor === undefined ? {} : { cursor }),
      }, {
        source,
        signal: new AbortController().signal,
        http: { getJson },
        media: { register },
      })
      snapshots.push(snapshot)
      cursor = snapshot.page.nextCursor
    } while (cursor !== undefined)
    const items = snapshots.flatMap(snapshot => snapshot.items)
    const installable = items.filter(item => item.package?.registry === 'npm')

    expect(getJson).toHaveBeenCalledTimes(2)
    expect(getJson.mock.calls.map(call => call[0])).toEqual([
      'https://deepseek1024.com/api/v2/plugins?page=1&limit=200',
      'https://deepseek1024.com/api/v2/plugins?page=2&limit=200',
    ])
    expect(snapshots.map(snapshot => snapshot.items.length)).toEqual([200, 5])
    expect(snapshots.every(snapshot => snapshot.page.total === 205)).toBe(true)
    expect(items).toHaveLength(205)
    expect(installable).toHaveLength(153)
    expect(items.find(item => item.id === 'example/plugin-152')?.package).toBeUndefined()
    expect(installable.find(item => item.id === 'example/plugin-150')).toMatchObject({
      summary: '插件 150 摘要。',
      categories: ['tools'],
      repository: { url: 'https://github.com/example/plugin-150' },
      package: { registry: 'npm', name: 'dsh-plugin-150' },
      media: { icon: { role: 'publisher-avatar', alt: 'example' } },
    })
    expect(register).toHaveBeenCalledTimes(205)
  })

  it('forwards v2 search, category, sort, page, and limit parameters', async () => {
    const getJson = vi.fn(async (url: string) => ({
      value: v2Page([], { limit: 25, total: 0, catalogTotal: 0, categories: [] }),
      finalUrl: url,
    }))

    await dsh1024StoreAdapter.fetch({ q: 'context menu', category: ['ui'], sort: 'downloads', limit: 25 }, {
      source,
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: () => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    })

    expect(getJson).toHaveBeenCalledWith(
      'https://deepseek1024.com/api/v2/plugins?page=1&limit=25&q=context+menu&category=ui&sort=installs',
      expect.any(AbortSignal),
      { allowedOrigin: 'https://deepseek1024.com' },
    )
  })

  it('preserves multi-category OR semantics while merging provider-ranked prefixes', async () => {
    const tools = { ...baseItem, id: 'example/tools', name: 'Tools', owner: 'example', url: 'https://github.com/example/tools', category: 'tools', stars: 5 }
    const ui = { ...baseItem, id: 'example/ui', name: 'UI', owner: 'example', url: 'https://github.com/example/ui', category: 'ui', stars: 10 }
    const all = [tools, ui]
    const categories = categoriesFor(all)
    const getJson = vi.fn(async (urlValue: string) => {
      const url = new URL(urlValue)
      const category = url.searchParams.get('category')
      const limit = Number(url.searchParams.get('limit'))
      const plugins = all.filter(item => item.category === category)
      return {
        value: v2Page(plugins, { limit, total: plugins.length, catalogTotal: all.length, categories }),
        finalUrl: url.href,
      }
    })
    const context = {
      source,
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: () => 'mktimg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }

    const first = await dsh1024StoreAdapter.fetch({ category: ['tools', 'ui'], limit: 1 }, context)
    const second = await dsh1024StoreAdapter.fetch({
      category: ['tools', 'ui'],
      limit: 1,
      cursor: first.page.nextCursor!,
    }, context)

    expect(first.items.map(item => item.id)).toEqual(['example/ui'])
    expect(first.page).toEqual({ nextCursor: 'offset:1', total: 2 })
    expect(second.items.map(item => item.id)).toEqual(['example/tools'])
    expect(second.page).toEqual({ total: 2 })
  })

})
