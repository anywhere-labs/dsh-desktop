/** The Installed view: installations, their switches and update checks. */

import {
  Button,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  Pill,
  StateDot,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketInstallationView } from '../../api-types.js'
import { type MarketSettingsTabProps, publishedDay, type UpdateChecks, type UpdateCheckState } from './model.js'

export function InstalledView(props: {
  installations: readonly MarketInstallationView[]
  loaded: boolean
  loading: boolean
  unavailable: boolean
  error?: string | undefined
  operationPending: boolean
  togglingPackage?: string | undefined
  toggleError?: string | undefined
  updateChecks: UpdateChecks
  onRetry: () => void
  onToggle: (packageName: string, enabled: boolean) => void
  onUninstall: (packageName: string) => void
  onUpdate: (packageName: string) => void
  onCheckUpdate: (packageName: string) => void
  t: MarketSettingsTabProps['t']
}) {
  if (props.unavailable) return (
    <div className="dshMarketEmpty" role="status">
      <StateDot state="warning" size={16} />
      <h2>{props.t('desktopRequiredTitle')}</h2>
      <p>{props.t('desktopUnavailable')}</p>
    </div>
  )
  if (!props.loaded && props.loading) return (
    <div className="dshMarketEmpty"><StateDot state="ongoing" size={16} /><p>{props.t('loadingInstallations')}</p></div>
  )
  if (!props.loaded && props.error !== undefined) return (
    <div className="dshMarketEmpty" role="alert">
      <StateDot state="error" size={14} />
      <h2>{props.t('installationsError')}</h2>
      <Button variant="outline" icon={<IconRefreshOutlineRegular />} onClick={props.onRetry}>{props.t('retry')}</Button>
    </div>
  )
  return (
    <div className="dshMarketContent">
      <div className="dshMarketSectionHead">
        <div><h2>{props.t('installed')}</h2><p>{props.t('installedBody')}</p></div>
        <Button
          variant="outline"
          size="sm"
          disabled={props.loading || props.operationPending}
          icon={<IconRefreshOutlineRegular />}
          onClick={props.onRetry}
        >{props.t('refresh')}</Button>
      </div>
      {props.error !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{props.error}</div>}
      {props.toggleError !== undefined && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{props.toggleError}</div>}
      {props.installations.length === 0 ? (
        <div className="dshMarketEmpty"><h2>{props.t('noInstalled')}</h2><p>{props.t('noInstalledBody')}</p></div>
      ) : (
        <div className="dshMarketReceipts">
          {props.installations.map(installation => (
            <InstallationCard
              key={installation.packageName}
              installation={installation}
              operationPending={props.operationPending}
              toggling={props.togglingPackage === installation.packageName}
              updateCheck={props.updateChecks[installation.packageName]}
              onToggle={props.onToggle}
              onUninstall={props.onUninstall}
              onUpdate={props.onUpdate}
              onCheckUpdate={props.onCheckUpdate}
              t={props.t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The line an updatable installation shows for its version check. */
function UpdateCheckText({ state, t }: {
  state: UpdateCheckState
  t: MarketSettingsTabProps['t']
}) {
  if (state.phase === 'checking') {
    return <span className="dshMarketUpdateStatus"><StateDot state="ongoing" size={8} />{t('updateChecking')}</span>
  }
  const { check } = state
  switch (check.status) {
    case 'available': {
      const day = check.publishedAt === undefined ? undefined : publishedDay(check.publishedAt)
      return <>
        <span className="dshMarketUpdateStatus" data-tone="info">{t('updateAvailable', { version: check.version })}</span>
        {day !== undefined && <span>{t('updatePublished', { date: day })}</span>}
      </>
    }
    case 'latest':
      return <span className="dshMarketUpdateStatus">{t('updateLatest')}</span>
    case 'blocked':
      return <>
        <span className="dshMarketUpdateStatus" data-tone="warn">{t('updateBlocked')}</span>
        <span>{t('updateBlockedDetail', {
          version: check.version,
          requirements: Object.entries(check.requirements).map(([name, range]) => `${name} ${range}`).join(', '),
          runtime: check.runtimeVersion,
        })}</span>
      </>
    case 'none-installable':
      return <>
        <span className="dshMarketUpdateStatus" data-tone="warn">{t('updateNoneInstallable')}</span>
        <span>{t('updateNoneInstallableDetail')}</span>
      </>
    case 'failed':
      return (
        <span className="dshMarketUpdateStatus" data-tone="error" {...(check.reason === '' ? {} : { title: check.reason })}>
          {t(check.problem === 'network' ? 'updateCheckNetwork' : 'updateCheckFailed')}
        </span>
      )
  }
}

export function InstallationCard(props: {
  installation: MarketInstallationView
  operationPending: boolean
  toggling: boolean
  updateCheck?: UpdateCheckState | undefined
  onToggle: (packageName: string, enabled: boolean) => void
  onUninstall: (packageName: string) => void
  onUpdate: (packageName: string) => void
  onCheckUpdate: (packageName: string) => void
  t: MarketSettingsTabProps['t']
}) {
  const { installation } = props
  const packageName = installation.packageName
  const broken = installation.error !== undefined
  const readOnly = !installation.toggleable && !installation.removable
  const updateCheck = installation.updatable ? props.updateCheck : undefined
  const checked = updateCheck?.phase === 'done' ? updateCheck.check : undefined
  return (
    <article className="dshMarketReceipt">
      <div className="dshMarketReceiptMain">
        <div className="dshMarketReceiptTitle">
          <StateDot state={broken ? 'error' : installation.enabled ? 'done' : 'idle'} size={10} />
          <h3>{packageName}</h3>
          {readOnly && <Pill>{props.t('immutablePlugin')}</Pill>}
          <Pill>{props.t(broken ? 'brokenPlugin' : installation.enabled ? 'activePlugin' : 'disabledPlugin')}</Pill>
        </div>
        <div className="dshMarketReceiptMeta">
          {installation.version !== undefined && <span>{props.t('pluginVersion')}: {installation.version}</span>}
          {installation.error !== undefined && <span>{installation.error}</span>}
          {updateCheck !== undefined && <UpdateCheckText state={updateCheck} t={props.t} />}
        </div>
      </div>
      <div className="dshMarketReceiptActions">
        {checked?.status === 'available' && <Button
          variant="outline"
          size="sm"
          aria-label={`${props.t('update')}: ${packageName}`}
          disabled={props.operationPending || props.toggling}
          icon={<IconDownloadOutlineRegular />}
          onClick={() => props.onUpdate(packageName)}
        >{props.t('update')}</Button>}
        {checked?.status === 'failed' && <Button
          variant="ghost"
          size="sm"
          aria-label={`${props.t('retry')}: ${packageName}`}
          icon={<IconRefreshOutlineRegular />}
          onClick={() => props.onCheckUpdate(packageName)}
        >{props.t('retry')}</Button>}
        {installation.toggleable && <Switch
          label={`${props.t('enablePlugin')}: ${packageName}`}
          checked={installation.enabled}
          disabled={props.operationPending || props.toggling}
          onChange={enabled => props.onToggle(packageName, enabled)}
        />}
        {installation.removable && <Button
          variant="outline"
          size="sm"
          aria-label={`${props.t('uninstall')}: ${packageName}`}
          disabled={props.operationPending || props.toggling}
          icon={<IconTrashOutlineRegular />}
          onClick={() => props.onUninstall(packageName)}
        >{props.t('uninstall')}</Button>}
      </div>
    </article>
  )
}
