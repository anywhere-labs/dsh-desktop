/** Desktop-owned settings section registered into the official Settings shell. */

import type { ReactNode } from 'react'
import { type SegmentedTab, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsSectionInjected, DesktopSettingsTab } from './desktop-settings/model.ts'
import { useDesktopSettingsSection } from './desktop-settings/use-desktop-settings-section.ts'
import { DesktopSettingsGeneralTab } from './desktop-settings/general-tab.tsx'
import { DesktopSettingsProfilesTab } from './desktop-settings/profiles-tab.tsx'
import { DesktopSettingsAccessTab } from './desktop-settings/access-tab.tsx'
import { DesktopSettingsDiagnosticsTab } from './desktop-settings/diagnostics-tab.tsx'
import { resolveDesktopLanConfirmation } from './desktop-settings/lan-access.ts'

export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopSettingsTab,
  DesktopShellSettings,
} from './desktop-settings/model.ts'
export {
  desktopBrowserUrlsShouldRender,
  persistDesktopBrowserAccessHot,
  persistDesktopNetworkExposureHot,
  readDesktopSettingsUntilLanSettled,
  resolveDesktopLanConfirmation,
} from './desktop-settings/lan-access.ts'
export { Choice, DesktopSettingsSelect, DesktopSettingsToggleRow } from './desktop-settings/controls.tsx'
export type { DesktopSettingsToggleExpander } from './desktop-settings/controls.tsx'
export { MARKET_OPTIONS, marketBody, marketTitle } from './desktop-settings/market-options.tsx'

const TAB_LOCALE_KEYS = {
  general: 'tabGeneral',
  profiles: 'tabProfiles',
  access: 'tabAccess',
  diagnostics: 'tabDiagnostics',
} as const satisfies Record<DesktopSettingsTab, string>

/** One tab's groups; a hidden tab stays mounted. */
function DesktopSettingsTabPanel({ tabsId, value, active, children }: {
  tabsId: string
  value: DesktopSettingsTab
  active: boolean
  children: ReactNode
}) {
  return (
    <div
      role="tabpanel"
      id={`${tabsId}-${value}-panel`}
      aria-labelledby={`${tabsId}-${value}`}
      className="dshDesktopSettingsTabPanel"
      data-desktop-settings-tab={value}
      hidden={!active}
    >
      {children}
    </div>
  )
}

/** Render the Desktop settings page: shared status above four tabs, each mounted while hidden so drafts survive switching. */
export function DesktopSettingsSection(
  props: DesktopSettingsSectionInjected & Pick<PropsLocale<'desktop.settings'>, 't'> & Partial<PropsRuntime<'settings.section'>>,
) {
  const model = useDesktopSettingsSection(props)
  const {
    t, tabsId, tab, setTab, operationFailed, aaStatus, restart, confirmLan, setConfirmLan, setNetworkExposure,
  } = model

  const tabItem = (value: DesktopSettingsTab): SegmentedTab<DesktopSettingsTab> => ({
    value,
    label: <span className="dshDesktopSettingsTabLabel">{t(TAB_LOCALE_KEYS[value])}</span>,
    id: `${tabsId}-${value}`,
    panelId: `${tabsId}-${value}-panel`,
  })

  return (
    <div className="dshDesktopSettings">
      <header className="dshDesktopSettingsHeader">
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
      </header>

      {operationFailed && aaStatus !== 'failed' && <p className="dshDesktopSettingsError" role="alert">{t('operationFailed')}</p>}
      {restart !== 'none' && (
        <p className="dshDesktopSettingsSuccess" role="status">
          {t(restart === 'restarting' ? 'restarting' : 'restartRequired')}
        </p>
      )}

      <SegmentedTabs
        size="sm"
        className="dshDesktopSettingsTabs"
        label={t('tabs')}
        value={tab}
        onChange={setTab}
        items={[tabItem('general'), tabItem('profiles'), tabItem('access'), tabItem('diagnostics')]}
      />

      <DesktopSettingsTabPanel tabsId={tabsId} value="general" active={tab === 'general'}>
        <DesktopSettingsGeneralTab model={model} />
      </DesktopSettingsTabPanel>

      <DesktopSettingsTabPanel tabsId={tabsId} value="profiles" active={tab === 'profiles'}>
        <DesktopSettingsProfilesTab model={model} />
      </DesktopSettingsTabPanel>

      <DesktopSettingsTabPanel tabsId={tabsId} value="access" active={tab === 'access'}>
        <DesktopSettingsAccessTab model={model} />
      </DesktopSettingsTabPanel>

      <DesktopSettingsTabPanel tabsId={tabsId} value="diagnostics" active={tab === 'diagnostics'}>
        <DesktopSettingsDiagnosticsTab model={model} />
      </DesktopSettingsTabPanel>

      {confirmLan && (
        <div className="dshDesktopSettingsDialogBackdrop" role="presentation">
          <div className="dshDesktopSettingsDialog" role="alertdialog" aria-modal="true" aria-labelledby="dsh-desktop-lan-warning-title" aria-describedby="dsh-desktop-lan-warning-body">
            <h3 id="dsh-desktop-lan-warning-title">{t('lanWarningTitle')}</h3>
            <p id="dsh-desktop-lan-warning-body">{t('lanWarningBody')}</p>
            <div className="dshDesktopSettingsDialogActions">
              <button
                type="button"
                className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                onClick={() => {
                  resolveDesktopLanConfirmation(false, () => { setConfirmLan(false) }, () => { setNetworkExposure('lan') })
                }}
              >
                {t('lanCancel')}
              </button>
              <button
                type="button"
                className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
                onClick={() => {
                  resolveDesktopLanConfirmation(true, () => { setConfirmLan(false) }, () => { setNetworkExposure('lan') })
                }}
              >
                {t('lanConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
