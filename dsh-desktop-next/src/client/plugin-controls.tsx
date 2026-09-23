/** Desktop choices on the official Plugins overview, using its manager and existing controls. */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, IconSettingsOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { Choice, MARKET_OPTIONS, marketBody, marketTitle } from '../../../dsh-plugin-desktop-beta/src/client/DesktopSettingsSection.tsx'
import { en as desktopEn, zh as desktopZh, type DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop-beta/src/client/desktop-settings-locales.ts'
import { ComputerUseSettings } from './computer-use.tsx'

const COMMUNITY = 'dsh-community-market'
const MARKET = 'dshmarket'
const REMOTE = '@agents-anywhere/dsh-bridge-next'

export function registerPluginControls(ctx: Context): void {
  ctx.inject(['remote', 'remote.pluginManager'], inner => {
    inner.slots.inject('plugins.overview', () => {
      const dispose = inner.slots.register({ name: 'plugins.overview', id: 'desktop-next', order: 0,
        locale: 'desktop-next', inject: () => ({ context: inner }),
      }, PluginControls)
      const hidden = [COMMUNITY, MARKET, REMOTE].map(key => inner.slots.register({ name: 'plugins.bundle.hidden', key }, () => null))
      return () => { for (const off of hidden) off(); dispose() }
    })
  })
}

function PluginControls({ context, t: translate }: PropsLocale<'desktop-next'> & { context: Context }) {
  const zh = translate('language') === 'zh'
  const t = (cn: string, en: string): string => zh ? cn : en
  const desktopCopy = zh ? desktopZh : desktopEn
  const desktopText = (key: string): string => Object.hasOwn(desktopCopy, key) ? desktopCopy[key as DesktopSettingsLocaleKey] : key
  const [bundles, setBundles] = useState<BundleInfo[]>([])
  const [revision, refresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
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
    void context.remote.pluginManager.listBundles().then(result => {
      if (disposed) return
      if (!result.ok) throw new Error(result.error.message)
      setBundles(result.value)
    }).catch(failure => { if (!disposed) { setBundles([]); setError(String(failure)) } })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [context, revision])
  const change = async (name: string, enabled: boolean): Promise<void> => {
    if (pending.current || loading) return
    pending.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      // The Host applies the exclusive market group in one locked manifest write.
      const result = await context.remote.pluginManager.setBundleEnabled(name, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed' || change.application === 'cancelled') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      if (change.application === 'restart-required') setNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
      if (change.application === 'overridden') setNotice(t('已保存，但当前配置覆盖了此选择。', 'Saved, but another configuration overrides this choice.'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { pending.current = false; setBusy(false); refresh(value => value + 1) }
  }
  const community = bundles.find(row => row.name === COMMUNITY)
  const market = bundles.find(row => row.name === MARKET)
  const remote = bundles.find(row => row.name === REMOTE)
  const bothMarkets = community?.enabled === true && market?.enabled === true
  const locked = (row?: BundleInfo): boolean => loading || busy || !row || row.readOnlyReason !== undefined || row.error !== undefined
  const openRemoteSettings = (): void => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="sidebar.footer.action"] button[aria-label="手机连接"][aria-haspopup="dialog"]')
    if (trigger) { setError(''); trigger.click() }
    else setError(t('远程控制界面尚未就绪，请稍后重试。', 'Remote control is not ready yet. Try again shortly.'))
  }
  return <div className="dshNextPluginControls" data-next-plugin-controls>
    <section className="dshDesktopSettingsGroup" data-next-markets aria-labelledby="next-market-title">
      <div><h3 id="next-market-title">{desktopText('marketTitle')}</h3>
        <p className="dshDesktopSettingsGroupIntro">{desktopText('marketIntro')}</p></div>
      <div className="dshNextMarketChoices" role="radiogroup" aria-labelledby="next-market-title">
        {MARKET_OPTIONS.filter(option => option.id !== 'disabled').map(option => {
          const isCommunity = option.id === 'community-market'
          const row = isCommunity ? community : market
          return <Choice key={option.id} title={marketTitle(option, desktopText)} body={marketBody(option, desktopText)}
            badge={isCommunity ? desktopText('beta') : undefined} selected={row?.enabled === true && !bothMarkets}
            disabled={locked(row)} action={() => { void change(isCommunity ? COMMUNITY : MARKET, true) }} />
        })}
      </div>
      {bothMarkets && <p role="status" className="dshDesktopSettingsHint">{t('当前两个市场均已开启，请选择保留其中一个。', 'Both markets are currently enabled. Choose which one to keep.')}</p>}
    </section>
    <div className="dshNextPluginSections">
      <section className="dshDesktopSettingsGroup" data-next-remote-control aria-labelledby="next-remote-title">
        <div className="dshNextPluginHeading"><h3 id="next-remote-title">{t('远程控制', 'Remote control')}</h3>
          <div className="dshNextPluginActions">
            <Button variant="ghost" size="sm" className="dshNextSettingsGear" icon={<IconSettingsOutlineRegular />}
              aria-label={t('远程控制设置', 'Remote control settings')} title={remote?.enabled ? t('远程控制设置', 'Remote control settings') : t('启用远程控制后打开设置', 'Enable remote control to open settings')}
              disabled={!remote?.enabled || loading || busy} onClick={openRemoteSettings} />
            <Switch label={t('启用远程控制', 'Enable remote control')} checked={remote?.enabled ?? false} disabled={locked(remote)} onChange={enabled => { void change(REMOTE, enabled) }} />
          </div></div>
        <p className="dshDesktopSettingsHint">{t('通过 Agents Anywhere 从手机或其他设备连接。启用后，在侧边栏的“手机连接”中完成配对。', 'Connect from your phone or another device with Agents Anywhere. After enabling, pair it from Phone connection in the sidebar.')}</p>
      </section>
      <section className="dshDesktopSettingsGroup" aria-labelledby="next-computer-use-title">
        <ComputerUseSettings context={context} zh={zh} />
      </section>
    </div>
    {notice && <p role="status" className="dshDesktopSettingsHint">{notice}</p>}
    {error && <div role="alert" className="dshDesktopSettingsError">{error} <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => { setError(''); refresh(value => value + 1) }}>{t('重试', 'Retry')}</Button></div>}
  </div>
}
