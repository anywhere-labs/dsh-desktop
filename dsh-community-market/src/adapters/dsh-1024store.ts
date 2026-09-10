import type { CatalogAdapter, CatalogFetchContext } from '../contracts/types.js'
import type { CatalogQuery } from '../contracts/generated/catalog-query.js'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { parseCatalogSnapshot } from '../contracts/validate.js'
import { normalizeRepositoryIdentity } from '../contracts/identity.js'

export const DSH_1024STORE_KEY = 'dsh-1024store'
export const DSH_1024STORE_ENDPOINT = 'https://deepseek1024.com/api/v2/plugins'
export const DSH_1024STORE_HOSTNAME = 'deepseek1024.com'
export const DSH_1024STORE_PROVIDER_ID = 'com.deepseek1024.catalog'
export const DSH_1024STORE_ADAPTER_ID = 'market.dsh-1024store-v2'
export const DSH_1024STORE_LEGACY_ADAPTER_ID = 'market.dsh-1024store-v1'

export function isDsh1024StoreAdapterId(value: string | undefined): boolean {
  return value === DSH_1024STORE_ADAPTER_ID || value === DSH_1024STORE_LEGACY_ADAPTER_ID
}

export interface Dsh1024StoreRawItem {
  readonly id?: unknown
  readonly name?: unknown
  readonly owner?: unknown
  readonly url?: unknown
  readonly category?: unknown
  readonly description?: unknown
  readonly pushedAt?: unknown
  readonly added?: unknown
  readonly stars?: unknown
  readonly installCount?: unknown
  readonly install?: unknown
  readonly media?: unknown
}

interface Dsh1024StoreV2Page {
  readonly plugins?: unknown
  readonly page?: unknown
  readonly limit?: unknown
  readonly total?: unknown
  readonly totalPages?: unknown
  readonly catalogTotal?: unknown
  readonly categories?: unknown
  readonly generatedAt?: unknown
  readonly source?: unknown
}

interface Dsh1024StoreCategory {
  readonly id?: unknown
  readonly count?: unknown
}

interface RegistryCandidate {
  readonly item: CatalogSnapshot['items'][number]
  readonly mediaCandidates: readonly MediaCandidate[]
  readonly stars: number
  readonly downloads: number
  readonly updatedAt: number
}

interface MediaCandidate {
  readonly remoteUrl: string
  readonly role: 'plugin-icon' | 'publisher-avatar'
  readonly alt?: string
  readonly allowedHostnames: readonly string[]
}

interface ProviderPage {
  readonly records: readonly unknown[]
  readonly page: number
  readonly limit: number
  readonly total: number
  readonly totalPages: number
  readonly catalogTotal: number
  readonly categories: readonly string[]
  readonly generatedAt: string
}

interface ProviderPageRead {
  readonly page: ProviderPage
  readonly finalUrl: string
}

const DSH_1024STORE_ORIGIN = new URL(DSH_1024STORE_ENDPOINT).origin
const GITHUB_OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/iu
const GITHUB_REPOSITORY_PATTERN = /^[a-z0-9._-]{1,100}$/iu
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const PROFILE_PATTERN = /^[A-Za-z0-9_-]+$/u
const COMMAND_TOKEN_PATTERN = /^[A-Za-z0-9@:/._#+=-]+$/u
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u
const BROWSE_PAGE_SIZE = 200
const MAX_PROVIDER_PAGE_SIZE = 200
const MAX_PROVIDER_ITEMS = 100_000
const MAX_PROVIDER_PAGES = MAX_PROVIDER_ITEMS

function plainText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) return fallback
  return value
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`1024Store ${label} is invalid`)
  }
  return value
}

function dateTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`1024Store ${label} is invalid`)
  }
  return new Date(value).toISOString()
}

/**
 * Extract only the npm package identity from the provider's displayed v2
 * command. The command itself is never retained or executed. Version tags are
 * deliberately discarded because npm `latest` remains Desktop's install
 * authority during preview.
 */
function reviewedNpmTarget(item: Dsh1024StoreRawItem): { name: string } | undefined {
  if (typeof item.install !== 'string' || item.install.length > 1024) return undefined
  const tokens = item.install.trim().split(/\s+/u)
  if (
    tokens.length !== 6
    || tokens[0] !== 'dsh'
    || tokens[1] !== 'plugin'
    || tokens[2] !== '--profile'
    || !PROFILE_PATTERN.test(tokens[3]!)
    || tokens[4] !== 'add'
    || !tokens.every(token => COMMAND_TOKEN_PATTERN.test(token))
  ) return undefined

  const target = tokens[5]!
  const versionSeparator = target.startsWith('@')
    ? target.indexOf('@', target.indexOf('/') + 1)
    : target.indexOf('@')
  const name = versionSeparator < 0 ? target : target.slice(0, versionSeparator)
  return NPM_PACKAGE_PATTERN.test(name) ? { name } : undefined
}

function providerSort(sort: CatalogQuery['sort']): string | undefined {
  if (sort === 'name') return 'name'
  if (sort === 'updated') return 'active'
  if (sort === 'downloads') return 'installs'
  return undefined
}

function providerEndpoint(query: CatalogQuery, page: number, limit: number, category?: string): string {
  const url = new URL(DSH_1024STORE_ENDPOINT)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', String(limit))
  if (query.q !== undefined) url.searchParams.set('q', query.q)
  if (category !== undefined) url.searchParams.set('category', category)
  const sort = providerSort(query.sort)
  if (sort !== undefined) url.searchParams.set('sort', sort)
  return url.href
}

function repositoryFromItem(item: Dsh1024StoreRawItem): { url: string; subdirectory?: string } | undefined {
  try {
    if (typeof item.url !== 'string') return undefined
    const suppliedUrl = new URL(item.url)
    const suppliedPath = suppliedUrl.pathname.split('/').filter(Boolean)
    if (
      suppliedUrl.protocol !== 'https:'
      || suppliedUrl.hostname.toLowerCase() !== 'github.com'
      || suppliedUrl.username
      || suppliedUrl.password
      || suppliedUrl.search
      || suppliedUrl.hash
      || suppliedPath.length !== 2
    ) return undefined
    const owner = suppliedPath[0]!
    const repository = suppliedPath[1]!.replace(/\.git$/iu, '')
    if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPOSITORY_PATTERN.test(repository)) return undefined
    const parts = typeof item.id === 'string' ? item.id.split('/').filter(Boolean) : []
    const idMatchesRepository = parts.length >= 2
      && parts[0]!.toLowerCase() === owner.toLowerCase()
      && parts[1]!.replace(/\.git$/iu, '').toLowerCase() === repository.toLowerCase()
    return normalizeRepositoryIdentity({
      url: `https://github.com/${owner}/${repository}`,
      ...(idMatchesRepository && parts.length > 2 ? { subdirectory: parts.slice(2).join('/') } : {}),
    })
  } catch {
    return undefined
  }
}

function githubOwner(repositoryUrl: string): string | undefined {
  try {
    const url = new URL(repositoryUrl)
    const owner = url.pathname.split('/').filter(Boolean)[0]
    return owner !== undefined && GITHUB_OWNER_PATTERN.test(owner)
      ? owner.toLowerCase()
      : undefined
  } catch {
    return undefined
  }
}

function explicitIcon(item: Dsh1024StoreRawItem): Omit<MediaCandidate, 'role'> | undefined {
  if (item.media === null || typeof item.media !== 'object' || Array.isArray(item.media)) return undefined
  const icon = (item.media as Record<string, unknown>).icon
  if (icon === null || typeof icon !== 'object' || Array.isArray(icon)) return undefined
  const candidate = icon as Record<string, unknown>
  if (typeof candidate.url !== 'string') return undefined
  try {
    const url = new URL(candidate.url)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || ![DSH_1024STORE_HOSTNAME, 'github.com', 'avatars.githubusercontent.com'].includes(hostname)) return undefined
    const alt = plainText(candidate.alt, 240, '')
    return {
      remoteUrl: url.href,
      ...(alt ? { alt } : {}),
      allowedHostnames: hostname === 'github.com'
        ? ['github.com', 'avatars.githubusercontent.com']
        : [hostname],
    }
  } catch {
    return undefined
  }
}

function mediaCandidates(item: Dsh1024StoreRawItem, repositoryUrl: string): readonly MediaCandidate[] {
  const explicit = explicitIcon(item)
  const owner = githubOwner(repositoryUrl)
  return [
    ...(explicit === undefined ? [] : [{ ...explicit, role: 'plugin-icon' as const }]),
    ...(owner === undefined ? [] : [{
      remoteUrl: `https://github.com/${owner}.png?size=96`,
      role: 'publisher-avatar' as const,
      alt: owner,
      allowedHostnames: ['github.com', 'avatars.githubusercontent.com'],
    }]),
  ]
}

function resolvedMedia(
  candidates: readonly MediaCandidate[],
  itemId: string,
  context: CatalogFetchContext,
): CatalogSnapshot['items'][number]['media'] | undefined {
  for (const candidate of candidates) {
    try {
      const assetRef = context.media.register({
        ...candidate,
        sourceRecordId: context.source.sourceRecordId,
        itemId,
      })
      return { icon: { assetRef, role: candidate.role, ...(candidate.alt === undefined ? {} : { alt: candidate.alt }) } }
    } catch {
      // A bad optional image must not make an otherwise valid catalog item disappear.
    }
  }
  return undefined
}

function normalizedItem(
  entry: unknown,
  context: CatalogFetchContext,
  locale: string | undefined,
): RegistryCandidate | undefined {
  try {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const item = entry as Dsh1024StoreRawItem
    const id = plainText(item.id, 201, '')
    const name = plainText(item.name, 120, '')
    if (!id || !name || !ITEM_ID_PATTERN.test(id)) return undefined
    const repository = repositoryFromItem(item)
    if (repository === undefined) return undefined
    const descriptionValue = item.description
    const description = descriptionValue !== null && typeof descriptionValue === 'object' && !Array.isArray(descriptionValue)
      ? descriptionValue as Record<string, unknown>
      : {}
    const prefersChinese = locale?.toLowerCase().startsWith('zh') ?? false
    const summary = plainText(
      prefersChinese ? description.zh ?? description.en : description.en ?? description.zh,
      1000,
      name,
    )
    const category = typeof item.category === 'string' && CATEGORY_PATTERN.test(item.category)
      ? item.category
      : undefined
    const repositoryOwner = githubOwner(repository.url)
    const suppliedOwner = plainText(item.owner, 120, '')
    const owner = repositoryOwner !== undefined && suppliedOwner.toLowerCase() === repositoryOwner
      ? suppliedOwner
      : repositoryOwner
    const pushedAt = typeof item.pushedAt === 'string' && !Number.isNaN(Date.parse(item.pushedAt))
      ? new Date(item.pushedAt).toISOString()
      : undefined
    const npmTarget = reviewedNpmTarget(item)
    const addedAt = typeof item.added === 'string' && !Number.isNaN(Date.parse(item.added))
      ? Date.parse(item.added)
      : 0
    const normalized: CatalogSnapshot['items'][number] = {
      id,
      name,
      displayName: name,
      summary,
      ...(descriptionValue === undefined ? {} : { description: summary }),
      ...(category === undefined ? {} : { categories: [category] }),
      repository,
      ...(npmTarget === undefined ? {} : { package: { registry: 'npm' as const, name: npmTarget.name } }),
      ...(owner === undefined ? {} : { publisher: { name: owner, url: `https://github.com/${owner}` } }),
      ...(pushedAt === undefined ? {} : { updatedAt: pushedAt }),
      provenance: {
        sourceRecordId: context.source.sourceRecordId,
        providerId: context.source.providerId,
        itemId: id,
      },
    }
    return {
      item: normalized,
      mediaCandidates: mediaCandidates(item, repository.url),
      stars: typeof item.stars === 'number' && Number.isFinite(item.stars) ? item.stars : 0,
      downloads: typeof item.installCount === 'number' && Number.isFinite(item.installCount) ? item.installCount : 0,
      updatedAt: pushedAt === undefined ? addedAt : Date.parse(pushedAt),
    }
  } catch {
    return undefined
  }
}

function categoryIds(value: unknown, catalogTotal: number): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('1024Store categories are invalid')
  const ids: string[] = []
  const seen = new Set<string>()
  let count = 0
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('1024Store category is invalid')
    }
    const category = entry as Dsh1024StoreCategory
    if (typeof category.id !== 'string' || !CATEGORY_PATTERN.test(category.id) || seen.has(category.id)) {
      throw new Error('1024Store category is invalid')
    }
    const categoryCount = safeInteger(category.count, 'category count', 0, MAX_PROVIDER_ITEMS)
    seen.add(category.id)
    ids.push(category.id)
    count += categoryCount
  }
  if (count !== catalogTotal) throw new Error('1024Store category counts are inconsistent')
  return ids
}

function parseProviderPage(value: unknown, requestedPage: number, requestedLimit: number): ProviderPage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('1024Store response is not an object')
  }
  const raw = value as Dsh1024StoreV2Page
  if (!Array.isArray(raw.plugins)) throw new Error('1024Store plugins page is invalid')
  const limit = safeInteger(raw.limit, 'page limit', 1, MAX_PROVIDER_PAGE_SIZE)
  if (limit !== requestedLimit) throw new Error('1024Store changed the requested page limit')
  const total = safeInteger(raw.total, 'query total', 0, MAX_PROVIDER_ITEMS)
  const catalogTotal = safeInteger(raw.catalogTotal, 'catalog total', 0, MAX_PROVIDER_ITEMS)
  if (total > catalogTotal) throw new Error('1024Store query total exceeds the catalog total')
  const totalPages = safeInteger(raw.totalPages, 'page count', 1, MAX_PROVIDER_PAGES)
  const expectedPages = Math.max(1, Math.ceil(total / limit))
  if (totalPages !== expectedPages) throw new Error('1024Store page count is inconsistent')
  const page = safeInteger(raw.page, 'page number', 1, totalPages)
  if (page !== Math.min(requestedPage, totalPages)) throw new Error('1024Store returned an unexpected page')
  const expectedRecords = total === 0 ? 0 : Math.min(limit, total - (page - 1) * limit)
  if (raw.plugins.length !== expectedRecords) throw new Error('1024Store page length is inconsistent')
  const generatedAt = dateTime(raw.generatedAt, 'generation time')
  if (!plainText(raw.source, 80, '')) throw new Error('1024Store source status is invalid')
  return {
    records: raw.plugins,
    page,
    limit,
    total,
    totalPages,
    catalogTotal,
    categories: categoryIds(raw.categories, catalogTotal),
    generatedAt,
  }
}

function assertFinalUrl(value: string): string {
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('1024Store final URL is invalid') }
  if (url.origin !== DSH_1024STORE_ORIGIN) {
    throw new Error('1024Store response changed the reviewed provider origin')
  }
  return url.href
}

async function readProviderPage(
  query: CatalogQuery,
  page: number,
  limit: number,
  context: CatalogFetchContext,
  category?: string,
): Promise<ProviderPageRead> {
  context.signal.throwIfAborted()
  const response = await context.http.getJson(
    providerEndpoint(query, page, limit, category),
    context.signal,
    { allowedOrigin: DSH_1024STORE_ORIGIN },
  )
  context.signal.throwIfAborted()
  return {
    page: parseProviderPage(response.value, page, limit),
    finalUrl: assertFinalUrl(response.finalUrl),
  }
}

function sameDataset(reference: ProviderPage, page: ProviderPage): boolean {
  return reference.generatedAt === page.generatedAt
    && reference.catalogTotal === page.catalogTotal
    && reference.categories.join('\0') === page.categories.join('\0')
}

function compareCandidates(left: RegistryCandidate, right: RegistryCandidate, query: CatalogQuery): number {
  if (query.sort === 'name') return left.item.displayName.localeCompare(right.item.displayName, 'en', { sensitivity: 'base' })
  if (query.sort === 'updated') return right.updatedAt - left.updatedAt || right.stars - left.stars
  if (query.sort === 'downloads') return right.downloads - left.downloads || right.stars - left.stars
  return right.stars - left.stars || left.item.displayName.localeCompare(right.item.displayName, 'en', { sensitivity: 'base' })
}

function snapshotSource(context: CatalogFetchContext, page: ProviderPage, finalUrl: string, fetchedAt: string) {
  return {
    sourceRecordId: context.source.sourceRecordId,
    providerId: context.source.providerId,
    adapterId: context.source.adapterId,
    registrationKind: context.source.registrationKind,
    fetchedAt,
    finalUrl,
    providerGeneratedAt: page.generatedAt,
    providerRevision: page.generatedAt,
  }
}

function resolvedItem(candidate: RegistryCandidate, context: CatalogFetchContext): CatalogSnapshot['items'][number] {
  const media = resolvedMedia(candidate.mediaCandidates, candidate.item.id, context)
  if (media === undefined) return candidate.item
  if (candidate.item.repository === undefined) throw new Error('1024Store normalized item lost its repository identity')
  return {
    ...candidate.item,
    repository: candidate.item.repository,
    media,
  } as CatalogSnapshot['items'][number]
}

function parseDirectPageCursor(value: string | undefined): number {
  if (value === undefined) return 1
  const match = /^page:(\d+)$/u.exec(value)
  const page = match === null ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(page) || page < 2 || page > MAX_PROVIDER_PAGES) {
    throw new Error('1024Store cursor is invalid')
  }
  return page
}

function parseOffsetCursor(value: string | undefined): number {
  if (value === undefined) return 0
  const match = /^offset:(\d+)$/u.exec(value)
  const offset = match === null ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > MAX_PROVIDER_ITEMS) {
    throw new Error('1024Store cursor is invalid')
  }
  return offset
}

async function directSnapshot(query: CatalogQuery, context: CatalogFetchContext): Promise<CatalogSnapshot> {
  const requestedPage = parseDirectPageCursor(query.cursor)
  const limit = Math.min(query.limit ?? 50, BROWSE_PAGE_SIZE)
  const read = await readProviderPage(query, requestedPage, limit, context, query.category?.[0])
  const fetchedAt = new Date().toISOString()
  const candidates = (query.capability?.length ?? 0) > 0
    ? []
    : read.page.records
        .map(entry => normalizedItem(entry, context, query.locale))
        .filter((candidate): candidate is RegistryCandidate => candidate !== undefined)
  return parseCatalogSnapshot({
    schemaVersion: '1.0.0',
    source: snapshotSource(context, read.page, read.finalUrl, fetchedAt),
    items: candidates.map(candidate => resolvedItem(candidate, context)),
    page: (query.capability?.length ?? 0) > 0
      ? { total: 0 }
      : {
          ...(read.page.page < read.page.totalPages ? { nextCursor: `page:${read.page.page + 1}` } : {}),
          total: read.page.total,
        },
  })
}

async function categoryPrefix(
  query: CatalogQuery,
  category: string,
  required: number,
  context: CatalogFetchContext,
): Promise<{ readonly reads: readonly ProviderPageRead[]; readonly candidates: readonly RegistryCandidate[] }> {
  const pageSize = Math.min(Math.max(required, 1), MAX_PROVIDER_PAGE_SIZE)
  const reads: ProviderPageRead[] = []
  const candidates: RegistryCandidate[] = []
  let pageNumber = 1
  while (candidates.length < required) {
    const read = await readProviderPage(query, pageNumber, pageSize, context, category)
    reads.push(read)
    for (const entry of read.page.records) {
      const candidate = normalizedItem(entry, context, query.locale)
      if (candidate !== undefined) candidates.push(candidate)
    }
    if (pageNumber >= read.page.totalPages) break
    pageNumber += 1
  }
  return { reads, candidates }
}

async function multipleCategorySnapshot(query: CatalogQuery, context: CatalogFetchContext): Promise<CatalogSnapshot> {
  const categories = query.category ?? []
  const offset = parseOffsetCursor(query.cursor)
  const limit = Math.min(query.limit ?? 50, BROWSE_PAGE_SIZE)
  const required = Math.min(offset + limit, MAX_PROVIDER_ITEMS)
  const groups = await Promise.all(categories.map(async category => await categoryPrefix(query, category, required, context)))
  const reads = groups.flatMap(group => group.reads)
  const reference = reads[0]?.page
  if (reference === undefined || reads.some(read => !sameDataset(reference, read.page))) {
    throw new Error('1024Store dataset changed during category pagination')
  }
  const total = groups.reduce((sum, group) => sum + group.reads[0]!.page.total, 0)
  if (total > reference.catalogTotal) throw new Error('1024Store category totals are inconsistent')
  const candidates = groups.flatMap(group => group.candidates).sort((left, right) => compareCandidates(left, right, query))
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = candidate.item.id.toLocaleLowerCase('en-US')
    if (seen.has(key)) throw new Error('1024Store category results contain duplicate item IDs')
    seen.add(key)
  }
  const end = Math.min(offset + limit, total)
  const fetchedAt = new Date().toISOString()
  return parseCatalogSnapshot({
    schemaVersion: '1.0.0',
    source: snapshotSource(context, reference, reads[0]!.finalUrl, fetchedAt),
    items: (query.capability?.length ?? 0) > 0
      ? []
      : candidates.slice(offset, end).map(candidate => resolvedItem(candidate, context)),
    page: (query.capability?.length ?? 0) > 0
      ? { total: 0 }
      : { ...(end < total ? { nextCursor: `offset:${end}` } : {}), total },
  })
}

export const dsh1024StoreAdapter: CatalogAdapter = {
  adapterId: DSH_1024STORE_ADAPTER_ID,
  async fetch(query, context) {
    return (query.category?.length ?? 0) > 1
      ? await multipleCategorySnapshot(query, context)
      : await directSnapshot(query, context)
  },
  async fetchCategories(_query, context) {
    const read = await readProviderPage({ limit: 1 }, 1, 1, context)
    return read.page.categories
  },
}
