/** Plugin cards and the source attribution rows the market views share. */

import { IconCordisPluginOutlineRegular, IconRightUpOutlineRegular, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketSourceView } from '../../api-types.js'
import { marketMediaAssetUrl } from '../../media/ref.js'
import {
  type MarketItem,
  type MarketSettingsTabProps,
  safeHttpsExternalHref,
  sourceDisplayLabel,
  type VisibleItem,
} from './model.js'

export function PluginIcon({ item, large = false }: { item: MarketItem; large?: boolean }) {
  const icon = item.media?.icon
  return (
    <div className={large ? 'dshMarketGlyph dshMarketGlyphLarge' : 'dshMarketGlyph'}>
      <IconCordisPluginOutlineRegular size={large ? 28 : 20} />
      {icon !== undefined && (
        <img
          src={marketMediaAssetUrl(icon.assetRef)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={event => { event.currentTarget.remove() }}
        />
      )}
    </div>
  )
}

export function PluginCard({ value, actionLabel, disabled = false, onClick, t }: {
  value: VisibleItem
  actionLabel?: string | undefined
  disabled?: boolean
  onClick: () => void
  t: MarketSettingsTabProps['t']
}) {
  const publisher = value.item.publisher?.name ?? value.source.name
  const sourceLabel = sourceDisplayLabel(value.source)
  return (
    <button
      type="button"
      className="dshMarketCard"
      aria-haspopup="dialog"
      aria-label={actionLabel === undefined ? undefined : `${actionLabel}: ${value.item.displayName}`}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="dshMarketCardTop">
        <PluginIcon item={value.item} />
        <div className="dshMarketCardName"><strong>{value.item.displayName}</strong><span>{publisher}</span></div>
      </div>
      <p className="dshMarketSummary">{value.item.summary}</p>
      <div className="dshMarketTags">
        <Pill>{t('source')}: {sourceLabel}</Pill>
        {actionLabel !== undefined && <Pill>{actionLabel}</Pill>}
        {value.stale && <Pill>{t('stale')}</Pill>}
        {value.item.categories?.slice(0, 2).map(category => <Pill key={category}>{category}</Pill>)}
      </div>
    </button>
  )
}

export function SourceAttribution({ attribution }: {
  attribution: NonNullable<MarketSourceView['attribution']>
}) {
  const href = safeHttpsExternalHref(attribution.url)
  return (
    <div className="dshMarketSourceAttribution">
      {href === undefined
        ? <span>{attribution.name}</span>
        : <a href={href} target="_blank" rel="noopener noreferrer">{attribution.name}</a>}
      {attribution.notice !== undefined && <span>{attribution.notice}</span>}
    </div>
  )
}

export function ItemSourceRow({ source, t }: {
  source: MarketSourceView
  t: MarketSettingsTabProps['t']
}) {
  const label = sourceDisplayLabel(source)
  const href = safeHttpsExternalHref(source.homepage)
    ?? safeHttpsExternalHref(source.attribution?.url)
  return (
    <div className="dshMarketItemSourceRow">
      <span>{t('source')}:</span>
      {href === undefined
        ? <span>{label}</span>
        : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('source')}: ${label}`}
          >
            {label} <IconRightUpOutlineRegular size={12} />
          </a>
        )}
    </div>
  )
}
