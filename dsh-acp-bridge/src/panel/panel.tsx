/**
 * The ACP bridge's section on its plugin detail page. Sections, fact lists and status lines follow the
 * page's own (来源信息, 版本), and every control is a shared official primitive; nothing here styles itself.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, DisclosureRow, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCopyOutlineRegular, IconRefreshOutlineRegular,
  StateDot, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { detail, field } from './official-styles.js'
import { CONNECTIONS_PATH, type ConnectionState, type ManagementState } from '../management-contract.js'
import { callManagement, ManagementError, managementErrorText, readManagementWhenReady } from './management-client.js'
import { latestConnectionState, watchConnections, type LiveStatus } from './connections.js'

type Translate = (zh: string, en: string) => string
/** Each action marks only its own control busy. */
type Action = 'check' | 'repair'

const CHECK_LABELS: Record<string, string> = { Launcher: '启动脚本', Plugin: '插件文件', Runtime: '运行环境' }

export function Panel({ language }: { language: string }) {
  const zh = language.startsWith('zh')
  const t: Translate = (chinese, english) => zh ? chinese : english
  const [state, setState] = useState<ManagementState>()
  const [busy, setBusy] = useState<ReadonlySet<Action>>(new Set())
  const [error, setError] = useState<unknown>('')
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
        if (!controller.signal.aborted) { managementLoaded.current = true; setState(value) }
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
  async function act(action: Action) {
    // Serialize management reads and repairs so a late check cannot overwrite a repair's result.
    if (running.current.size > 0) return
    running.current.add(action)
    setBusy(new Set(running.current))
    setError('')
    try {
      const value = await callManagement(action === 'check' ? undefined : { action })
      if (!mounted.current) return
      managementLoaded.current = true
      setState(value)
    } catch (cause) {
      if (mounted.current) setError(managementErrorText(cause, language))
    } finally {
      running.current.delete(action)
      if (mounted.current) setBusy(new Set(running.current))
    }
  }
  if (!state) {
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
  const managing = busy.size > 0
  const failedChecks = state.checks.filter(check => !check.ok)
  const healthy = state.ready && failedChecks.length === 0
  const connections = live ?? state.live
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
