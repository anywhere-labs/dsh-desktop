/** The Sources view: configured catalog sources, their order and the built-in sources to add. */

import {
  Button,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconGlobeOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Pill,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MarketBuiltInProvider,
  MarketCatalogResponse,
  MarketCatalogSourceResult,
  MarketSourceMutation,
  MarketSourceView,
  MarketStateResponse,
} from '../../api-types.js'
import { DSH_DESKTOP_ISSUES_URL, type MarketSettingsTabProps } from './model.js'
import { SourceAttribution } from './PluginCard.js'

export function SourcesView({ state, catalog, error, pending, adapterGuideHref, onMutation, onAddStandard, t }: {
  state?: MarketStateResponse | undefined
  catalog?: MarketCatalogResponse | undefined
  error?: string | undefined
  pending: boolean
  adapterGuideHref: string
  onMutation: (mutation: MarketSourceMutation) => void
  onAddStandard: () => void
  t: MarketSettingsTabProps['t']
}) {
  const selectedKeys = new Set(state?.sources.map(source => source.builtInProviderKey).filter(Boolean))
  const available = state?.builtIns.filter(provider => !selectedKeys.has(provider.key)) ?? []
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{t('sources')}</h2><p>{t('sourceNotice')}</p></div>
        <Button variant="outline" disabled={pending} icon={<IconPlusOutlineRegular />} onClick={onAddStandard}>{t('addStandard')}</Button>
      </div>
      <div className="dshMarketBanner dshMarketSourceGuide">
        <IconGlobeOutlineRegular size={14} />
        <span>
          {t('sourcePartnershipBefore')}
          <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('sourcePartnershipContact')}</a>
          {t('sourcePartnershipAfter')}{' '}
          <a href={adapterGuideHref} target="_blank" rel="noopener noreferrer">{t('sourcePartnershipGuide')}</a>
        </span>
      </div>
      {error !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{error}</div>}
      <div className="dshMarketSources" role="radiogroup" aria-label={t('sourceSelection')}>
        {state?.sources.map((source, index, sources) => (
          <SourceRow
            key={source.sourceRecordId}
            source={source}
            result={catalog?.results.find(result => result.source.sourceRecordId === source.sourceRecordId)}
            pending={pending}
            canMoveUp={index > 0}
            canMoveDown={index < sources.length - 1}
            onMoveUp={() => onMutation({ action: 'move', sourceRecordId: source.sourceRecordId, direction: 'up' })}
            onMoveDown={() => onMutation({ action: 'move', sourceRecordId: source.sourceRecordId, direction: 'down' })}
            onSelect={() => {
              if (!source.enabled) onMutation({ action: 'select', sourceRecordId: source.sourceRecordId })
            }}
            onRemove={() => onMutation({ action: 'remove', sourceRecordId: source.sourceRecordId })}
            t={t}
          />
        ))}
      </div>
      {available.length > 0 && <div className="dshMarketSources dshMarketAvailableSources">
        {available.map(provider => (
          <AvailableSource
            key={provider.key}
            provider={provider}
            pending={pending}
            onAdd={() => onMutation({ action: 'add-builtin', key: provider.key })}
            t={t}
          />
        ))}
      </div>}
    </div>
  )
}

function SourceRow({ source, result, pending, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onSelect, onRemove, t }: {
  source: MarketSourceView
  result?: MarketCatalogSourceResult | undefined
  pending: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onSelect: () => void
  onRemove: () => void
  t: MarketSettingsTabProps['t']
}) {
  const endpointHost = (() => {
    try { return new URL(source.endpoint).host }
    catch { return source.endpoint }
  })()
  const resultLabel = result === undefined
    ? t('notChecked')
    : result.error !== undefined && result.snapshot === undefined
      ? t('unavailable')
      : result.stale
        ? t('lastStale')
        : t('available')
  const resultState = result === undefined
    ? 'ongoing'
    : result.error !== undefined && result.snapshot === undefined
      ? 'error'
      : result.stale
        ? 'warning'
        : 'done'
  return (
    <div className="dshMarketSource">
      <div>
        <h3>{source.name}{source.partnership && <Pill>{t('partner')}</Pill>}</h3>
        <p>{source.description ?? source.endpoint}</p>
        {source.attribution !== undefined && <SourceAttribution attribution={source.attribution} />}
        <div className="dshMarketSourceMeta">
          {source.attribution === undefined && <span>{source.providerId}</span>}
          <span>{endpointHost}</span>
          <span>{source.registrationKind === 'built-in' ? t('builtIn') : t('standardAdapter')}</span>
          <span><StateDot state={resultState} size={10} />{resultLabel}</span>
        </div>
      </div>
      <div className="dshMarketSourceActions">
        <Tooltip label={t('moveUp')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('moveUp')}
            disabled={pending || !canMoveUp}
            icon={<IconChevronUpOutlineRegular size={14} />}
            onClick={onMoveUp}
          />
        </Tooltip>
        <Tooltip label={t('moveDown')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('moveDown')}
            disabled={pending || !canMoveDown}
            icon={<IconChevronDownOutlineRegular size={14} />}
            onClick={onMoveDown}
          />
        </Tooltip>
        <Button
          variant="outline"
          size="sm"
          role="radio"
          aria-checked={source.enabled}
          disabled={pending}
          icon={source.enabled ? <IconCheckOutlineRegular /> : undefined}
          onClick={onSelect}
        >{source.enabled ? t('selectedSource') : t('selectSource')}</Button>
        <Tooltip label={t('remove')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('remove')}
            disabled={pending}
            icon={<IconTrashOutlineRegular />}
            onClick={onRemove}
          />
        </Tooltip>
      </div>
    </div>
  )
}

function AvailableSource({ provider, pending, onAdd, t }: {
  provider: MarketBuiltInProvider
  pending: boolean
  onAdd: () => void
  t: MarketSettingsTabProps['t']
}) {
  return (
    <div className="dshMarketSource">
      <div>
        <h3>{provider.name}{provider.partnership && <Pill>{t('partner')}</Pill>}</h3>
        <p>{provider.description}</p>
        <SourceAttribution attribution={provider.attribution} />
      </div>
      <Button variant="outline" size="sm" disabled={pending} icon={<IconPlusOutlineRegular />} onClick={onAdd}>{t('add')}</Button>
    </div>
  )
}
