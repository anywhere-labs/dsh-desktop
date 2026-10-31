/** Existing Desktop utility pages; Next supplies only state and native actions. */
import { CSPProvider } from '@base-ui/react/csp-provider'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { RecoveryApp, type RecoveryState } from '../../../dsh-plugin-desktop/src/native-ui/recovery/App.tsx'
import { ProfileCreateApp } from '../../../dsh-plugin-desktop/src/native-ui/profile-create/App.tsx'
import { ProfileSelectorApp } from '../../../dsh-plugin-desktop/src/native-ui/profile-selector/App.tsx'
import { DesktopFrame } from '../../../dsh-plugin-desktop/src/native-ui/shared/DesktopFrame.tsx'
import { Alert, AlertDescription } from '../../../dsh-plugin-desktop/src/native-ui/components/ui/alert.tsx'
import { desktopRecoveryCopy } from '../../../dsh-plugin-desktop/src/recovery-copy.ts'
import { useDesktopState } from '../client/desktop-state.ts'
import { NextSettingsAdapter } from '../client/settings-adapter.ts'
import type { DesktopCommand } from '../desktop-contract.ts'
import { hostExitDetail } from '../exit-code.ts'
import { recoverySupport } from '../recovery-support.ts'
import './theme.css'
import { Onboarding } from './onboarding.tsx'

function App() {
  const adapter = useMemo(() => window.desktopNext ? new NextSettingsAdapter(window.desktopNext) : undefined, [])
  if (!adapter) return <Alert variant="destructive"><AlertDescription>Desktop controls could not load. Restart DSH Desktop Beta.</AlertDescription></Alert>
  return <NativePages adapter={adapter} />
}

function NativePages({ adapter }: { adapter: NextSettingsAdapter }) {
  const state = useDesktopState(adapter)
  const locale = new URLSearchParams(location.search).get('locale') === 'zh' ? 'zh' : 'en'
  const t = (cn: string, en: string) => locale === 'zh' ? cn : en
  const [page, setPage] = useState(location.hash.slice(1) || 'recovery')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { const change = () => setPage(location.hash.slice(1)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  const perform = async (command: DesktopCommand): Promise<void> => {
    if (busy) return
    setFailure(''); setBusy(true)
    try { await adapter.command(command) } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  useEffect(() => {
    const navigate = (event: MouseEvent): void => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      const url = new URL(anchor.href)
      if (!['dsh-recovery:', 'dsh-profile-selector:'].includes(url.protocol)) return
      event.preventDefault()
      if (busy) return
      const actions: Record<string, DesktopCommand> = {
        restart: { type: 'recovery-action', action: 'restart' }, quit: { type: 'quit' }, cancel: { type: 'close-controls' },
        'enter-safe-mode': { type: 'safe-mode' }, 'normal-mode': { type: 'normal-mode' },
        'export-diagnostics': { type: 'diagnostics' },
        'open-terminal': { type: 'terminal' }, 'open-profile-directory': { type: 'open-profile' },
        'open-profile-creator': { type: 'controls', page: 'create-profile' }, create: { type: 'controls', page: 'create-profile' },
        recover: { type: 'recover' }, 'repair-global': { type: 'repair-global' },
        'open-home': { type: 'open-home' }, 'open-logs': { type: 'open-logs' },
      }
      const recoveryActions = ['open-checkpoint', 'preview-checkpoint', 'preview-uninstall',
        'preview-disable', 'preview-enable', 'open-settings-document',
        'open-profile-patch', 'open-profile-manifest', 'show-diagnostics', 'show-failure-report', 'begin-change-data-directory',
        'restore-default-data-directory', 'factory-reset']
      if (recoveryActions.includes(url.hostname)) {
        const slot = /^slot-([123])$/.exec(url.searchParams.get('id') ?? '')
        const id = slot ? state?.recovery?.checkpoints[Number(slot[1]) - 1]?.id : url.searchParams.get('id') ?? undefined
        void perform({ type: 'recovery-action', action: url.hostname, ...(id ? { id } : {}) })
        return
      }
      const command = url.hostname === 'switch-profile' || url.hostname === 'switch'
        ? { type: 'switch' as const, name: url.searchParams.get('name') ?? '' } : actions[url.hostname]
      if (command) void perform(command)
    }
    document.addEventListener('click', navigate)
    return () => document.removeEventListener('click', navigate)
  }, [adapter, busy, state])
  if (!state) return <><DesktopFrame /><main className={page === 'onboarding' ? 'next-onboarding dshNativeContent p-6' : 'dshNativeContent p-6'} data-platform={new URLSearchParams(location.search).get('platform') ?? undefined} data-material="transparent"><Alert><AlertDescription>{t('正在读取桌面状态…', 'Loading Desktop state…')}</AlertDescription></Alert></main></>
  if (page === 'onboarding') return <Onboarding key={state.selected} state={state} locale={locale} bridge={adapter.bridge} />
  if (page === 'create-profile') return <ProfileCreateApp onCancel={() => { void perform({ type: 'close-controls' }) }} onCreate={async name => {
    await adapter.command({ type: 'create', name })
    await adapter.command({ type: 'switch', name })
    const updated = await adapter.refresh()
    if (updated.selected === name) await adapter.command({ type: 'close-controls' })
    else await adapter.command({ type: 'controls', page: 'profiles' })
  }} />
  // An action that failed outside this page, such as from the tray, is reported here too.
  const actionFailure = failure || (busy ? '' : state.actionFailure ?? '')
  const notice = actionFailure ? { tone: 'error' as const, title: t('操作未完成', 'Action failed'), body: actionFailure } : undefined
  const profiles = state.profiles.map(name => ({ name, current: name === state.selected, selectable: !state.unavailableProfiles.includes(name) }))
  if (page === 'profiles') return <ProfileSelectorApp state={{ locale, profiles, busy: busy || state.busy, restartReady: false, ...(notice ? { notice } : {}) }} />
  // Recovery, first-run setup and Profile tools work without a Host. Settings live in the app.
  const copy = { ...desktopRecoveryCopy(locale),
    restart: state.safeMode ? t('退出安全模式并重启', 'Exit Safe Mode and Restart') : t('退出并重启', 'Quit and restart'),
    safeModeBody: t('使用独立的临时环境，不载入原环境的插件、补丁和凭据。退出安全模式后移除临时数据，返回原 Profile。', 'Use a temporary environment without the original plugins, patches or credentials. Leaving Safe Mode removes temporary data and returns to the original Profile.'),
    safeModeActiveBody: t('当前主窗口使用临时环境。可在恢复助手中检查和修复原 Profile。退出安全模式并重启后，将返回原 Profile，临时数据不会保留。', 'The main window is using a temporary environment. Use the recovery assistant to inspect and repair the original Profile. Exiting Safe Mode and restarting returns to that Profile and removes the temporary data.'),
    rollbackGuideBody: t('将当前 Profile 的配置恢复到最近一次成功启动的状态。', 'Restore this Profile to its last successful-start configuration.'),
    rollbackBody: t('还原所选检查点的 Profile 配置并安装所需插件依赖，不回滚共享数据。', 'Restore the selected Profile configuration and install its required plugin dependencies, without reverting shared data.'),
  }
  const report = state.failureReport
  const reportName = report?.status === 'saved' ? report.file.split(/[\\/]/u).at(-1) : undefined
  const repair = state.recovery?.repairBackup
  const repaired = repair === undefined ? '' : new Date(repair.created).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  const quickActions = [
    { action: 'recover', title: t('修复 Profile', 'Repair Profile'), label: t('备份并修复', 'Back up and repair'),
      body: t('先备份清单、Profile 补丁和功能开关，再只保留内置插件：其他插件（包括官方可选插件）、远控和市场都会停用，Profile 补丁中的设置（如界面语言、对话显示）恢复默认。修复后应用会重启并打开设置向导。已安装的插件文件、共享会话和凭据会保留。',
        'Back up the manifest, Profile patch and feature switches, then keep only the built-in plugins: other plugins, official optional ones included, remote control and Market are turned off, and settings in the Profile patch, such as the interface language and conversation display, return to their defaults. The app then restarts and opens the setup wizard. Installed plugin files, shared sessions and credentials are kept.') },
    ...repair === undefined ? [] : [{ action: 'preview-checkpoint', id: repair.id, title: t('撤销上次修复', 'Undo the last repair'),
      label: t('恢复修复前的配置', 'Restore the previous configuration'),
      body: t(`恢复 ${repaired} 修复前备份的清单、Profile 补丁和功能开关。当前配置会先备份；导致故障的插件可能随之恢复。`,
        `Restore the manifest, Profile patch and feature switches backed up before the repair on ${repaired}. The current configuration is backed up first; a plugin that caused the failure may return with them.`) }],
    ...report === undefined ? [] : [report.status === 'failed'
      ? { action: 'export-diagnostics', title: t('诊断报告', 'Diagnostic report'), label: copy.saveDiagnostics,
        body: t('本次故障的诊断报告未能保存。反馈问题时，请导出诊断信息或提供此窗口的截图。',
          'The diagnostic report for this failure could not be saved. When asking for support, export diagnostics or provide a screenshot of this window.') }
      : { action: 'show-failure-report', title: t('诊断报告', 'Diagnostic report'), label: copy.showDiagnostics,
        body: reportName === undefined ? t('正在保存本次故障的诊断报告…', 'Saving the diagnostic report for this failure…')
          : t(`本次故障已保存为 ${reportName}，反馈问题时可作为附件。分享前请检查其中的本机路径和插件输出。`,
            `This failure was saved as ${reportName}; attach it when asking for support. Review it for local paths and plugin output before sharing.`) }],
  ]
  const recovery: RecoveryState = {
    locale, failureStage: state.failureStage ?? 'host-boot',
    failureDetail: state.failureExit === undefined ? state.failure : hostExitDetail(state.failureExit, locale), requested: !state.failure,
    snapshot: { profileName: state.selected, bundles: state.recovery?.bundles ?? [], checkpoints: (['slot-1', 'slot-2', 'slot-3'] as const).map((slotId, index) => {
      const checkpoint = state.recovery?.checkpoints[index]
      return { slotId, status: checkpoint ? 'available' as const : 'empty' as const,
        ...(checkpoint ? { capturedAt: checkpoint.created, fileCount: checkpoint.fileCount, totalBytes: checkpoint.totalBytes } : {}) }
    }) },
    ...(state.recovery?.error ? { snapshotError: state.recovery.error } : {}),
    profileDirectory: state.recovery?.profileDirectory,
    dataDirectory: { currentDirectory: state.home, usingDefaultDirectory: state.recovery?.usingDefaultDirectory ?? true, editing: false },
    busy: busy || state.busy, restartReady: true, activeTab: 'quick', configurationAvailable: true,
    diagnostics: state.recovery?.diagnosticsFile ? { status: 'saved', filename: state.recovery.diagnosticsFile } : { status: 'idle' }, logs: state.logs.slice(-24_000), profiles, profileActionToken: 'next', profileCreatorAvailable: true,
    terminalAvailable: state.platform === 'darwin' || state.platform === 'win32', safeModeAvailable: !state.safeMode, safeModeActive: state.safeMode,
    quickActions, notice: notice ?? (busy ? undefined : state.recovery?.notice),
  }
  return <RecoveryApp state={recovery} copy={copy} support={recoverySupport(locale)} />
}

createRoot(document.getElementById('root')!).render(<CSPProvider disableStyleElements><App /></CSPProvider>)
