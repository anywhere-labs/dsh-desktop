/** Confirmation of an install, update or uninstall the market previewed. */

import {
  Button,
  IconDownloadOutlineRegular,
  IconTrashOutlineRegular,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketOperationPreviewResponse } from '../../api-types.js'
import {
  DSH_DESKTOP_ISSUES_URL,
  type MarketSettingsTabProps,
  registryLabel,
  type UpdateFailure,
  updateFailureText,
} from './model.js'

export function OperationFacts({ operation, showExpiry = true, t }: {
  operation: MarketOperationPreviewResponse
  showExpiry?: boolean
  t: MarketSettingsTabProps['t']
}) {
  return (
    <dl className="dshMarketOperationFacts">
      <div><dt>{t('plugin')}</dt><dd>{operation.displayName}</dd></div>
      <div><dt>{t('package')}</dt><dd>{operation.packageName}</dd></div>
      {operation.action === 'update' ? <>
        {operation.fromVersion !== undefined && <div><dt>{t('currentVersion')}</dt><dd>{operation.fromVersion}</dd></div>}
        {operation.version !== undefined && <div><dt>{t('targetVersion')}</dt><dd>{operation.version}</dd></div>}
        {operation.registry !== undefined && <div><dt>{t('updateSource')}</dt><dd>{registryLabel(operation.registry, t)}</dd></div>}
      </> : operation.version !== undefined && <div><dt>{t('exactVersion')}</dt><dd>{operation.version}</dd></div>}
      <div><dt>{t('profile')}</dt><dd>{operation.profileName}</dd></div>
      {showExpiry && <div><dt>{t('previewExpires')}</dt><dd>{operation.expiresAt}</dd></div>}
    </dl>
  )
}

const OPERATION_COPY = {
  install: { title: 'confirmInstallTitle', confirm: 'confirmInstall', pending: 'installing' },
  uninstall: { title: 'confirmUninstallTitle', confirm: 'confirmUninstall', pending: 'uninstalling' },
  update: { title: 'confirmUpdateTitle', confirm: 'confirmUpdate', pending: 'updating' },
} as const

export function OperationConfirmModal({ preview, pending, error, failure, onCancel, onConfirm, t }: {
  preview: MarketOperationPreviewResponse
  pending: boolean
  error?: string | undefined
  /** A finished update that left the target uninstalled; the dialog then reports it instead of asking. */
  failure?: UpdateFailure | undefined
  onCancel: () => void
  onConfirm: () => void
  t: MarketSettingsTabProps['t']
}) {
  const copy = OPERATION_COPY[preview.action]
  // Installing and updating both bring new plugin code into the Profile.
  const addsCode = preview.action !== 'uninstall'
  const outcome = failure === undefined ? undefined : updateFailureText(failure, t)
  const description = preview.action === 'install'
    ? t('confirmInstallBody')
    : preview.action === 'uninstall'
      ? t('confirmUninstallBody')
      : t('confirmUpdateBody', { from: preview.fromVersion, to: preview.version })
  const confirmLabel = pending ? t(copy.pending) : t(copy.confirm)
  return (
    <Modal
      open
      className="dshMarketModal dshMarketConfirmModal"
      contentClassName="dshMarketModalContent"
      onClose={onCancel}
      closeLabel={t('cancel')}
      title={outcome?.title ?? t(copy.title)}
      {...(outcome === undefined ? { description } : {})}
      footer={<div className="dshMarketModalActions">
        {outcome !== undefined ? (
          <Button variant="primary" onClick={onCancel}>{t('close')}</Button>
        ) : <>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={pending}
            icon={preview.action === 'uninstall' ? <IconTrashOutlineRegular /> : <IconDownloadOutlineRegular />}
            onClick={onConfirm}
          >{confirmLabel}</Button>
        </>}
      </div>}
    >
      <div className="dshMarketOperationReview">
        {outcome !== undefined && (
          <div className="dshMarketFailureSummary" role="alert">
            <StateDot state="error" size={12} />
            <span>{outcome.detail}</span>
          </div>
        )}
        <OperationFacts operation={preview} showExpiry={outcome === undefined} t={t} />
        {outcome === undefined && addsCode && <div className="dshMarketOperationWarning"><StateDot state="warning" size={12} /><span>{t('operationWarning')}</span></div>}
        {outcome === undefined && addsCode && (
          <div className="dshMarketOperationWarning">
            <StateDot state="warning" size={12} />
            <span>
              {t('operationRiskBeforeContact')}
              <a href={DSH_DESKTOP_ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('contactUs')}</a>
              {t('operationRiskAfterContact')}
            </span>
          </div>
        )}
        {failure !== undefined && (
          <div className="dshMarketFailureOutput">
            <span>{t('failureOutput')}</span>
            <pre>{failure.details ?? t('noFailureOutput')}</pre>
          </div>
        )}
        {pending && <div className="dshMarketOperationProgress" role="status"><StateDot state="ongoing" size={12} />{confirmLabel}</div>}
        {error !== undefined && <div className="dshMarketError" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
