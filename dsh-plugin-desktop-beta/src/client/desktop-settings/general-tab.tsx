/** The General tab of the Desktop settings page. */

import type { DesktopSettingsModel } from './use-desktop-settings-section.ts'
import { Choice, DesktopSettingsSelect, DesktopSettingsToggleRow } from './controls.tsx'

/** The General tab: window presentation, notifications and updates. */
export function DesktopSettingsGeneralTab({ model }: { model: DesktopSettingsModel }) {
  const {
    t, platform, version, desktopSettings, capabilities, presentationRows, tabSections, desktop, notifications, busy,
    restart, sidebarFooterOpen, setSidebarFooterOpen, sidebarFooterRegionId, notificationsOpen, setNotificationsOpen,
    notificationsRegionId, updateCheck, runPreference, settingsWritable, notificationsWritable, mode,
    notificationValue, setMode, setMaterial, setNotification, runUpdateCheck,
  } = model
  return (
    <>
      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-presentation-title">
        <div>
          <h3 id="dsh-desktop-presentation-title">{t('presentationTitle')}</h3>
          {capabilities?.windowModes !== false && <p className="dshDesktopSettingsGroupIntro">{t('presentationIntro')}</p>}
        </div>
        {desktop.status === 'unavailable' && <p className="dshDesktopSettingsNotice">{t('readOnly')}</p>}
        {capabilities?.windowModes !== false && <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-presentation-title">
          <Choice
            title={t('compatibilityMode')}
            body={t('compatibilityModeBody')}
            selected={mode === 'compatibility'}
            disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('compatibility') }}
            status={mode === 'compatibility' ? t('selected') : undefined}
          />
          <Choice
            title={t('extendedMode')}
            body={platform === 'linux' ? t('extendedUnavailableLinux') : t('extendedModeBody')}
            selected={mode === 'extended'}
            disabled={platform === 'linux' || !settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('extended') }}
            status={mode === 'extended' ? t('selected') : undefined}
          />
          <Choice
            title={t('advancedMode')}
            body={platform === 'linux' ? t('advancedUnavailableLinux') : t('advancedModeBody')}
            selected={mode === 'advanced'}
            disabled={platform === 'linux' || !settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('advanced') }}
            status={mode === 'advanced' ? t('selected') : undefined}
          />
        </div>}
        {presentationRows}
        {platform === 'darwin' && (
          <div className="dshDesktopSettingsMaterialField" data-desktop-material-row="">
            <span className="dshDesktopSettingsMaterialCopy">
              <span className="dshDesktopSettingsChoiceTitle">{t('windowMaterial')}</span>
              <span className="dshDesktopSettingsChoiceBody">{t('windowMaterialBody')}</span>
            </span>
            <DesktopSettingsSelect
              value={desktop.value?.macosMaterial ?? 'transparent'}
              ariaLabel={t('windowMaterial')}
              disabled={!settingsWritable || restart !== 'none'}
              options={[
                { value: 'off', label: t('windowMaterialOff') },
                { value: 'transparent', label: t('windowMaterialTransparent') },
              ]}
              onChange={setMaterial}
            />
          </div>
        )}
        <div className="dshDesktopSettingsExpandableGroup">
          <DesktopSettingsToggleRow
            label={t('sidebarFooterCompat')}
            description={t('sidebarFooterCompatBody')}
            checked={desktop.value?.sidebarFooterCompat !== false}
            disabled={!settingsWritable || restart !== 'none'}
            onChange={checked => { void runPreference(async () => { await desktopSettings.set('sidebarFooterCompat', checked) }) }}
            expander={{
              open: sidebarFooterOpen,
              controls: sidebarFooterRegionId,
              label: t('sidebarFooterCompat'),
              onToggle: () => { setSidebarFooterOpen(open => !open) },
            }}
          />
          {sidebarFooterOpen && (
            <div id={sidebarFooterRegionId} className="dshDesktopSettingsExpandedRows">
              <DesktopSettingsToggleRow
                label={t('sidebarFooterBalanced')}
                description={t('sidebarFooterBalancedBody')}
                checked={desktop.value?.sidebarFooterBalanced !== false}
                disabled={desktop.value?.sidebarFooterCompat === false || !settingsWritable || restart !== 'none'}
                onChange={checked => { void runPreference(async () => { await desktopSettings.set('sidebarFooterBalanced', checked) }) }}
              />
            </div>
          )}
        </div>
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-notifications-title">
        <h3>{t('notificationsTitle')}</h3>
        {notifications.status === 'unavailable' && <p className="dshDesktopSettingsNotice">{t('readOnly')}</p>}
        <div className="dshDesktopSettingsExpandableGroup">
          <DesktopSettingsToggleRow
            titleId="dsh-desktop-notifications-title"
            label={t('notificationsEnabled')}
            description={t('notificationsIntro')}
            checked={notificationValue.enabled}
            disabled={!notificationsWritable}
            onChange={checked => { setNotification('enabled', checked) }}
            expander={{
              open: notificationsOpen,
              controls: notificationsRegionId,
              label: t('notificationsTitle'),
              onToggle: () => { setNotificationsOpen(open => !open) },
            }}
          />
          {notificationsOpen && (
            <div id={notificationsRegionId} className="dshDesktopSettingsExpandedRows">
              <DesktopSettingsToggleRow
                label={t('turnCompletion')}
                checked={notificationValue.notifyOnTurnCompletion}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnTurnCompletion', checked) }}
              />
              <DesktopSettingsToggleRow
                label={t('turnFailure')}
                checked={notificationValue.notifyOnTurnFailure}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnTurnFailure', checked) }}
              />
              <DesktopSettingsToggleRow
                label={t('scheduleCompletion')}
                checked={notificationValue.notifyOnScheduleCompletion}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnScheduleCompletion', checked) }}
              />
              <DesktopSettingsToggleRow
                label={t('scheduleFailure')}
                checked={notificationValue.notifyOnScheduleFailure}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnScheduleFailure', checked) }}
              />
              {capabilities?.jobNotifications !== false && <><DesktopSettingsToggleRow
                label={t('jobCompletion')}
                checked={notificationValue.notifyOnJobCompletion}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnJobCompletion', checked) }}
              />
              <DesktopSettingsToggleRow
                label={t('jobFailure')}
                checked={notificationValue.notifyOnJobFailure}
                disabled={!notificationValue.enabled || !notificationsWritable}
                onChange={checked => { setNotification('notifyOnJobFailure', checked) }}
              /></>}
            </div>
          )}
        </div>
      </section>

      {capabilities?.updates !== false && (
        <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-updates-title">
          <div>
            <h3 id="dsh-desktop-updates-title">{t('updatesTitle')}</h3>
            <p className="dshDesktopSettingsGroupIntro">{t('updatesIntro')}</p>
          </div>
          <div className="dshDesktopSettingsUpdateRow">
            <span className="dshDesktopSettingsChoiceCopy">
              <span className="dshDesktopSettingsChoiceTitle">{t('currentVersion')}</span>
              <span className="dshDesktopSettingsChoiceBody">{`v${version}`}</span>
            </span>
            <button
              type="button"
              className="dshDesktopSettingsButton"
              disabled={updateCheck === 'checking'}
              onClick={runUpdateCheck}
            >
              {t(updateCheck === 'checking' ? 'checkingForUpdates' : 'checkForUpdates')}
            </button>
          </div>
          {updateCheck === 'failed' && (
            <p className="dshDesktopSettingsError" role="alert">{t('checkForUpdatesError')}</p>
          )}
        </section>
      )}

      {tabSections?.general}
    </>
  )
}
