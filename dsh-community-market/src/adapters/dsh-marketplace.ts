import type { CatalogQuery } from '../contracts/generated/catalog-query.js'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { normalizeRepositoryIdentity } from '../contracts/identity.js'
import type { CatalogAdapter, CatalogFetchContext } from '../contracts/types.js'
import { parseCatalogSnapshot } from '../contracts/validate.js'

export const DSH_MARKETPLACE_KEY = 'dsh-marketplace-qilewl'
export const DSH_MARKETPLACE_PROVIDER_ID = 'dsh-marketplace-community'
export const DSH_MARKETPLACE_ADAPTER_ID = 'market.dsh-marketplace-qilewl-v1'
export const DSH_MARKETPLACE_HOSTNAME = 'dsh-marketplace.qilewl.net'
export const DSH_MARKETPLACE_PUBLIC_ENDPOINT = 'https://dsh-marketplace.qilewl.net/v1/plugins'
export const DSH_MARKETPLACE_MANIFEST_URL = 'https://dsh-marketplace.qilewl.net/catalog-source.json'
export const DSH_MARKETPLACE_API_ENDPOINT = 'https://dsh-marketplace.qilewl.net/api/plugins'

const DSH_MARKETPLACE_ORIGIN = `https://${DSH_MARKETPLACE_HOSTNAME}`
const PAGE_SIZE = 100
const MAX_ITEMS = 10_000
const MAX_PAGES = 100
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u
const GITHUB_OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/iu
const GITHUB_REPOSITORY_PATTERN = /^[a-z0-9._-]{1,100}$/iu
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

type CatalogItem = CatalogSnapshot['items'][number]

interface ProviderPage {
  readonly records: readonly unknown[]
  readonly total: number
  readonly size: number
  readonly current: number
  readonly pages: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`DSH Marketplace ${label} is invalid`)
  }
  return value as number
}

function plainText(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength || UNSAFE_TEXT_PATTERN.test(value)) return undefined
  if (!allowEmpty && value.length === 0) return undefined
  return value
}

function assertFinalOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('DSH Marketplace final URL is invalid')
  }
  if (url.origin !== DSH_MARKETPLACE_ORIGIN) {
    throw new Error('DSH Marketplace response changed the reviewed provider origin')
  }
  return url.href
}

function providerPage(value: unknown, expectedPage: number, expectedSize: number): ProviderPage {
  const root = record(value)
  const data = record(root?.data)
  const plugins = record(data?.plugins)
  if (root?.code !== 200 || plugins === undefined || !Array.isArray(plugins.records)) {
    throw new Error('DSH Marketplace response is invalid')
  }
  const total = safeInteger(data?.total, 'total')
  const nestedTotal = safeInteger(plugins.total, 'page total')
  const size = safeInteger(plugins.size, 'page size', 1)
  const current = safeInteger(plugins.current, 'page number', 1)
  const pages = safeInteger(plugins.pages, 'page count')
  if (total !== nestedTotal || total > MAX_ITEMS) throw new Error('DSH Marketplace total is inconsistent')
  if (size !== expectedSize || current !== expectedPage) throw new Error('DSH Marketplace page did not match the request')
  if (pages !== (total === 0 ? 0 : Math.ceil(total / size))) {
    throw new Error('DSH Marketplace page metadata is inconsistent')
  }
  if (plugins.records.length > size || (pages > 0 && current > pages)) {
    throw new Error('DSH Marketplace item count is inconsistent')
  }
  return { records: plugins.records, total, size, current, pages }
}

function repositoryIdentity(raw: Record<string, unknown>): {
  readonly repository: NonNullable<CatalogItem['repository']>
  readonly owner: string
} | undefined {
  if (typeof raw.htmlUrl !== 'string' || typeof raw.fullName !== 'string') return undefined
  try {
    const url = new URL(raw.htmlUrl)
    const segments = url.pathname.split('/').filter(Boolean)
    const supplied = raw.fullName.split('/')
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'github.com'
      || url.username
      || url.password
      || url.search
      || url.hash
      || segments.length !== 2
      || supplied.length !== 2
    ) return undefined
    const owner = segments[0]!
    const repositoryName = segments[1]!.replace(/\.git$/iu, '')
    if (
      !GITHUB_OWNER_PATTERN.test(owner)
      || !GITHUB_REPOSITORY_PATTERN.test(repositoryName)
      || supplied[0]!.toLowerCase() !== owner.toLowerCase()
      || supplied[1]!.replace(/\.git$/iu, '').toLowerCase() !== repositoryName.toLowerCase()
    ) return undefined
    return {
      repository: normalizeRepositoryIdentity({ url: `https://github.com/${owner}/${repositoryName}` }),
      owner,
    }
  } catch {
    return undefined
  }
}

function stringList(value: unknown, maximum: number, pattern?: RegExp): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const item = plainText(entry, 64)
    if (item === undefined || pattern !== undefined && !pattern.test(item) || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length === maximum) break
  }
  return result.length === 0 ? undefined : result
}

function packageFromDeployCommand(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^dsh plugin --profile [a-z0-9._-]+ add (\S+)$/u.exec(value)
  if (match === null) return undefined
  let spec = match[1]!
  const versionSeparator = spec.startsWith('@')
    ? spec.indexOf('@', spec.indexOf('/') + 1)
    : spec.indexOf('@')
  if (versionSeparator > 0) spec = spec.slice(0, versionSeparator)
  return NPM_PACKAGE_PATTERN.test(spec) ? spec : undefined
}

function normalizeItem(value: unknown, context: CatalogFetchContext): CatalogItem | undefined {
  const raw = record(value)
  if (raw === undefined || raw.itemType !== 'plugin') return undefined
  const id = plainText(raw.fullName, 160)
  const name = plainText(raw.name, 120)
  if (id === undefined || name === undefined || !IDENTIFIER_PATTERN.test(id)) return undefined
  const identity = repositoryIdentity(raw)
  if (identity === undefined) return undefined
  const description = plainText(raw.description, 5_000, true)
  const summaryCandidate = description === undefined ? undefined : Array.from(description).slice(0, 1_000).join('')
  const summary = summaryCandidate || name
  const categories = stringList(raw.topics, 32, CATEGORY_PATTERN)
  const keywords = stringList([
    ...(Array.isArray(raw.topics) ? raw.topics : []),
    ...(typeof raw.language === 'string' ? [raw.language] : []),
  ], 64)
  const author = plainText(raw.author, 120)
  const publisher = author?.toLowerCase() === identity.owner.toLowerCase() ? author : identity.owner
  const updatedValue = typeof raw.githubUpdatedAt === 'string' ? raw.githubUpdatedAt : raw.pushedAt
  const updatedAt = typeof updatedValue === 'string' && Number.isFinite(Date.parse(updatedValue))
    ? new Date(Date.parse(updatedValue)).toISOString()
    : undefined
  const packageName = packageFromDeployCommand(raw.deployCommand)
  const license = plainText(raw.license, 120)
  const item: CatalogItem = {
    id,
    name,
    displayName: name,
    summary,
    ...(description === undefined ? {} : { description: description || summary }),
    ...(categories === undefined ? {} : { categories: [...categories] }),
    ...(keywords === undefined ? {} : { keywords: [...keywords] }),
    repository: identity.repository,
    publisher: { name: publisher, url: `https://github.com/${identity.owner}` },
    ...(license === undefined ? {} : { license }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(packageName === undefined ? {} : { package: { registry: 'npm' as const, name: packageName } }),
    provenance: {
      sourceRecordId: context.source.sourceRecordId,
      providerId: context.source.providerId,
      itemId: id,
    },
  }
  return item
}

function requestedPage(query: CatalogQuery): number {
  const raw = query.cursor ?? '1'
  if (!/^[1-9]\d*$/u.test(raw)) throw new Error('DSH Marketplace cursor is invalid')
  const page = Number(raw)
  if (!Number.isSafeInteger(page) || page > MAX_ITEMS) throw new Error('DSH Marketplace cursor is invalid')
  return page
}

function providerUrl(query: CatalogQuery): { readonly url: string; readonly page: number; readonly size: number } {
  if ((query.capability?.length ?? 0) > 0) throw new Error('DSH Marketplace capabilities are unsupported')
  const page = requestedPage(query)
  const size = Math.min(query.limit ?? 50, PAGE_SIZE)
  const url = new URL(DSH_MARKETPLACE_API_ENDPOINT)
  url.searchParams.set('page', String(page))
  url.searchParams.set('size', String(size))
  url.searchParams.set('sort', query.sort === 'updated' ? 'updated' : query.sort === 'name' ? 'name' : 'stars')
  if (query.q !== undefined) url.searchParams.set('keyword', query.q)
  if (query.category?.length === 1) url.searchParams.set('category', query.category[0]!)
  if ((query.category?.length ?? 0) > 1) throw new Error('DSH Marketplace supports one category at a time')
  return { url: url.href, page, size }
}

function snapshot(
  items: readonly CatalogItem[],
  page: { readonly total: number; readonly nextCursor?: string },
  context: CatalogFetchContext,
  finalUrl: string,
  fetchedAt: string,
): CatalogSnapshot {
  return parseCatalogSnapshot({
    schemaVersion: '1.0.0',
    source: {
      sourceRecordId: context.source.sourceRecordId,
      providerId: context.source.providerId,
      adapterId: context.source.adapterId,
      registrationKind: context.source.registrationKind,
      fetchedAt,
      finalUrl,
    },
    items,
    page,
  })
}

function scanSnapshots(
  items: readonly CatalogItem[],
  context: CatalogFetchContext,
  finalUrl: string,
  fetchedAt: string,
): readonly CatalogSnapshot[] {
  if (items.length === 0) return [snapshot([], { total: 0 }, context, finalUrl, fetchedAt)]
  const result: CatalogSnapshot[] = []
  for (let offset = 0; offset < items.length; offset += PAGE_SIZE) {
    result.push(snapshot(items.slice(offset, offset + PAGE_SIZE), { total: items.length }, context, finalUrl, fetchedAt))
  }
  return result
}

export function isDshMarketplaceSourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false
    return url.href === DSH_MARKETPLACE_PUBLIC_ENDPOINT || url.href === DSH_MARKETPLACE_MANIFEST_URL
  } catch {
    return false
  }
}

export const dshMarketplaceAdapter: CatalogAdapter = {
  adapterId: DSH_MARKETPLACE_ADAPTER_ID,
  async fetch(query, context) {
    const request = providerUrl(query)
    const response = await context.http.getJson(request.url, context.signal, { allowedOrigin: DSH_MARKETPLACE_ORIGIN })
    context.signal.throwIfAborted()
    const finalUrl = assertFinalOrigin(response.finalUrl)
    const page = providerPage(response.value, request.page, request.size)
    const items = page.records.flatMap(value => {
      const item = normalizeItem(value, context)
      return item === undefined ? [] : [item]
    })
    return snapshot(items, {
      total: page.total,
      ...(page.current < page.pages ? { nextCursor: String(page.current + 1) } : {}),
    }, context, finalUrl, new Date().toISOString())
  },
  async scanCatalog(query, context) {
    const items: CatalogItem[] = []
    const seen = new Set<string>()
    let current = 1
    let total: number | undefined
    let pages: number | undefined
    let firstFinalUrl: string | undefined
    while (true) {
      context.signal.throwIfAborted()
      const request = providerUrl({
        cursor: String(current),
        limit: PAGE_SIZE,
        ...(query.locale === undefined ? {} : { locale: query.locale }),
      })
      const response = await context.http.getJson(request.url, context.signal, { allowedOrigin: DSH_MARKETPLACE_ORIGIN })
      const finalUrl = assertFinalOrigin(response.finalUrl)
      firstFinalUrl ??= finalUrl
      const page = providerPage(response.value, current, PAGE_SIZE)
      total ??= page.total
      pages ??= page.pages
      if (page.pages > MAX_PAGES) throw new Error('DSH Marketplace exceeded the scan page limit')
      if (page.total !== total || page.pages !== pages) throw new Error('DSH Marketplace dataset changed during pagination')
      for (const value of page.records) {
        const item = normalizeItem(value, context)
        if (item === undefined) continue
        const duplicateKey = item.id.toLocaleLowerCase('en-US')
        if (seen.has(duplicateKey)) throw new Error('DSH Marketplace contains duplicate item IDs')
        seen.add(duplicateKey)
        items.push(item)
      }
      if (current >= page.pages) break
      current += 1
    }
    return scanSnapshots(items, context, firstFinalUrl ?? DSH_MARKETPLACE_API_ENDPOINT, new Date().toISOString())
  },
}
