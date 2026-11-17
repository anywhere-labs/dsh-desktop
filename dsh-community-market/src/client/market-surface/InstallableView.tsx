/** The Installable view: plugins the market can install directly. */

import {
  Button,
  IconGlobeOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  Input,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketInstallableResponse, MarketStateResponse } from '../../api-types.js'
import type { MarketSettingsTabProps, VisibleItem } from './model.js'
import { PluginCard } from './PluginCard.js'

export function InstallableView(props: {
  state?: MarketStateResponse | undefined
  items: readonly VisibleItem[]
  totalItems: number
  query: string
  categoryOptions: readonly string[]
  selectedCategories: readonly string[]
  metadata: MarketInstallableResponse['metadata'] | undefined
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  unavailable: boolean
  error?: string | undefined
  operationPending: boolean
  onQuery: (value: string) => void
  onSearch: () => void
  onRefresh: () => void
  onToggleCategory: (category: string) => void
  onLoadMore: () => void
  onRetry: () => void
  onSources: () => void
  onInstall: (value: VisibleItem) => void
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
  if (props.unavailable) return (
    <div className="dshMarketEmpty" role="status">
      <StateDot state="warning" size={16} />
      <h2>{props.t('desktopRequiredTitle')}</h2>
      <p>{props.t('desktopUnavailable')}</p>
    </div>
  )
  if (props.loading) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('scanningInstallable')}</p></div>
  )
  if (!props.loaded && props.error !== undefined) return (
    <div className="dshMarketEmpty" role="alert">
      <StateDot state="error" size={14} />
      <h2>{props.t('installableError')}</h2>
      <Button variant="outline" icon={<IconRefreshOutlineRegular />} onClick={props.onRetry}>{props.t('retry')}</Button>
    </div>
  )
  if (!props.loaded) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('scanningInstallable')}</p></div>
  )
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{props.t('installable')}</h2><p>{props.t('installableBody')}</p></div>
        <Button
          variant="outline"
          size="sm"
          disabled={props.loading || props.operationPending}
          icon={<IconRefreshOutlineRegular />}
          onClick={props.onRefresh}
        >{props.t('rescanInstallable')}</Button>
      </div>
      {props.metadata !== undefined && (
        <div className="dshMarketIndexMeta" role="status">
          <span>{props.t('scannedAt')}: {props.metadata.scannedAt}</span>
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
          disabled={props.operationPending}
          placeholder={props.t('search')}
          onChange={event => props.onQuery(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={props.operationPending}
          icon={<IconSearchOutlineRegular />}
        >{props.t('searchAction')}</Button>
        <Pill>{props.totalItems}</Pill>
      </form>
      {props.categoryOptions.length > 0 && (
        <div className="dshMarketCategories" role="group" aria-label={props.t('categories')}>
          <span>{props.t('categories')}</span>
          {props.categoryOptions.map(category => (
            <Pill
              key={category}
              active={props.selectedCategories.includes(category)}
              aria-pressed={props.selectedCategories.includes(category)}
              disabled={props.operationPending}
              onClick={() => props.onToggleCategory(category)}
            >{category}</Pill>
          ))}
        </div>
      )}
      {props.error !== undefined && (
        <div className="dshMarketBanner" role="alert">
          <StateDot state="error" />
          <span>{props.error}</span>
        </div>
      )}
      {props.items.length === 0 && !props.hasMore && (
        <div className="dshMarketEmpty"><h2>{props.t('noInstallable')}</h2><p>{props.t('noInstallableBody')}</p></div>
      )}
      <div className="dshMarketGrid">
        {props.items.map(value => (
          <PluginCard
            key={`${value.source.sourceRecordId}:${value.item.id}`}
            value={value}
            actionLabel={props.t('install')}
            disabled={props.operationPending}
            onClick={() => props.onInstall(value)}
            t={props.t}
          />
        ))}
      </div>
      {props.hasMore && (
        <div className="dshMarketPagination">
          <Button
            type="button"
            variant="outline"
            disabled={props.operationPending || props.loadingMore}
            onClick={props.onLoadMore}
          >{props.loadingMore ? props.t('loadingMore') : props.t('loadMore')}</Button>
        </div>
      )}
    </div>
  )
}
