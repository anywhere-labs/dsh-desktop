/** The Diagnostics tab of the Desktop settings page. */

import type { DesktopSettingsModel } from './use-desktop-settings-section.ts'
import { DesktopSettingsSelect, DesktopSettingsToggleRow } from './controls.tsx'

/** The Diagnostics tab: developer logging and the log level. */
export function DesktopSettingsDiagnosticsTab({ model }: { model: DesktopSettingsModel }) {
  const { t, desktopSettings, capabilities, tabSections, desktop, runPreference, settingsWritable } = model
  return (
    <>
      {capabilities?.logging !== false && <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-logging-title">
        <h3 id="dsh-desktop-logging-title">{t('loggingTitle')}</h3>
        <DesktopSettingsToggleRow
          label={t('developerLogging')}
          description={t('developerLoggingBody')}
          checked={desktop.value?.developerLogging === true}
          disabled={!settingsWritable}
          onChange={checked => { void runPreference(async () => { await desktopSettings.set('developerLogging', checked) }) }}
        />
        <div className="dshDesktopSettingsToggleRow">
          <span className="dshDesktopSettingsToggleLabel">{t('logLevel')}</span>
          <DesktopSettingsSelect
            value={desktop.value?.logLevel ?? 'info'}
            ariaLabel={t('logLevel')}
            disabled={!settingsWritable}
            options={[
              { value: 'debug', label: 'Debug' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warn' },
              { value: 'error', label: 'Error' },
            ]}
            onChange={(value) => { void runPreference(async () => { await desktopSettings.set('logLevel', value) }) }}
          />
        </div>
      </section>}

      {tabSections?.diagnostics}
    </>
  )
}
