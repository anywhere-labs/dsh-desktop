/**
 * The ACP bridge's section on its plugin detail page. Sections, fact lists and status lines follow the
 * page's own (来源信息, 版本), and every control is a shared official primitive; nothing here styles itself.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, DisclosureRow, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCopyOutlineRegular, IconRefreshOutlineRegular,
  SettingsForm, SettingsValueField, StateDot, Switch, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { detail, field } from './official-styles.js'
import { CONNECTIONS_PATH, type ConnectionState, type ManagementState, type StartupSettings } from '../management-contract.js'
import { callManagement, ManagementError, managementErrorText, readManagementWhenReady } from './management-client.js'
import { latestConnectionState, watchConnections, type LiveStatus } from './connections.js'

type Translate = (zh: string, en: string) => string
/** Each action marks only its own control busy. */
type Action = 'check' | 'save' | 'repair' | 'preference' | 'application'

const CHECK_LABELS: Record<string, string> = { Launcher: '启动脚本', Plugin: '插件文件', Runtime: '运行环境', 'Startup settings': '启动设置' }

export function Panel({ language }: { language: string }) {
  const zh = language.startsWith('zh')
  const t: Translate = (chinese, english) => zh ? chinese : english
  const [state, setState] = useState<ManagementState>()
  const [draft, setDraft] = useState<StartupSettings>()
  const [busy, setBusy] = useState<ReadonlySet<Action>>(new Set())
  const [error, setError] = useState<unknown>('')
  const [saveError, setSaveError] = useState('')
  const [preferenceError, setPreferenceError] = useState('')
  const [applicationError, setApplicationError] = useState('')
  const [pendingEnabled, setPendingEnabled] = useState<boolean>()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [live, setLive] = useState<ConnectionState>()
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const liveSequence = useRef(0)
  const refreshRequest = useRef<AbortController>()
  const running = useRef(new Set<Action>())
  const mounted = useRef(true)
  const managementLoaded = useRef(false)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    managementLoaded.current = false
    let loading = false
    let retryOnConnection = true
    async function load() {
      if (managementLoaded.current || loading || controller.signal.aborted) return
      loading = true
      setError('')
      try {
        const value = await readManagementWhenReady(controller.signal)
        if (!controller.signal.aborted) { managementLoaded.current = true; setState(value); setDraft(value.settings) }
      } catch (cause) {
        retryOnConnection = cause instanceof ManagementError && cause.kind === 'unavailable'
        if (!controller.signal.aborted) setError(cause)
      } finally { loading = false }
    }
    const unwatch = watchConnections(value => {
      liveSequence.current++
      setLive(previous => latestConnectionState(previous, value))
      setRefreshError('')
      if (retryOnConnection) void load()
    }, setLiveStatus)
    void load()
    return () => { mounted.current = false; controller.abort(); unwatch(); refreshRequest.current?.abort() }
  }, [])
  async function refreshConnections() {
    if (refreshRequest.current) return
    const controller = new AbortController()
    refreshRequest.current = controller
    const sequence = liveSequence.current
    setRefreshing(true); setRefreshError('')
    try {
      const response = await fetch(CONNECTIONS_PATH, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = await response.json() as ConnectionState
      // An older manual response must not replace a snapshot pushed while it was in flight.
      if (mounted.current && sequence === liveSequence.current) setLive(previous => latestConnectionState(previous, value))
    } catch (cause) {
      if (!controller.signal.aborted) setRefreshError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      refreshRequest.current = undefined
      if (mounted.current) setRefreshing(false)
    }
  }
  async function act(action: Action, settings?: StartupSettings) {
    // Serialize management reads and writes so a late check cannot overwrite a saved preference.
    if (running.current.size > 0) return
    running.current.add(action)
    setBusy(new Set(running.current))
    const setActionError = action === 'preference' ? setPreferenceError
      : action === 'application' ? setApplicationError : action === 'save' ? setSaveError : setError
    setActionError('')
    if (action === 'preference') setPendingEnabled(settings?.enabled)
    const autosave = action === 'preference' || action === 'application'
    try {
      const value = await callManagement(action === 'check' ? undefined
        : action === 'save' || autosave ? { action: 'save', settings: settings ?? draft } : { action })
      if (!mounted.current) return
      managementLoaded.current = true
      setState(value)
      setDraft(previous => {
        if (!previous || action === 'save') return value.settings
        // Immediate preferences must not submit or discard an edited timeout.
        const timeoutSeconds = previous.timeoutSeconds === state?.settings.timeoutSeconds
          ? value.settings.timeoutSeconds : previous.timeoutSeconds
        return { ...value.settings, timeoutSeconds }
      })
    } catch (cause) {
      if (!mounted.current) return
      setActionError(managementErrorText(cause, language))
    } finally {
      running.current.delete(action)
      if (mounted.current) {
        setPendingEnabled(undefined)
        setBusy(new Set(running.current))
      }
    }
  }
  if (!state || !draft) {
    return <div className={detail.detailSection}>
      {Boolean(error)
        ? <>
          <p className={detail.reason} role="alert">{managementErrorText(error, language)}</p>
          <div className={detail.detailActions}>
            <Button variant="primary" size="sm" disabled={busy.has('check')} onClick={() => { void act('check') }}>{t('重试', 'Retry')}</Button>
          </div>
        </>
        : <p className={detail.status} role="status">{t('正在读取', 'Loading')}</p>}
    </div>
  }
  const checkLabel = (label: string) => zh ? CHECK_LABELS[label] ?? label : label
  const count = (value: number, unit: string, noun: string) => zh ? `${value} 个${unit}` : `${value} ${noun}${value === 1 ? '' : 's'}`
  const timeoutValid = Number.isInteger(draft.timeoutSeconds) && draft.timeoutSeconds >= 1 && draft.timeoutSeconds <= 600
  const selected = state.profiles.find(profile => profile.name === draft.profile)
  const applications = state.applications ?? []
  const selectedApp = applications.find(app => app.id === state.settings.defaultApp) ?? applications.find(app => app.id === state.defaultApp)
  const appLabel = (app: typeof applications[number]) => {
    const sameName = applications.filter(other => other.name === app.name)
    const profile = sameName.length > 1 ? ` · ${app.profile}` : ''
    const directory = sameName.some(other => other.id !== app.id && other.profile === app.profile) ? ` · ${app.dshHome}` : ''
    return `${app.name}${profile}${directory}`
  }
  const launchable = Boolean(selectedApp) || (draft.mode === 'desktop' ? state.desktopAvailable : state.cliAvailable && selected?.valid === true)
  // Damaged saved settings stay savable, so the panel can overwrite them.
  const dirty = state.checks.some(check => check.label === 'Startup settings' && !check.ok)
    || JSON.stringify(state.settings) !== JSON.stringify(draft)
  const saving = busy.has('save')
  const managing = busy.size > 0
  const failedChecks = state.checks.filter(check => !check.ok)
  const settingsDamaged = failedChecks.some(check => check.label === 'Startup settings')
  const healthy = state.ready && failedChecks.length === 0
  const connections = live ?? state.live
  const toggleLabel = t('自动启动 DSH', 'Automatically start DSH')
  return <div className={detail.installedPanel}>
    <section className={detail.detailSection} aria-label={t('连接', 'Connection')}>
      <div className={detail.sectionHead}>
        <h4 className={detail.sectionTitle}>{t('连接', 'Connection')}</h4>
        <span className={detail.sectionCount}>{count(connections.connections, '连接', 'connection')} · {count(connections.sessions, '会话', 'session')}</span>
        <span className={detail.versionSpacer} />
        <Button variant="primary" size="sm" icon={<IconRefreshOutlineRegular size={13} />} disabled={refreshing}
          onClick={() => { void refreshConnections() }}>{refreshing ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh')}</Button>
        <CopyButton text={state.launcher} label={t('复制连接命令', 'Copy command')} copiedLabel={t('已复制', 'Copied')} />
      </div>
      <dl className={detail.facts}>
        <Fact label={t('ACP 服务', 'ACP service')}>
          <StateText ok={connections.ready} text={connections.ready ? t('已就绪', 'Ready') : t('未就绪', 'Not ready')} />
        </Fact>
        <Fact label={t('连接命令', 'Command')}><code>{state.launcher}</code></Fact>
      </dl>
      {liveStatus !== 'live' && <p className={detail.status} role="status">{liveStatus === 'connecting'
        ? t('正在连接实时更新…', 'Connecting to live updates…')
        : t('实时更新已中断，正在重连；当前显示上次状态', 'Live updates interrupted. Reconnecting; showing the last snapshot.')}</p>}
      {refreshError && <p className={detail.reason} role="alert">{refreshError}</p>}

    </section>
    <section className={detail.detailSection} aria-label={t('首选项', 'Preferences')}>
      <div className={detail.sectionHead}><h4 className={detail.sectionTitle}>{t('首选项', 'Preferences')}</h4></div>
      <div className={field.field}>
        <div className={field.head}>
          <span className={field.label}>{toggleLabel}</span>
          <Switch label={toggleLabel} checked={pendingEnabled ?? state.settings.enabled} disabled={managing}
            onChange={enabled => { void act('preference', { ...state.settings, enabled }) }} />
        </div>
        <p className={field.hint}>{t('客户端连接时，若 DSH 未运行则自动启动。', 'Start DSH when a client connects if it is not running.')}</p>
        {preferenceError && <p className={detail.reason} role="alert">{preferenceError}</p>}
      </div>
    </section>
    <section className={detail.detailSection} aria-label={t('启动配置', 'Startup')}>
      <div className={detail.sectionHead}><h4 className={detail.sectionTitle}>{t('启动配置', 'Startup')}</h4></div>
      {applications.length <= 1 && <dl className={detail.facts}>
        <Fact label={t('默认应用', 'Default application')}>{selectedApp ? appLabel(selectedApp) : t('暂无可用应用', 'No application available')}</Fact>
      </dl>}
      {applications.length > 1 && applications.map(app => <div key={app.id} className={field.head}>
        <span className={field.label}>{appLabel(app)}</span>
        {selectedApp?.id === app.id
          ? <span className={detail.rowState}><StateDot state="done" />{t('默认', 'Default')}</span>
          : <Button variant="primary" size="sm" disabled={managing}
            onClick={() => { void act('application', { ...state.settings, defaultApp: app.id, mode: 'desktop', profile: '' }) }}>
            {t('设为默认', 'Set as default')}</Button>}
      </div>)}
      {applicationError && <p className={detail.reason} role="alert">{applicationError}</p>}
      {state.settings.enabled && !launchable && <p className={detail.reason}>{t('暂无可用的启动配置，请先手动启动 DSH。', 'No startup configuration is available. Start DSH manually.')}</p>}
      {state.settings.enabled && selectedApp && !selectedApp.background && <p className={field.hint}>{t('启动时可能打开窗口。', 'Startup may open a window.')}</p>}
      <DisclosureRow title={t('高级设置', 'Advanced settings')} icon={<IconChevronDownOutlineRegular />} previewChevron={false}
        open={advancedOpen} expandable expandOnRowClick onToggle={() => { setAdvancedOpen(!advancedOpen) }}>
        <div className={detail.detailSections}>
          <SettingsForm
            state={{ available: true, writable: true, dirty, invalid: managing || !timeoutValid || (draft.enabled && !launchable), saving, failed: saveError !== '' }}
            labels={{ unavailable: '', readOnly: '', saveFailed: saveError, save: t('保存', 'Save'), saving: t('保存中…', 'Saving…') }}
            onSave={() => { void act('save') }} onDiscard={() => {}}>
            <SettingsValueField id="acp-bridge-start-timeout" label={t('启动等待时间（秒）', 'Startup timeout (seconds)')} numeric
              hint={t('1–600，默认 90', '1–600, 90 by default')}
              text={Number.isNaN(draft.timeoutSeconds) ? '' : String(draft.timeoutSeconds)} invalid={!timeoutValid}
              invalidLabel={t('请输入 1–600 之间的整数', 'Enter a whole number from 1 to 600')}
              overridden={false} overriddenLabel="" resetLabel="" onReset={() => {}} disabled={managing || !state.settings.enabled}
              onEdit={text => { setDraft({ ...draft, timeoutSeconds: text.trim() === '' ? Number.NaN : Number(text) }) }} />
          </SettingsForm>
          {applications.length > 0 && <section className={detail.detailSection}>
            <div className={detail.sectionHead}><h4 className={detail.sectionTitle}>{t('指定应用连接', 'Connect to a specific application')}</h4></div>
            <p className={field.hint}>{t('将复制的参数填入客户端的 args。', 'Paste the copied arguments into the client’s args.')}</p>
            {applications.map(app => <div key={app.id} className={field.head}>
              <span className={field.label}>{appLabel(app)}</span>
              <CopyButton text={JSON.stringify(['--app', app.id])} label={t('复制参数', 'Copy arguments')} copiedLabel={t('已复制', 'Copied')} />
            </div>)}
          </section>}
        </div>
      </DisclosureRow>
    </section>
    <section className={detail.detailSection} aria-label={t('诊断', 'Diagnostics')}>
      <div className={detail.sectionHead}>
        <h4 className={detail.sectionTitle}>{t('连接环境', 'Connection environment')}</h4>
        <StateText ok={healthy} text={healthy ? t('正常', 'OK') : t('异常', 'Needs attention')} />
        <span className={detail.versionSpacer} />
        <Button variant="primary" size="sm" icon={<IconRefreshOutlineRegular size={13} />} disabled={managing}
          onClick={() => { void act('check') }}>{busy.has('check') ? t('检查中…', 'Checking…') : t('重新检查', 'Check again')}</Button>
      </div>
      {Boolean(error) && <p className={detail.reason} role="alert">{managementErrorText(error, language)}</p>}
      {!state.ready && <p className={detail.reason}>{t('ACP 服务尚未就绪。', 'The ACP service is not ready.')}</p>}
      {failedChecks.map(check => <p key={check.label} className={detail.reason}>{checkLabel(check.label)}{zh ? '：' : ': '}{check.detail}</p>)}
      {settingsDamaged && <p className={detail.reason}>{t('请在高级设置中重新保存启动配置。', 'Save the startup configuration again in Advanced settings.')}</p>}
      {failedChecks.some(check => check.label === 'Launcher') && <div className={detail.detailActions}>
        <Button variant="primary" size="sm" disabled={managing || !state.ready}
          onClick={() => { void act('repair') }}>{busy.has('repair') ? t('修复中…', 'Repairing…') : t('修复启动脚本', 'Repair launcher')}</Button>
      </div>}
      <DisclosureRow title={t('诊断详情', 'Diagnostic details')} icon={<IconChevronDownOutlineRegular />} previewChevron={false}
        open={diagnosticsOpen} expandable expandOnRowClick onToggle={() => { setDiagnosticsOpen(!diagnosticsOpen) }}>
        <div className={detail.detailSection}>
          <div>
            {state.checks.map(check => <div key={check.label} className={field.field}>
              <div className={field.head}>
                <span className={field.label}>{checkLabel(check.label)}</span>
                <StateText ok={check.ok} text={check.ok ? t('正常', 'OK') : t('异常', 'Failed')} />
              </div>
              <p className={detail.subjectSpec}>{check.detail}</p>
            </div>)}
            {state.lastStart && <div className={field.field}>
              <div className={field.head}>
                <span className={field.label}>{t('最近一次启动', 'Last start')}</span>
                <StateText ok={state.lastStart.ok} text={state.lastStart.ok ? t('成功', 'Succeeded') : t('失败', 'Failed')} />
              </div>
              <p className={field.hint}>{new Date(state.lastStart.at).toLocaleString(language)}</p>
              <p className={detail.subjectMeta}>{state.lastStart.message}</p>
            </div>}
          </div>
          <div className={detail.detailActions}>
            <CopyButton text={JSON.stringify({ ...state, live: connections, ready: connections.ready,
              connections: connections.connections, sessions: connections.sessions }, null, 2)} label={t('复制诊断信息', 'Copy diagnostics')} copiedLabel={t('已复制', 'Copied')} />
          </div>
          <p className={field.hint}>{t('含本机路径、客户端信息和会话标题。', 'Includes local paths, client information and session titles.')}</p>
        </div>
      </DisclosureRow>
    </section>
  </div>
}

/** One row of the page's fact list, as 来源信息 draws it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

/** A state dot with its text, as the component rows show their state. */
function StateText({ ok, text, title }: { ok: boolean; text: string; title?: string }) {
  return <span className={detail.rowState} title={title}><StateDot state={ok ? 'done' : 'error'} />{text}</span>
}

/** A copy action with the official one-second confirmation. */
function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const { copied, onCopy } = useClipboardCopy(text)
  return <Button variant="primary" size="sm" icon={copied ? <IconCheckOutlineRegular size={13} /> : <IconCopyOutlineRegular size={13} />}
    onClick={onCopy}>{copied ? copiedLabel : label}</Button>
}
