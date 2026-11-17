/** Details of one catalog item and the install action it offers. */

import {
  Button,
  IconDownloadOutlineRegular,
  IconRightUpOutlineRegular,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketInstallationView, MarketOperationPreviewResponse } from '../../api-types.js'
import {
  DSH_DESKTOP_ISSUES_URL,
  type ManualInstallHint,
  type MarketSettingsTabProps,
  type UpdateCheckState,
  type VisibleItem,
} from './model.js'
import { ItemSourceRow, PluginIcon } from './PluginCard.js'
import { OperationFacts } from './OperationConfirmModal.js'
import { InstallationCard } from './InstalledView.js'

export function ItemActionModal({
  value,
  installation,
  inventoryLoading,
  inventoryError,
  manualInstall,
  preview,
  pending,
  operationError,
  operationDetails,
  executionFailed,
  desktopActionError,
  desktopActionPending,
  toggling,
  toggleError,
  updateCheck,
  canOpenTerminal,
  verificationHelpHref,
  onClose,
  onConfirm,
  onOpenTerminal,
  onToggle,
  onUninstall,
  onUpdate,
  onCheckUpdate,
  t,
}: {
  value: VisibleItem
  installation: MarketInstallationView | undefined
  inventoryLoading: boolean
  inventoryError?: string | undefined
  manualInstall: ManualInstallHint | undefined
  preview: MarketOperationPreviewResponse | undefined
  pending: boolean
  operationError?: string | undefined
  operationDetails?: string | undefined
  executionFailed: boolean
  desktopActionError?: string | undefined
  desktopActionPending: boolean
  toggling?: string | undefined
  toggleError?: string | undefined
  updateCheck?: UpdateCheckState | undefined
  canOpenTerminal: boolean
  verificationHelpHref: string
  onClose: () => void
  onConfirm: () => void
  onOpenTerminal: () => void
  onToggle: (packageName: string, enabled: boolean) => void
  onUninstall: (packageName: string) => void
  onUpdate: (packageName: string) => void
  onCheckUpdate: (packageName: string) => void
  t: MarketSettingsTabProps['t']
}) {
  const checking = preview === undefined && pending && operationError === undefined
  const failureInstallCommand = preview === undefined
    ? undefined
    : preview.version === undefined
      ? `dsh plugin add ${preview.packageName}`
      : `dsh plugin add --save-exact ${preview.packageName}@${preview.version}`
  const footer = executionFailed ? <>
    {canOpenTerminal && (
      <Button
        variant="primary"
        disabled={desktopActionPending}
        onClick={onOpenTerminal}
      >{desktopActionPending ? t('openingTerminal') : t('openTerminal')}</Button>
    )}
    <Button variant="ghost" disabled={desktopActionPending} onClick={onClose}>{t('close')}</Button>
  </> : installation === undefined && preview !== undefined ? <>
    <Button variant="ghost" disabled={pending} onClick={onClose}>{t('cancel')}</Button>
    <Button
      variant="primary"
      disabled={pending}
      icon={<IconDownloadOutlineRegular />}
      onClick={onConfirm}
    >{pending ? t('installing') : t('confirmInstall')}</Button>
  </> : <>
    {value.item.repository !== undefined && (
      <Button
        variant="outline"
        icon={<IconRightUpOutlineRegular size={12} />}
        onClick={() => window.open(value.item.repository!.url, '_blank', 'noopener,noreferrer')}
      >{t('repository')}</Button>
    )}
    {installation === undefined
      && !inventoryLoading
      && inventoryError === undefined
      && manualInstall !== undefined
      && canOpenTerminal && (
      <Button
        variant="primary"
        disabled={desktopActionPending}
        onClick={onOpenTerminal}
      >{desktopActionPending ? t('openingTerminal') : t('openTerminal')}</Button>
    )}
    <Button variant="ghost" disabled={desktopActionPending} onClick={onClose}>{t('close')}</Button>
  </>
  return (
    <Modal
      open
      className="dshMarketModal dshMarketWideModal"
      contentClassName="dshMarketModalContent"
      onClose={onClose}
      title={executionFailed ? t('installFailedTitle') : preview === undefined ? value.item.displayName : t('confirmInstallTitle')}
      closeLabel={t('close')}
      {...(executionFailed
        ? { description: t('installFailedBody') }
        : preview === undefined ? {} : { description: t('confirmInstallBody') })}
      footer={<div className="dshMarketModalActions">{footer}</div>}
    >
      <>
        <ItemSourceRow source={value.source} t={t} />
        {preview !== undefined && executionFailed ? (
          <div className="dshMarketOperationReview">
            <OperationFacts operation={preview} showExpiry={false} t={t} />
            <div className="dshMarketFailureSummary" role="alert">
              <StateDot state="error" size={12} />
              <span>{operationError ?? t('executeError')}</span>
            </div>
            <div className="dshMarketOperationWarning">
              <StateDot state="warning" size={12} />
              <span>{t('installFailureTerminalHint')}</span>
            </div>
            {failureInstallCommand !== undefined && (
              <div className="dshMarketCommand">
                <span>{t('installCommand')}</span>
                <code>{failureInstallCommand}</code>
              </div>
            )}
            <div className="dshMarketFailureOutput">
              <span>{t('failureOutput')}</span>
              <pre>{operationDetails ?? t('noFailureOutput')}</pre>
            </div>
            {desktopActionError !== undefined && <div className="dshMarketError" role="alert">{desktopActionError}</div>}
          </div>
        ) : preview !== undefined ? (
          <div className="dshMarketOperationReview">
            <OperationFacts operation={preview} t={t} />
            <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>
            <div className="dshMarketOperationWarning">
              <StateDot state="warning" size={12} />
              <span>
                {t('operationRiskBeforeContact')}
                <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
                {t('operationRiskAfterContact')}
              </span>
            </div>
            {pending && <div className="dshMarketOperationProgress" role="status"><StateDot state="ongoing" size={12} />{t('installing')}</div>}
            {operationError !== undefined && <div className="dshMarketError" role="alert">{operationError}</div>}
          </div>
        ) : (
          <div className="dshMarketDetails">
            <div className="dshMarketDetailsIntro">
              <PluginIcon item={value.item} large />
              <p>{value.item.description ?? value.item.summary}</p>
            </div>
            {inventoryLoading && (
              <div className="dshMarketOperationProgress" role="status">
                <StateDot state="ongoing" size={12} />{t('loadingInstallations')}
              </div>
            )}
            {inventoryError !== undefined && (
              <div className="dshMarketBanner" role="alert">
                <StateDot state="warning" />
                <span>{inventoryError}</span>
              </div>
            )}
            {installation !== undefined && (
              <div className="dshMarketReceipts">
                <InstallationCard
                  installation={installation}
                  operationPending={pending}
                  toggling={toggling === installation.packageName}
                  updateCheck={updateCheck}
                  onToggle={onToggle}
                  onUninstall={onUninstall}
                  onUpdate={onUpdate}
                  onCheckUpdate={onCheckUpdate}
                  t={t}
                />
                {toggleError !== undefined && <div className="dshMarketError" role="alert">{toggleError}</div>}
              </div>
            )}
            {!inventoryLoading && inventoryError === undefined && installation === undefined && checking && (
              <div className="dshMarketOperationProgress" role="status">
                <StateDot state="ongoing" size={12} />{t('checkingInstallMethod')}
              </div>
            )}
            {installation === undefined && !inventoryLoading && !checking && operationError !== undefined && (
              <div className="dshMarketBanner" role="alert">
                <StateDot state="warning" />
                <span>{operationError}</span>
                <a href={verificationHelpHref} target="_blank" rel="noopener noreferrer">
                  {t('verificationDetails')} <IconRightUpOutlineRegular size={12} />
                </a>
              </div>
            )}
            {installation === undefined && !inventoryLoading && inventoryError === undefined && !checking && manualInstall !== undefined ? (
              <div className="dshMarketManualInstall">
                <div><h3>{t('manualInstallTitle')}</h3><p>{t('manualInstallBody')}</p></div>
                <div className="dshMarketCommand">
                  <span>{t('installCommand')}</span>
                  <code>{manualInstall.displayCommand}</code>
                </div>
                <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('manualNotVerified')}</span></div>
                {manualInstall.mutable && (
                  <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('mutableGithubWarning')}</span></div>
                )}
                <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>
                <div className="dshMarketOperationWarning">
                  <StateDot state="warning" size={12} />
                  <span>
                    {t('operationRiskBeforeContact')}
                    <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
                    {t('operationRiskAfterContact')}
                  </span>
                </div>
              </div>
            ) : installation === undefined
              && !inventoryLoading
              && inventoryError === undefined
              && !checking
              && operationError === undefined ? <div>{t('readOnly')}</div> : null}
            {desktopActionError !== undefined && <div className="dshMarketError" role="alert">{desktopActionError}</div>}
          </div>
        )}
      </>
    </Modal>
  )
}
