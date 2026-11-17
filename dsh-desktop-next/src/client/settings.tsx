/** Mount the existing Desktop page and controls against Next's native adapter. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesktopSettingsSection, DesktopSettingsSelect, DesktopSettingsToggleRow } from './DesktopSettingsSection.tsx'
import { DesktopNativeActions } from '../../../dsh-plugin-desktop/src/client/DesktopNativeActions.tsx'
import { en, zh, type DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop/src/client/desktop-settings-locales.ts'
import type { DesktopCommand, DesktopState } from '../desktop-contract.ts'
import { NextAppIconSetting } from './app-icon-setting.tsx'
import { DEFAULT_HOST_STARTUP_TIMEOUT, HOST_STARTUP_TIMEOUT_PRESETS, hostStartupLimitTitle, hostStartupTimeoutLabel, type HostStartupTimeout } from '../host-startup-limit.ts'
import { NextSettingsAdapter } from './settings-adapter.ts'
import { DesktopPermissionsSection } from './permissions.tsx'
import { useDesktopState } from './desktop-state.ts'
import { NextUpdateSettings } from './updates.tsx'

export function desktopTranslate(language: string): (key: string) => string {
  const copy = language.startsWith('zh') ? zh : en
  return key => {
    if (key === 'title') return language.startsWith('zh') ? 'DSH NEXT 设置' : 'DSH NEXT settings'
    if (key === 'presentationTitle') return language.startsWith('zh') ? '窗口外观' : 'Window appearance'
    if (key === 'windowMaterialBody') return language.startsWith('zh') ? '设置窗口背景效果，更改后立即生效。' : 'Set the window background effect. Changes apply immediately.'
    if (key === 'sidebarFooterCompat') return language.startsWith('zh') ? '侧边栏底部图标横向排列' : 'Arrange sidebar footer icons in a row'
    if (key === 'sidebarFooterCompatBody') return language.startsWith('zh') ? '展开侧边栏时将底部的紧凑图标按钮并排显示在同一行；关闭后恢复逐行纵向排列，更改后立即生效。' : 'Place compact icon actions on a single row while the sidebar is expanded. Turn off to stack every item vertically. Changes apply immediately.'
    if (key === 'sidebarFooterBalanced') return language.startsWith('zh') ? '多行图标均衡排列' : 'Balance multi-row icon layout'
    if (key === 'sidebarFooterBalancedBody') return language.startsWith('zh') ? '图标超出单行时自动均分每行数量并按列居中对齐；关闭后按顺序排满换行。' : 'Distribute icons evenly across rows and align columns when wrapping. Turn off to wrap greedily in order.'
    if (key === 'deleteProfileWarning') return language.startsWith('zh') ? '此 Profile 将移入恢复备份目录。共享的会话和设置会保留。' : 'Move this Profile to recovery backups. Shared sessions and settings are retained.'
    if (key === 'presentationIntro') return language.startsWith('zh') ? '设置当前平台支持的窗口外观。' : 'Choose the window appearance supported on this platform.'
    if (key === 'browserCompatibilityNotice') return language.startsWith('zh') ? '开关即时生效；关闭访问会断开已有的浏览器连接。' : 'Changes take effect immediately. Disabling access disconnects existing browser connections.'
    if (key === 'tabs') return language.startsWith('zh') ? '桌面设置分类' : 'Desktop settings categories'
    if (key === 'tabGeneral') return language.startsWith('zh') ? '通用' : 'General'
    if (key === 'tabProfiles') return language.startsWith('zh') ? 'Profile 与数据' : 'Profiles & data'
    if (key === 'tabAccess') return language.startsWith('zh') ? '浏览器与局域网' : 'Browser access'
    if (key === 'tabDiagnostics') return language.startsWith('zh') ? '诊断与恢复' : 'Diagnostics'
    return Object.hasOwn(copy, key) ? copy[key as DesktopSettingsLocaleKey] : key
  }
}

export function NextDesktopSettings({ adapter, language, onOpenPlugins }: { adapter: NextSettingsAdapter; language: string; onOpenPlugins(): void }) {
  const state = useDesktopState(adapter)
  const t = desktopTranslate(language)
  return <div data-next-desktop-settings=""><DesktopSettingsSection
    t={t} api={adapter.api} version={state?.version ?? ''} platform={state?.platform === 'darwin' || state?.platform === 'win32' ? state.platform : 'linux'}
    initialMode="compatibility"
    setMode={async () => { throw new Error('Window modes are not supported in Next') }}
    desktopSettings={adapter.desktopSettings} notificationSettings={adapter.notificationSettings}
    capabilities={{ logging: false, windowModes: false, pluginSelectors: false, updates: false, materialRequiresRestart: false, nativeLanConfirmation: true, jobNotifications: false }}
    browserActions={state && <NextBrowserActions adapter={adapter} state={state} language={language} />}
    presentationRows={state && <NextAppIconSetting state={state} language={language} run={command => adapter.command(command)} />}
    tabSections={{
      general: state && <NextGeneralOptions adapter={adapter} state={state} language={language} />,
      profiles: state && <NextDataOptions adapter={adapter} state={state} language={language} />,
      access: <div className="dshDesktopSettingsNotice dshNextPluginSettingsNotice" data-next-plugin-settings-notice>
        <span>{language.startsWith('zh') ? '插件市场和远程控制设置已移至插件页面。' : 'Plugin market and remote control settings have moved to the Plugins page.'}</span>
        <Button variant="outline" size="sm" className="dshDesktopSettingsButton" onClick={onOpenPlugins}>{language.startsWith('zh') ? '前往插件页面' : 'Go to Plugins'}</Button>
      </div>,
      diagnostics: state && <NextDiagnosticsOptions adapter={adapter} state={state} language={language} />,
    }}
  /></div>
}

export function NextDesktopActions({ adapter, language }: { adapter: NextSettingsAdapter; language: string }) {
  const state = useDesktopState(adapter)
  return <DesktopNativeActions api={adapter.api} t={desktopTranslate(language)} placement="settings" terminalAvailable={state?.platform === 'darwin' || state?.platform === 'win32'} />
}

function NextBrowserActions({ adapter, state, language }: { adapter: NextSettingsAdapter; state: DesktopState; language: string }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const run = async (): Promise<void> => {
    setBusy(true); setFailure('')
    try { await adapter.command({ type: 'export-ca' }) } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  if (!state.browserUrl || state.lan?.state !== 'ready') return null
  return <>
    {failure && <p role="alert" className="dshDesktopSettingsError">{failure}</p>}
    <div className="dshDesktopSettingsDialogActions">
      <button type="button" className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary" disabled={busy || state.busy} onClick={() => { void run() }}>{language.startsWith('zh') ? '导出 CA 证书' : 'Export CA certificate'}</button>
    </div>
  </>
}

/**
 * The data directory in use and how it was chosen: a choice made in the app wins over
 * `DSH_DESKTOP_NEXT_HOME`, which wins over `~/.dsh`. Changing or backing up never moves data.
 */
function NextDataDirectory({ state, language, unavailable, run }: { state: DesktopState; language: string; unavailable: boolean; run(command: DesktopCommand): void }) {
  const t = (cn: string, en: string): string => language.startsWith('zh') ? cn : en
  const source = state.dataDirectory?.source
  const environmentHome = state.dataDirectory?.environmentHome ?? null
  const label = source === 'desktop' ? t('应用内选择', 'Chosen in app') : source === 'environment' ? 'DSH_DESKTOP_NEXT_HOME' : source === 'default' ? t('默认', 'Default') : undefined
  const overridden = source === 'desktop' && environmentHome !== null
  return <div className="dshDesktopSettingsUpdateRow" data-next-data-directory="">
    <span className="dshDesktopSettingsToggleCopy">
      <span className="dshDesktopSettingsToggleLabel">{t('数据目录', 'Data directory')}{label && <span className="dshDesktopSettingsBadge" title={t('优先级：应用内选择 > DSH_DESKTOP_NEXT_HOME > 默认目录', 'Precedence: chosen in app > DSH_DESKTOP_NEXT_HOME > default')}>{label}</span>}</span>
      <code className="dshDesktopSettingsDataPath">{state.home}</code>
      <p className="dshDesktopSettingsToggleDescription">
        {overridden && t('应用内选择优先于 DSH_DESKTOP_NEXT_HOME。', 'The directory chosen in the app takes precedence over DSH_DESKTOP_NEXT_HOME. ')}
        {t('如需重置当前数据目录，请先备份，再到恢复助手中操作。', 'To reset this data directory, back it up first, then use the recovery assistant.')}
      </p>
    </span>
    <span className="dshDesktopSettingsRowActions">
      <button type="button" className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary" disabled={unavailable} onClick={() => run({ type: 'change-data-directory' })}>{t('切换', 'Change')}</button>
      <button type="button" className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary" disabled={unavailable} onClick={() => run({ type: 'backup-data-directory' })}>{t('备份', 'Back up')}</button>
    </span>
  </div>
}

/**
 * How long the Host may take to start before recovery opens (#1569). A limit saved outside the presets,
 * such as one edited by hand, stays listed. Safe Mode applies its own fixed limit.
 */
function NextStartupLimit({ state, language, save }: { state: DesktopState; language: string; save(value: HostStartupTimeout): void }) {
  const zh = language.startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const value = state.preferences.hostStartupTimeout ?? DEFAULT_HOST_STARTUP_TIMEOUT
  const choices = typeof value === 'number' && !HOST_STARTUP_TIMEOUT_PRESETS.includes(value)
    ? [...HOST_STARTUP_TIMEOUT_PRESETS.filter(preset => preset !== 'none' && preset < value), value, ...HOST_STARTUP_TIMEOUT_PRESETS.filter(preset => preset === 'none' || preset > value)]
    : HOST_STARTUP_TIMEOUT_PRESETS
  return <div className="dshDesktopSettingsUpdateRow" data-next-startup-limit="">
    <span className="dshDesktopSettingsToggleCopy">
      <span className="dshDesktopSettingsToggleLabel">{hostStartupLimitTitle(zh)}</span>
      <p className="dshDesktopSettingsToggleDescription">{state.safeMode ? t('安全模式固定使用 60 秒。', 'Safe Mode always allows 60 seconds.')
        : t('插件服务需在此时间内就绪，否则打开恢复助手。插件较多或电脑较慢时可以延长。下次启动插件服务时生效。',
          'The plugin service must be ready within this time, or the recovery assistant opens. Allow longer when many plugins are installed or the computer is slow. Applies the next time the plugin service starts.')}</p>
    </span>
    <DesktopSettingsSelect
      ariaLabel={hostStartupLimitTitle(zh)}
      value={String(value)}
      disabled={state.safeMode}
      options={choices.map(choice => ({ value: String(choice), label: hostStartupTimeoutLabel(choice, zh) }))}
      onChange={choice => { save(choice === 'none' ? 'none' : Number(choice)) }}
    />
  </div>
}

/**
 * The command and preference runner of one tab's Next-only groups. A failure shows above those groups, and a running
 * command disables only that tab's buttons.
 */
function useDesktopOptions(adapter: NextSettingsAdapter, state: DesktopState, language: string) {
  const t = (cn: string, en: string): string => language.startsWith('zh') ? cn : en
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setFailure('')
    try { await operation() } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  const command = (value: DesktopCommand): void => { void run(() => adapter.command(value)) }
  const savePreference = async (patch: Parameters<NextSettingsAdapter['savePreferences']>[0]): Promise<void> => {
    setFailure('')
    try { await adapter.savePreferences(patch) } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
  }
  const action = (type: DesktopCommand['type'], cn: string, en: string) => <button key={type} type="button" className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary" disabled={busy || state.busy} onClick={() => { command({ type } as DesktopCommand) }}>{t(cn, en)}</button>
  const failureLine = failure && <p role="alert" className="dshDesktopSettingsError">{failure}</p>
  return { t, busy, command, savePreference, action, failureLine }
}

/** General: background operation, system permissions, the setup wizard and app updates. */
function NextGeneralOptions({ adapter, state, language }: { adapter: NextSettingsAdapter; state: DesktopState; language: string }) {
  const { t, busy, command, savePreference, failureLine } = useDesktopOptions(adapter, state, language)
  return <>
    {failureLine}
    <section className="dshDesktopSettingsGroup"><h3>{t('后台运行', 'Background operation')}</h3>
      <DesktopSettingsToggleRow
        label={t('关闭窗口后保持后台运行', 'Keep running after closing the window')}
        description={state.trayAvailable ? t('可从托盘重新打开窗口。', 'Reopen the window from the tray.') : t('系统托盘不可用，关闭主窗口将退出应用。', 'The tray is unavailable; closing the main window quits the application.')}
        checked={state.preferences.closeToTray}
        disabled={state.safeMode}
        onChange={closeToTray => { void savePreference({ closeToTray }) }}
      />
    </section>
    {adapter.bridge.permissions && <DesktopPermissionsSection service={adapter.bridge.permissions} language={language} />}
    <section className="dshDesktopSettingsGroup" aria-label={t('设置向导', 'Setup wizard')} data-next-setup-wizard="">
      <div className="dshDesktopSettingsUpdateRow">
        <div className="dshDesktopSettingsUpdateSummary">
          <h3>{t('设置向导', 'Setup wizard')}</h3>
        </div>
        <Button variant="outline" size="sm" className="dshDesktopSettingsButton" disabled={busy || state.busy || state.safeMode} onClick={() => { command({ type: 'restart-onboarding' }) }}>{t('重新打开', 'Reopen')}</Button>
      </div>
    </section>
    <NextUpdateSettings state={state} language={language} run={command} />
  </>
}

/** Profiles & data: the data directory beside the Profile list, and the folders to open. */
function NextDataOptions({ adapter, state, language }: { adapter: NextSettingsAdapter; state: DesktopState; language: string }) {
  const { t, busy, command, action, failureLine } = useDesktopOptions(adapter, state, language)
  return <>
    {failureLine}
    <section className="dshDesktopSettingsGroup" aria-label={t('数据目录', 'Data directory')}>
      <NextDataDirectory state={state} language={language} unavailable={busy || state.busy || state.safeMode} run={command} />
      <div className="dshDesktopSettingsToolActions">
        {action('open-home', '打开数据目录', 'Open data directory')}{action('open-profile', '打开 Profile 目录', 'Open Profile directory')}
      </div>
    </section>
  </>
}

/** Diagnostics: logging and developer tools, then the Host startup limit and the recovery assistant. */
function NextDiagnosticsOptions({ adapter, state, language }: { adapter: NextSettingsAdapter; state: DesktopState; language: string }) {
  const { t, command, savePreference, action, failureLine } = useDesktopOptions(adapter, state, language)
  return <>
    {failureLine}
    <section className="dshDesktopSettingsGroup"><h3>{t('诊断', 'Diagnostics')}</h3>
      <div className="dshDesktopSettingsMaterialField">
        <span className="dshDesktopSettingsToggleLabel">{t('日志级别', 'Log level')}</span>
        <DesktopSettingsSelect
          ariaLabel={t('日志级别', 'Log level')}
          value={state.preferences.logLevel}
          disabled={state.safeMode}
          options={(['debug', 'info', 'warn', 'error'] as const).map(value => ({ value, label: value }))}
          onChange={logLevel => { void savePreference({ logLevel }) }}
        />
      </div>
      <DesktopSettingsToggleRow
        label={t('开发者日志', 'Developer logging')}
        description={t('记录模型请求、工具执行和通信的耗时与结果，以及每 30 秒一次的内存使用情况，不记录聊天正文或工具输入输出。日志保留七天，最多占用 200 MiB。会话事件可按序号与官方 Session Log 对照。', 'Record model requests, tool execution and communication timing and outcomes, plus memory usage every 30 seconds, without chat bodies or tool inputs and outputs. History is retained for seven days, up to 200 MiB. Match session events to the official Session Log by sequence number.')}
        checked={state.preferences.developerLogging}
        disabled={state.safeMode}
        onChange={developerLogging => { void savePreference({ developerLogging }) }}
      />
      <div className="dshDesktopSettingsToolActions">
        {action('open-logs', '打开日志目录', 'Open log directory')}{action('devtools', '开发者工具', 'Developer Tools')}
      </div>
    </section>
    <section className="dshDesktopSettingsGroup"><h3>{t('恢复', 'Recovery')}</h3>
      <NextStartupLimit state={state} language={language} save={hostStartupTimeout => { void savePreference({ hostStartupTimeout }) }} />
      <div className="dshDesktopSettingsUpdateRow">
        <span className="dshDesktopSettingsChoiceCopy">
          <span className="dshDesktopSettingsChoiceTitle">{t('恢复助手', 'Recovery assistant')}</span>
        </span>
        <button type="button" className="dshDesktopSettingsButton" onClick={() => { command({ type: 'controls', page: 'recovery' }) }}>{t('打开恢复助手', 'Open recovery assistant')}</button>
      </div>
    </section>
  </>
}
