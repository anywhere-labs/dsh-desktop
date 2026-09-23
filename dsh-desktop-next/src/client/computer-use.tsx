/** Configure the shipped provider through the official Plugins slot and manager. */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesktopPermissionsButton } from './permissions.tsx'

const PROVIDER = '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'

export function ComputerUseSettings({ context, zh }: { context: Context; zh: boolean }) {
  const t = (chinese: string, english: string): string => zh ? chinese : english
  const [revision, refresh] = useState(0)
  const [row, setRow] = useState<PluginInfo>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
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
    setLoading(true)
    void context.remote.pluginManager.listPlugins().then(result => {
      if (disposed) return
      if (!result.ok) throw new Error(result.error.message)
      const rows = result.value.filter(item => item.moduleName === PROVIDER)
      setRow(rows.length === 1 ? rows[0] : undefined)
    }).catch(failure => { if (!disposed) { setRow(undefined); setError(String(failure)) } })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [context, revision])
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
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); refresh(value => value + 1) }
  }
  const status = loading ? t('正在读取…', 'Loading…') : !row ? t('当前 Profile 中不可用', 'Unavailable in this Profile')
    : !row.enabled ? t('已停用', 'Disabled') : row.fiberPhase === 'active' ? t('运行中', 'Running')
      : row.fiberPhase === 'failed' ? t('加载失败', 'Failed to load') : t('等待加载', 'Waiting to load')
  return <div className="dshNextComputerUse" data-next-computer-use>
    <div className="dshNextPluginHeading">
      <h3 id="next-computer-use-title">Computer Use</h3>
      <div className="dshNextPluginActions">
        <DesktopPermissionsButton service={window.desktopNext?.permissions} language={zh ? 'zh' : 'en'} iconOnly />
        <Switch label={t('启用 Computer Use', 'Enable Computer Use')} checked={row?.enabled ?? false}
          disabled={loading || busy || !row || row.readOnlyReason !== undefined} onChange={enabled => { void change(enabled) }} />
      </div>
    </div>
    <p className="dshDesktopSettingsHint">{t('让 AI 查看屏幕、操作鼠标和键盘。截图理解需要支持图片输入的模型。', 'Let AI view the screen and control the mouse and keyboard. Understanding screenshots requires a model with image input.')}</p>
    <p role="status" className="dshDesktopSettingsHint">{status}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="dshDesktopSettingsError">{error}</p>}
    {error && <div className="dshNextPluginActions"><Button variant="outline" size="sm" onClick={() => { setError(''); refresh(value => value + 1) }}>{t('重试', 'Retry')}</Button></div>}
  </div>
}
