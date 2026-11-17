/** The Discover view: catalog search, categories and paging across enabled sources. */

import {
  Button,
  IconGlobeOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  Input,
  Pill,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketCatalogResponse, MarketStateResponse } from '../../api-types.js'
import type { MarketSettingsTabProps, VisibleItem } from './model.js'
import { PluginCard } from './PluginCard.js'

export function DiscoverView(props: {
  state?: MarketStateResponse | undefined
  items: readonly VisibleItem[]
  metadata: MarketCatalogResponse['metadata']
  query: string
  categoryOptions: readonly string[]
  selectedCategories: readonly string[]
  loading: boolean
  loadingMore: boolean
  mutationPending: boolean
  error?: string | undefined
  loadMoreError?: string | undefined
  partialFailure: boolean
  hasMore: boolean
  onQuery: (value: string) => void
  onSearch: () => void
  onRefresh: () => void
  onToggleCategory: (category: string) => void
  onLoadMore: () => void
  onSources: () => void
  onSelect: (value: VisibleItem) => void
  t: MarketSettingsTabProps['t']
}) {
  const noSources = props.state !== undefined && !props.state.sources.some(source => source.enabled)
  if (noSources) return (
    <div className="dshMarketEmpty">
      <div className="dshMarketEmptyIcon"><IconGlobeOutlineRegular size={24} /></div>
      <h2>{props.t('emptyTitle')}</h2>
      <p>{props.t('emptyBody')}</p>
      <Button variant="primary" icon={<IconSettingsOutlineRegular />} onClick={props.onSources}>{props.t('chooseSources')}</Button>
    </div>
  )
  return (
    <div className="dshMarketContent">
      {props.metadata !== undefined && (
        <div className="dshMarketIndexMeta" role="status">
          <span>{props.t('scannedAt')}: {props.metadata.scannedAt}</span>
          <span>{props.t('cacheExpiresAt')}: {props.metadata.expiresAt}</span>
          {props.metadata.providerRevision !== undefined && (
            <span>{props.t('providerRevision')}: {props.metadata.providerRevision}</span>
          )}
          <span>{props.metadata.cacheStatus === 'fresh' ? props.t('freshScan') : props.t('cachedScan')}</span>
        </div>
      )}
      <form className="dshMarketToolbar" onSubmit={event => { event.preventDefault(); props.onSearch() }}>
        <Input
          className="dshMarketSearch"
          icon={<IconSearchOutlineRegular />}
          value={props.query}
          disabled={props.mutationPending}
          placeholder={props.t('search')}
          onChange={event => props.onQuery(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={props.mutationPending} icon={<IconSearchOutlineRegular />}>{props.t('searchAction')}</Button>
        <Tooltip label={props.t('refresh')}>
          <Button
            type="button"
            size="sm"
            variant="toolbar"
            aria-label={props.t('refresh')}
            disabled={props.loading || props.loadingMore || props.mutationPending}
            icon={<IconRefreshOutlineRegular />}
            onClick={props.onRefresh}
          />
        </Tooltip>
        <Pill>{props.items.length}</Pill>
      </form>
      {props.categoryOptions.length > 0 && (
        <div className="dshMarketCategories" role="group" aria-label={props.t('categories')}>
          <span>{props.t('categories')}</span>
          {props.categoryOptions.map(category => (
            <Pill
              key={category}
              active={props.selectedCategories.includes(category)}
              aria-pressed={props.selectedCategories.includes(category)}
              disabled={props.mutationPending}
              onClick={() => props.onToggleCategory(category)}
            >{category}</Pill>
          ))}
        </div>
      )}
      {props.partialFailure && <div className="dshMarketBanner" role="status"><StateDot state="warning" />{props.t('partialFailure')}</div>}
      {props.error !== undefined && (
        <div className="dshMarketEmpty" role="alert">
          <StateDot state="error" size={14} />
          <h2>{props.t('catalogError')}</h2><p>{props.error}</p>
          <Button variant="outline" icon={<IconRefreshOutlineRegular />} onClick={props.onRefresh}>{props.t('retry')}</Button>
        </div>
      )}
      {props.error === undefined && props.loading && props.items.length === 0 && (
        <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('loading')}</p></div>
      )}
      {props.error === undefined && !props.loading && props.items.length === 0 && (
        <div className="dshMarketEmpty"><h2>{props.t('noResults')}</h2></div>
      )}
      <div className="dshMarketGrid">
        {props.items.map(value => <PluginCard key={`${value.source.sourceRecordId}:${value.item.id}`} value={value} onClick={() => props.onSelect(value)} t={props.t} />)}
      </div>
      {(props.hasMore || props.loadMoreError !== undefined) && (
        <div className="dshMarketPagination">
          {props.loadMoreError !== undefined && <div className="dshMarketPaginationError" role="status">{props.loadMoreError}</div>}
          {props.hasMore && (
            <Button
              type="button"
              variant="outline"
              disabled={props.loading || props.loadingMore || props.mutationPending}
              onClick={props.onLoadMore}
            >{props.loadingMore ? props.t('loadingMore') : props.t('loadMore')}</Button>
          )}
        </div>
      )}
    </div>
  )
}
