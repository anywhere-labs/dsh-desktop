/** Market surface types, documentation links and pure helpers shared by its views. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogSnapshot } from '../../contracts/generated/catalog-snapshot.js'
import type {
  MarketCatalogResponse,
  MarketCatalogSourceResult,
  MarketInstallableResponse,
  MarketInstallationUpdateCheck,
  MarketInstallationView,
  MarketOperationExecuteResponse,
  MarketSourceView,
  MarketUpdateOutcome,
} from '../../api-types.js'

export type MarketItem = CatalogSnapshot['items'][number]
export type MarketView = 'discover' | 'installable' | 'installed' | 'sources'
const INSTALL_REQUIREMENTS_DOCS = {
  en: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.md',
  zh: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.zh.md',
} as const
const CATALOG_ADAPTER_GUIDE_DOCS = {
  en: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.md',
  zh: 'https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.zh.md',
} as const
export const DSH_DESKTOP_ISSUES_URL = 'https://github.com/anywhere-labs/deepseek-harness-desktop/issues'

export function installRequirementsUrl(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? INSTALL_REQUIREMENTS_DOCS.zh : INSTALL_REQUIREMENTS_DOCS.en
}

export function catalogAdapterGuideUrl(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? CATALOG_ADAPTER_GUIDE_DOCS.zh : CATALOG_ADAPTER_GUIDE_DOCS.en
}

export interface VisibleItem {
  readonly item: MarketItem
  readonly source: MarketSourceView
  readonly stale: boolean
}

/** A completed package change, announced once as a transient banner. */
export interface OperationNotice {
  readonly seq: number
  readonly text: string
}

export type ManualInstallHint = MarketCatalogResponse['manualInstall'][number]

export type InstallationLoadOutcome =
  | { readonly installations: readonly MarketInstallationView[] }
  | { readonly error: string }

/** One package's update check: queued or in flight under its sequence number, or what the Host answered. */
export type UpdateCheckState =
  | { readonly phase: 'checking'; readonly seq: number }
  | { readonly phase: 'done'; readonly check: MarketInstallationUpdateCheck }

export type UpdateChecks = Readonly<Record<string, UpdateCheckState>>

/** A finished update that left the target uninstalled. */
export type UpdateFailure = Extract<MarketOperationExecuteResponse, { readonly action: 'update' }>
  & { readonly outcome: Exclude<MarketUpdateOutcome, 'updated'> }

export function updatableNames(installations: readonly MarketInstallationView[]): readonly string[] {
  return installations.filter(installation => installation.updatable).map(installation => installation.packageName)
}

/**
 * The checks that still describe the inventory: a package that left it or stopped being updatable loses its check,
 * and so does an answer for another installed version.
 */
export function currentUpdateChecks(checks: UpdateChecks, installations: readonly MarketInstallationView[]): UpdateChecks {
  const kept = Object.entries(checks).filter(([packageName, state]) => {
    const installation = installations.find(item => item.packageName === packageName)
    return installation?.updatable === true
      && (state.phase === 'checking' || state.check.status === 'failed' || state.check.installed === installation.version)
  })
  return kept.length === Object.keys(checks).length ? checks : Object.fromEntries(kept)
}

/** A registry by host, or the default one pnpm's own configuration names. */
export function registryLabel(registry: string | null, t: MarketSettingsTabProps['t']): string {
  if (registry === null) return t('updateSourceDefault')
  try {
    return new URL(registry).host
  } catch {
    // The Host read this registry from pnpm; one that does not parse is shown as written.
    return registry
  }
}

/** A publication time as its local day, `YYYY-MM-DD`, which reads the same in every UI language. */
export function publishedDay(publishedAt: string): string | undefined {
  const day = new Date(publishedAt)
  if (Number.isNaN(day.getTime())) return undefined
  return `${String(day.getFullYear())}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** The title and sentence a failed update reads as, following the official Plugins page. */
export function updateFailureText(failure: UpdateFailure, t: MarketSettingsTabProps['t']): { readonly title: string; readonly detail: string } {
  const { fromVersion: from, version: to, packageName: name } = failure
  switch (failure.outcome) {
    case 'refused': return { title: t('updateRefused', { version: to }), detail: t('updateRefusedDetail', { from }) }
    case 'remove-failed': return { title: t('updateRemoveFailed', { version: from }), detail: t('updateRemoveFailedDetail', { to }) }
    case 'kept': return { title: t('updateKept', { version: to }), detail: t('updateKeptDetail', { from }) }
    case 'restored': return { title: t('updateRestored', { version: from }), detail: t('updateRestoredDetail', { from, to }) }
    case 'broken': return { title: t('updateBroken'), detail: t('updateBrokenDetail', { from, to, name }) }
  }
}

export function visibleItemKey(value: VisibleItem): string {
  return `${value.source.sourceRecordId}\0${value.source.providerId}\0${value.item.id}\0${value.item.package?.name ?? ''}`
}

export function matchingInstallation(
  value: VisibleItem,
  installations: readonly MarketInstallationView[],
): MarketInstallationView | undefined {
  const packageName = value.item.package?.name
  if (packageName === undefined) return undefined
  const matches = installations.filter(installation => installation.packageName === packageName)
  return matches.length === 1 ? matches[0] : undefined
}

export function isDesktopUnavailable(cause: unknown): boolean {
  return cause !== null
    && typeof cause === 'object'
    && 'status' in cause
    && (cause as { status?: unknown }).status === 503
}

export function operationErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : fallback
}

export function operationErrorDetails(cause: unknown): string | undefined {
  const details = cause !== null && typeof cause === 'object' && 'details' in cause
    ? (cause as { readonly details?: unknown }).details
    : undefined
  return typeof details === 'string' && details.trim().length > 0 ? details : undefined
}

export function catalogFailureMessage(
  cause: unknown,
  source: MarketSourceView,
  t: MarketSettingsTabProps['t'],
): string {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause
    ? (cause as { code?: unknown }).code
    : undefined
  const reason = code === 'catalog-timeout'
    ? t('catalogFailureTimeout')
    : code === 'catalog-invalid-response'
      ? t('catalogFailureInvalidResponse')
      : t('catalogFailureUnavailable')
  return `${t('catalogFailureSource')}: ${source.name}. ${reason}`
}

export type MarketSettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'community-market'>
  & {
    readLocale: () => string
    initialView?: MarketView
  }

export function retainEnabledCatalog(
  catalog: MarketCatalogResponse | undefined,
  sources: readonly MarketSourceView[],
): MarketCatalogResponse | undefined {
  if (catalog === undefined) return undefined
  const selected = [...sources]
    .filter(source => source.enabled)
    .sort((left, right) => left.order - right.order)
    .at(0)
  if (selected === undefined) return undefined
  const result = catalog.results.find(value => value.source.sourceRecordId === selected.sourceRecordId)
  return result === undefined ? undefined : { ...catalog, results: [{ ...result, source: selected }] }
}

export function selectedSource(sources: readonly MarketSourceView[]): MarketSourceView | undefined {
  return [...sources]
    .filter(source => source.enabled)
    .sort((left, right) => left.order - right.order)
    .at(0)
}

export function mergeCatalogPages(
  catalog: MarketCatalogResponse | undefined,
  pages: readonly MarketCatalogSourceResult[],
  manualInstall: readonly ManualInstallHint[],
): MarketCatalogResponse | undefined {
  if (catalog === undefined || pages.length === 0) return catalog
  const updates = new Map(pages.map(page => [page.source.sourceRecordId, page]))
  const results = catalog.results.map(current => {
    const next = updates.get(current.source.sourceRecordId)
    if (current.snapshot === undefined || next?.snapshot === undefined) return current
    const seen = new Set<string>()
    const items = [...current.snapshot.items, ...next.snapshot.items].filter(item => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    return {
      ...next,
      source: current.source,
      snapshot: { ...next.snapshot, items, page: next.snapshot.page },
    }
  })
  const hints = new Map([...catalog.manualInstall, ...manualInstall].map(hint => [
    `${hint.sourceRecordId}:${hint.itemId}`,
    hint,
  ]))
  return { ...catalog, results, manualInstall: [...hints.values()], fetchedAt: new Date().toISOString() }
}

export function mergeInstallablePages(
  current: MarketInstallableResponse | undefined,
  next: MarketInstallableResponse,
): MarketInstallableResponse {
  if (current === undefined || current.source.sourceRecordId !== next.source.sourceRecordId) return next
  const seen = new Set<string>()
  const items = [...current.items, ...next.items].filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const hints = new Map([...current.manualInstall, ...next.manualInstall].map(hint => [
    `${hint.sourceRecordId}:${hint.itemId}`,
    hint,
  ]))
  return {
    ...next,
    items,
    categories: next.categories.length === 0 ? current.categories : next.categories,
    manualInstall: [...hints.values()],
  }
}

export function sourceDisplayLabel(source: MarketSourceView): string {
  const attribution = source.attribution?.name
  return attribution === undefined || attribution === source.name
    ? source.name
    : `${source.name} · ${attribution}`
}

export function safeHttpsExternalHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
      return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}
