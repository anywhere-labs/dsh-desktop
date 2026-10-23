/** Configure the shipped provider through the official Plugins slot and manager. */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, StateDot, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { ComputerUsePluginArtwork } from './computer-use-command-ui.tsx'
import { DesktopPermissionsButton, PermissionDetails } from './permissions.tsx'

const PROVIDER = '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
const COMPUTER_USE_SETTINGS_ROUTE = '/api/desktop-next/computer-use'

interface ComputerUseCacheEntry {
  loaded: boolean
  row: PluginInfo | undefined
  commandMode: boolean
  commandModeLoaded: boolean
}

const computerUseCache = new WeakMap<Context, ComputerUseCacheEntry>()

function getComputerUseCache(context: Context): ComputerUseCacheEntry {
  let entry = computerUseCache.get(context)
  if (!entry) {
    entry = { loaded: false, row: undefined, commandMode: true, commandModeLoaded: false }
    computerUseCache.set(context, entry)
  }
  return entry
}

export function ComputerUseSettings({ context, zh, mode = 'overview' }: { context: Context; zh: boolean; mode?: 'overview' | 'actions' | 'page' }) {
  const t = (chinese: string, english: string): string => zh ? chinese : english
  const cache = getComputerUseCache(context)
  const [revision, refresh] = useState(0)
  const [row, setRow] = useState<PluginInfo | undefined>(() => cache.row)
  const [loading, setLoading] = useState(() => !cache.loaded)
  const [busy, setBusy] = useState(false)
  const [commandMode, setCommandMode] = useState<boolean>(() => cache.commandMode)
  const [commandBusy, setCommandBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const reload = (): void => { refresh(value => value + 1) }
    const off = context.remote.$on('plugin-manager/changed', reload)
    const reset = context.on('connection/reset', reload)
    window.addEventListener('focus', reload)
    return () => { off(); reset(); window.removeEventListener('focus', reload) }
  }, [context])
  useEffect(() => {
    let disposed = false
    if (!cache.loaded) setLoading(true)
    void context.remote.pluginManager.listPlugins().then(result => {
      if (disposed) return
      if (!result.ok) throw new Error(result.error.message)
      const rows = result.value.filter(item => item.moduleName === PROVIDER)
      const next = rows.length === 1 ? rows[0] : undefined
      cache.row = next
      cache.loaded = true
      setRow(next)
    }).catch(failure => {
      if (!disposed) {
        if (!cache.loaded) setRow(undefined)
        setError(String(failure))
      }
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [cache, context, revision])
  useEffect(() => {
    if (mode !== 'page' || typeof fetch !== 'function') return
    let disposed = false
    void fetch(COMPUTER_USE_SETTINGS_ROUTE, { method: 'GET' })
      .then(async response => {
        if (!response.ok) return
        const payload = await response.json() as { commandMode?: unknown } | null
        if (!disposed && payload && typeof payload.commandMode === 'boolean') {
          cache.commandMode = payload.commandMode
          cache.commandModeLoaded = true
          setCommandMode(payload.commandMode)
        }
      })
      .catch(() => {
        // Keep the cached/default commandMode if the Host route is unreachable in a mock environment.
      })
    return () => { disposed = true }
  }, [cache, mode, revision])
  const change = async (enabled: boolean): Promise<void> => {
    if (!row || busy || loading) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await context.remote.pluginManager.setPluginEnabled(row.entryId, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      if (change.application === 'restart-required') setNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
      if (change.application === 'overridden') setNotice(t('已保存，但当前配置覆盖了此开关。', 'Saved, but another configuration overrides this switch.'))
      const next = { ...row, enabled }
      cache.row = next
      setRow(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); refresh(value => value + 1) }
  }
  const changeCommandMode = async (nextMode: boolean): Promise<void> => {
    if (busy || commandBusy || loading) return
    setCommandBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(COMPUTER_USE_SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandMode: nextMode }),
      })
      if (!response.ok) {
        throw new Error(t('无法保存 Computer Use 命令模式设置。', 'Could not save the Computer Use command mode setting.'))
      }
      const payload = await response.json() as { commandMode?: unknown } | null
      const resolved = payload && typeof payload.commandMode === 'boolean' ? payload.commandMode : nextMode
      cache.commandMode = resolved
      cache.commandModeLoaded = true
      setCommandMode(resolved)
      setNotice(
        resolved
          ? t('已开启按需命令加载（/computer-use）。', 'On-demand command loading (/computer-use) enabled.')
          : t('已关闭按需命令加载，Computer Use 工具将在所有会话中常驻。', 'On-demand command loading disabled; Computer Use tools remain active across sessions.'),
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setCommandBusy(false)
    }
  }
  const status = loading ? t('正在读取…', 'Loading…') : !row ? t('当前 Profile 中不可用', 'Unavailable in this Profile')
    : !row.enabled ? t('已停用', 'Disabled') : row.fiberPhase === 'active' ? t('运行中', 'Running')
      : row.fiberPhase === 'failed' ? t('加载失败', 'Failed to load') : t('等待加载', 'Waiting to load')
  const commandSwitchLabel = t('按需命令加载（/computer-use）', 'On-demand command loading (/computer-use)')
  const commandActive = Boolean(row?.enabled && commandMode)
  return <div className="dshNextComputerUse" data-next-computer-use>
    {mode !== 'page' && <>
      <div className="dshNextPluginActions">
        <DesktopPermissionsButton service={window.desktopNext?.permissions} language={zh ? 'zh' : 'en'} label={t('权限设置', 'Permission settings')} />
        <Switch label={t('启用 Computer Use', 'Enable Computer Use')} checked={row?.enabled ?? false}
          disabled={loading || busy || !row || row.readOnlyReason !== undefined} onChange={enabled => { void change(enabled) }} />
      </div>
    </>}
    {mode === 'page' && <>
      <p className="dshDesktopSettingsHint"><code>{PROVIDER}</code></p>
      <p role="status" className="dshNextPermissionStatus"><StateDot state={row?.enabled && row.fiberPhase === 'active' ? 'done' : row?.fiberPhase === 'failed' ? 'error' : 'idle'} />{status}</p>
      <section className="dshNextComponentSection" data-next-computer-use-options>
        <div className="dshNextComponentSectionHead">
          <h4 className="dshNextComponentSectionTitle">{t('包含的组件', 'Components')}</h4>
          <span className="dshNextComponentSectionCount">
            {commandActive
              ? t('共 1 个 · 1 运行中', '1 total · 1 running')
              : t('共 1 个 · 1 已停用', '1 total · 1 off')}
          </span>
        </div>
        <ul className="dshNextComponentRows">
          <li
            className="dshNextComponentRow"
            data-plugin-row="computer-use-command"
            {...(commandActive ? {} : { 'data-state': 'off' })}
          >
            <div className="dshNextComponentRowLine">
              <span className="dshNextComponentRowIcon" aria-hidden="true">
                <ComputerUsePluginArtwork size={30} />
              </span>
              <div className="dshNextComponentRowMain">
                <span className="dshNextComponentRowId">{commandSwitchLabel}</span>
                <span className="dshNextComponentRowModule">
                  {t(
                    '默认开启：普通会话不常驻加载 Computer Use 工具与系统提示词，避免占用上下文；需要时可在会话中通过 /computer-use 命令手动加载（/computer-use off 关闭）。若关闭此项，则恢复在所有会话中常驻加载。',
                    'Enabled by default: Computer Use tools and guidance are not loaded into sessions by default to save context; run /computer-use in a session to load them on demand (/computer-use off to unload). Turn off to keep them resident in all sessions.',
                  )}
                </span>
                <code className="dshNextComponentRowModule">computer-use</code>
                <code className="dshNextComponentRowModule">{PROVIDER}</code>
              </div>
              <span className="dshNextComponentRowState">
                <StateDot state={commandActive ? 'done' : 'idle'} />
                {commandActive ? t('运行中', 'Running') : t('已关闭', 'Off')}
              </span>
              {row?.enabled ? (
                <Switch
                  label={commandSwitchLabel}
                  checked={commandMode}
                  disabled={loading || busy || commandBusy}
                  onChange={enabled => { void changeCommandMode(enabled) }}
                />
              ) : null}
            </div>
          </li>
        </ul>
      </section>
      {window.desktopNext?.permissions ? <PermissionDetails service={window.desktopNext.permissions} language={zh ? 'zh' : 'en'} />
        : <p>{t('请在运行 DSH 的桌面应用中管理系统权限。', 'Manage system permissions in the desktop app running DSH.')}</p>}
    </>}
    {notice && <Toast text={notice} onDone={() => { setNotice('') }} />}
    {error && <Toast text={error} onDone={() => { setError('') }} />}
    {error && <div className="dshNextPluginActions"><Button variant="outline" size="sm" onClick={() => { setError(''); refresh(value => value + 1) }}>{t('重试', 'Retry')}</Button></div>}
  </div>
}
