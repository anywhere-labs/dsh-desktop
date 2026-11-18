/** The Browser access tab of the Desktop settings page. */

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type {
  DesktopSettingsApi,
  DesktopSettingsView,
} from '../../../../dsh-plugin-desktop/src/client/desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from '../../../../dsh-plugin-desktop/src/client/desktop-settings-locales.ts'
import { desktopBrowserAccessAvailable } from '../../../../dsh-plugin-desktop/src/desktop-network.ts'
import type { Translate } from './model.ts'
import type { DesktopSettingsModel } from './use-desktop-settings-section.ts'
import { DesktopSettingsToggleRow } from './controls.tsx'
import { desktopBrowserUrlsShouldRender } from './lan-access.ts'

const LAN_STATE_LOCALE_KEYS = {
  inactive: 'lanStatusInactive',
  starting: 'lanStatusStarting',
  ready: 'lanStatusReady',
  failed: 'lanStatusFailed',
} as const satisfies Record<DesktopSettingsView['web']['lanState'], DesktopSettingsLocaleKey>

function DesktopBrowserUrl({ url, api, t, onOpen }: {
  url: string
  api: DesktopSettingsApi
  t: Translate
  onOpen: React.MouseEventHandler<HTMLAnchorElement>
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const link = <a href={url} onClick={onOpen} target="_blank" rel="noopener noreferrer">{url}</a>
  if (!api.copyBrowser) return link
  const copy = async (): Promise<void> => {
    setBusy(true); setFailed(false); setCopied(false)
    try { await api.copyBrowser!(url); setCopied(true) } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <>
    <div className="dshDesktopSettingsUrlRow">
      {link}
      <button type="button" className="dshDesktopSettingsUrlCopy" disabled={busy}
        aria-label={`${t('copyBrowserUrl')} ${new URL(url).host}`} title={t(copied ? 'browserUrlCopied' : 'copyBrowserUrl')}
        onClick={() => { void copy() }}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
    {failed && <p role="alert" className="dshDesktopSettingsError">{t('operationFailed')}</p>}
  </>
}

/** The Browser access tab: browser and LAN access, their URLs and the LAN certificate. */
export function DesktopSettingsAccessTab({ model }: { model: DesktopSettingsModel }) {
  const {
    t, api, capabilities, browserActions, tabSections, view, setConfirmLan, settingsWritable, browserAccess, mode,
    networkExposure, openBrowser, setBrowserAccess, setNetworkExposure,
  } = model
  return (
    <>
      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-web-title">
        <div>
          <h3 id="dsh-desktop-web-title">{t('webTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('webIntro')}</p>
        </div>
        <DesktopSettingsToggleRow
          label={t('openBrowser')}
          checked={browserAccess}
          disabled={!desktopBrowserAccessAvailable(mode) || !settingsWritable}
          onChange={setBrowserAccess}
        />
        <p className="dshDesktopSettingsNotice">{t('browserCompatibilityNotice')}</p>
        <DesktopSettingsToggleRow
          label={t('lanAccess')}
          badge={t('beta')}
          checked={networkExposure === 'lan'}
          disabled={!browserAccess || !settingsWritable}
          onChange={(checked) => {
            if (checked && capabilities?.nativeLanConfirmation !== true) setConfirmLan(true)
            else if (checked) setNetworkExposure('lan')
            else setNetworkExposure('loopback')
          }}
        />
        {view !== undefined && (
          <div className="dshDesktopSettingsLanStatus" data-state={view.web.lanState} role="status">
            <span className="dshDesktopSettingsChoiceTitle">
              {t('lanStatus')}
              <span className="dshDesktopSettingsBadge">{t(LAN_STATE_LOCALE_KEYS[view.web.lanState])}</span>
            </span>
            {view.web.lanError !== null && (
              <span className="dshDesktopSettingsChoiceBody">
                {t('lanError')}: <code>{view.web.lanError}</code>
              </span>
            )}
          </div>
        )}
        {desktopBrowserUrlsShouldRender(browserAccess, networkExposure) && view !== undefined && view.web.localUrl !== '' && (
          <div className="dshDesktopSettingsUrls">
            <span className="dshDesktopSettingsChoiceTitle">{t('browserUrls')}</span>
            <DesktopBrowserUrl key={view.web.localUrl} url={view.web.localUrl} api={api} t={t} onOpen={event => openBrowser(event, view.web.localUrl)} />
            {view.web.lanUrls.length > 0 && <span className="dshDesktopSettingsChoiceTitle">{t('lanHttpsUrls')}</span>}
            {view.web.lanUrls.map(url => <DesktopBrowserUrl key={url} url={url} api={api} t={t} onOpen={event => openBrowser(event, url)} />)}
          </div>
        )}
        {browserActions}
        {networkExposure === 'lan' && view !== undefined && (
          <>
            <p className="dshDesktopSettingsNotice">{t('lanTrustNotice')}</p>
            {(view.web.lanCaFingerprint !== null || view.web.lanCaUrls.length > 0) && (
              <div className="dshDesktopSettingsUrls">
                <span className="dshDesktopSettingsChoiceTitle">{t('lanCaTitle')}</span>
                {view.web.lanCaFingerprint !== null && (
                  <span className="dshDesktopSettingsLanFingerprint">
                    {t('lanCaFingerprint')}: <code>{view.web.lanCaFingerprint}</code>
                  </span>
                )}
                {view.web.lanCaUrls.length > 0 && <span className="dshDesktopSettingsChoiceBody">{t('lanCaDownloads')}</span>}
                {view.web.lanCaUrls.map(url => <a href={url} key={url} target="_blank" rel="noopener noreferrer">{url}</a>)}
              </div>
            )}
          </>
        )}
      </section>

      {tabSections?.access}
    </>
  )
}
