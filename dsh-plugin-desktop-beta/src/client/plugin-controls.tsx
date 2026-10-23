/** Desktop choices on the official Plugins overview, using its manager and existing controls. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-plugin-market/types'
import {
  Button, IconWarningOutlineRegular, Modal, PluginArtworkDefault, StateDot, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { readMarketState } from '../../../dsh-community-market/src/client/api.ts'
import { Choice, MARKET_OPTIONS, marketBody, marketTitle } from './DesktopSettingsSection.tsx'
import { en as desktopEn, zh as desktopZh, type DesktopSettingsLocaleKey } from '../../../dsh-plugin-desktop/src/client/desktop-settings-locales.ts'
import { ComputerUseSettings } from './computer-use.tsx'
import { ComputerUsePluginArtwork } from './computer-use-command-ui.tsx'
import {
  BUILT_IN_MARKET_SOURCES, COMMUNITY_MARKET as COMMUNITY, configureSingleMarketToOfficial, DSH_MARKET as MARKET,
  importMarketSourcesToOfficial, marketToggleTargets, OFFICIAL_CONFIGURABLE_MARKET_SOURCES, OFFICIAL_MARKET,
  removeMarketSourcesFromOfficial, resolveActiveMarketSource, toggleMarketEndpointInOfficial,
  type BuiltInMarketKey, type MarketName, type MarketRuntimeState,
} from './market-toggle.ts'

const REMOTE = '@agents-anywhere/dsh-bridge-next'
const COMPUTER_ITEM = 'desktop-next-computer-use'

type Translate = (cn: string, en: string) => string

interface BundlesCacheEntry {
  loaded: boolean
  bundles: BundleInfo[]
  preferredMarket: MarketName
}

const bundlesCache = new WeakMap<Context, BundlesCacheEntry>()

function getBundlesCache(context: Context): BundlesCacheEntry {
  let entry = bundlesCache.get(context)
  if (!entry) {
    const official = readOfficialBundles(context)
    const community = official?.find(row => row.name === COMMUNITY)
    const market = official?.find(row => row.name === MARKET)
    const preferredMarket: MarketName = market?.enabled && !community?.enabled ? MARKET : COMMUNITY
    entry = {
      loaded: official !== undefined,
      bundles: official ?? [],
      preferredMarket,
    }
    bundlesCache.set(context, entry)
  } else if (!entry.loaded) {
    const official = readOfficialBundles(context)
    if (official !== undefined) {
      entry.loaded = true
      entry.bundles = official
      const community = official.find(row => row.name === COMMUNITY)
      const market = official.find(row => row.name === MARKET)
      if (market?.enabled && !community?.enabled) entry.preferredMarket = MARKET
      else if (community?.enabled && !market?.enabled) entry.preferredMarket = COMMUNITY
    }
  }
  return entry
}

// The cache fills on the first mount, never at registration. listBundles reads
// every bundle manifest synchronously on the Host and listPlugins walks the
// whole inventory; calling them at startup stalls the account, credential, and
// onboarding RPCs the first window waits on (the official manager loads lazily).
export function registerPluginControls(ctx: Context): void {
  ctx.inject(['remote', 'remote.pluginManager', 'remote.pluginMarket'], inner => {
    inner.slots.inject('plugins.overview', () => {
      const dispose = inner.slots.register({ name: 'plugins.overview', id: 'desktop-next', order: 0,
        locale: 'desktop-next', inject: () => ({ context: inner }),
      }, PluginControls)
      const hidden = [COMMUNITY, MARKET, REMOTE].map(key => inner.slots.register({ name: 'plugins.bundle.hidden', key }, () => null))
      const item = inner.slots.register({ name: 'plugins.item', id: COMPUTER_ITEM, label: 'Computer Use',
        locale: 'desktop-next', inject: () => ({ context: inner }),
      }, ComputerUseItem)
      const hiddenItem = inner.slots.register({ name: 'plugins.item.hidden', key: COMPUTER_ITEM }, () => null)
      const actions = inner.slots.register({ name: 'plugins.detail.actions', id: COMPUTER_ITEM,
        locale: 'desktop-next', inject: () => ({ context: inner }),
      }, ComputerUseActions)
      return () => { actions(); hiddenItem(); item(); for (const off of hidden) off(); dispose() }
    })
  })
}

function PluginControls({ context, t: translate, onOpenBundle, onOpenItem }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.overview'> & { context: Context }) {
  const zh = translate('language') === 'zh'
  const t = (cn: string, en: string): string => zh ? cn : en
  const desktopCopy = zh ? desktopZh : desktopEn
  const desktopText = (key: string): string => Object.hasOwn(desktopCopy, key) ? desktopCopy[key as DesktopSettingsLocaleKey] : key
  const cache = getBundlesCache(context)
  const [bundles, setBundles] = useState<BundleInfo[]>(() => cache.bundles)
  const [revision, refresh] = useState(0)
  const [loading, setLoading] = useState(() => !cache.loaded)
  const [busy, setBusy] = useState(false)
  const [preferredMarket, setPreferredMarket] = useState<MarketName>(() => cache.preferredMarket)
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
    if (!cache.loaded) setLoading(true)
    void context.remote.pluginManager.listBundles().then(result => {
      if (disposed) return
      if (!result.ok) throw new Error(result.error.message)
      cache.bundles = result.value
      cache.loaded = true
      setBundles(result.value)
    }).catch(failure => {
      if (!disposed) {
        if (!cache.loaded) setBundles([])
        setError(String(failure))
      }
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [cache, context, revision])
  const community = bundles.find(row => row.name === COMMUNITY)
  const market = bundles.find(row => row.name === MARKET)
  const remoteRow = bundles.find(row => row.name === REMOTE)
  useEffect(() => {
    if (community?.enabled && !market?.enabled) {
      cache.preferredMarket = COMMUNITY
      setPreferredMarket(COMMUNITY)
    }
    if (market?.enabled && !community?.enabled) {
      cache.preferredMarket = MARKET
      setPreferredMarket(MARKET)
    }
  }, [cache, community?.enabled, market?.enabled])
  const change = async (names: readonly string[], enabled: boolean): Promise<void> => {
    if (pending.current || loading) return
    pending.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      // Each Host operation writes its selection under the official Profile lock.
      for (const name of names) {
        const result = await context.remote.pluginManager.setBundleEnabled(name, enabled)
        if (!result.ok) throw new Error(result.error.message)
        const change = result.value
        if (change.application === 'failed' || change.application === 'cancelled') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
        if (change.application === 'restart-required') setNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
        if (change.application === 'overridden') setNotice(t('已保存，但当前配置覆盖了此选择。', 'Saved, but another configuration overrides this choice.'))
        if (enabled && (name === COMMUNITY || name === MARKET)) {
          cache.preferredMarket = name
          setPreferredMarket(name)
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { pending.current = false; setBusy(false); refresh(value => value + 1) }
  }
  const bothMarkets = community?.enabled === true && market?.enabled === true
  const locked = (row?: BundleInfo): boolean => loading || busy || !row || row.readOnlyReason !== undefined || row.error !== undefined
  const activeMarkets = [community, market].flatMap(row => row?.enabled === true ? [row] : [])
  const marketToggleLocked = loading || busy || marketToggleTargets(bundles, preferredMarket, activeMarkets.length === 0).length === 0
  return <div className="dshNextPluginControls" data-next-plugin-controls>
    <section className="dshDesktopSettingsGroup" data-next-markets aria-labelledby="next-market-title">
      <div className="dshNextMarketHeader">
        <div><h3 id="next-market-title">{desktopText('marketTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{desktopText('marketIntro')}</p></div>
        <div className="dshNextPluginActions">
          <MarketSourcesButton context={context} bundles={bundles} preferredMarket={preferredMarket} zh={zh}
            disabled={loading || busy} onChanged={() => {
              refresh(value => value + 1)
            }} />
          <Switch label={t('启用插件市场', 'Enable plugin market')} checked={activeMarkets.length > 0}
            disabled={marketToggleLocked} onChange={enabled => {
              void change(marketToggleTargets(bundles, preferredMarket, enabled), enabled)
            }} />
        </div>
      </div>
      <div className="dshNextMarketChoices" role="radiogroup" aria-labelledby="next-market-title">
        {MARKET_OPTIONS.filter(option => option.id !== 'disabled').map(option => {
          const isCommunity = option.id === 'community-market'
          const row = isCommunity ? community : market
          return <Choice key={option.id} title={marketTitle(option, desktopText)} body={marketBody(option, desktopText)}
            badge={isCommunity ? desktopText('beta') : undefined} selected={row?.enabled === true && !bothMarkets}
            disabled={locked(row)} action={() => { void change([isCommunity ? COMMUNITY : MARKET], true) }} />
        })}
      </div>
      {bothMarkets && <p role="status" className="dshDesktopSettingsHint">{t('当前两个市场均已开启，请选择保留其中一个。', 'Both markets are currently enabled. Choose which one to keep.')}</p>}
    </section>
    <div className="dshNextPluginSections">
      <PluginCard title={t('远程控制', 'Remote Control')} description={remoteDescription(t)}
        icon={<PluginArtworkDefault size={36} />} onOpen={() => { onOpenBundle(REMOTE) }}>
        <RemoteControlSettings context={context} t={t} row={remoteRow} loading={loading}
          onChanged={() => { refresh(value => value + 1) }} />
      </PluginCard>
      <PluginCard title="Computer Use" description={computerDescription(t)}
        icon={<ComputerUsePluginArtwork size={36} />} onOpen={() => { onOpenItem(COMPUTER_ITEM) }}>
        <ComputerUseSettings context={context} zh={zh} />
      </PluginCard>
    </div>
    {notice && <p role="status" className="dshDesktopSettingsHint">{notice}</p>}
    {error && <div role="alert" className="dshDesktopSettingsError">{error} <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => { setError(''); refresh(value => value + 1) }}>{t('重试', 'Retry')}</Button></div>}
  </div>
}

function MarketSourcesButton({ context, bundles, preferredMarket, zh, disabled, onChanged }: {
  context: Context
  bundles: readonly BundleInfo[]
  preferredMarket: MarketName
  zh: boolean
  disabled: boolean
  onChanged(): void
}) {
  const [open, setOpen] = useState(false)
  const label = zh ? '来源配置' : 'Source configuration'
  return <>
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => { setOpen(true) }}>{label}</Button>
    <MarketSourcesDialog open={open} onClose={() => { setOpen(false) }} context={context} bundles={bundles}
      preferredMarket={preferredMarket} zh={zh} onChanged={onChanged} />
  </>
}

function MarketSourcesDialog({ open, onClose, context, bundles, preferredMarket, zh, onChanged }: {
  open: boolean
  onClose(): void
  context: Context
  bundles: readonly BundleInfo[]
  preferredMarket: MarketName
  zh: boolean
  onChanged(): void
}) {
  const t: Translate = (cn, en) => zh ? cn : en
  const [runtime, setRuntime] = useState<MarketRuntimeState>({})
  const [configuredUrls, setConfiguredUrls] = useState<string[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)

  const importing = busyAction !== null
  const communityEnabled = bundles.find(row => row.name === COMMUNITY)?.enabled === true
  const dshMarketEnabled = bundles.find(row => row.name === MARKET)?.enabled === true
  const officialRow = bundles.find(row => row.name === OFFICIAL_MARKET)
  const officialEnabled = officialRow?.enabled === true
  const officialLocked = officialRow !== undefined && (officialRow.readOnlyReason !== undefined || officialRow.error !== undefined)

  useEffect(() => {
    if (!open) return undefined
    const reload = (): void => { refresh(value => value + 1) }
    const offMarket = context.remote.$on('plugin-market/changed', reload)
    const offManager = context.remote.$on('plugin-manager/changed', reload)
    return () => { offMarket(); offManager() }
  }, [context, open])

  useEffect(() => {
    if (!open) return undefined
    let disposed = false
    const controller = new AbortController()
    const loadRuntime = async (): Promise<void> => {
      const nextRuntime: { communitySources?: MarketRuntimeState['communitySources']; dshMarketRegion?: 'global' | 'china' } = {}
      if (communityEnabled) {
        try {
          const state = await readMarketState(controller.signal)
          nextRuntime.communitySources = state.sources
        } catch {
          // Fallback to default community provider if the host route is still warming up.
        }
      }
      if (dshMarketEnabled) {
        try {
          const response = await fetch('/dshmarket/settings', { cache: 'no-store', signal: controller.signal })
          if (response.ok) {
            const payload = await response.json() as { region?: unknown }
            if (payload.region === 'global' || payload.region === 'china') nextRuntime.dshMarketRegion = payload.region
          }
        } catch {
          // Fallback to default dshmarket region when unavailable.
        }
      }
      if (!disposed) setRuntime(nextRuntime)
      if (officialEnabled) {
        const indexes = await context.remote.pluginMarket.listIndexes()
        if (!disposed) setConfiguredUrls(indexes.ok ? indexes.value.map(item => item.url) : [])
      } else if (!disposed) {
        setConfiguredUrls([])
      }
    }
    void loadRuntime()
    return () => { disposed = true; controller.abort() }
  }, [open, communityEnabled, dshMarketEnabled, officialEnabled, context, revision])

  const resolution = resolveActiveMarketSource(bundles, preferredMarket, runtime)
  const activeMarketDef = BUILT_IN_MARKET_SOURCES.find(item => item.key === resolution.marketKey) ?? BUILT_IN_MARKET_SOURCES[0]!
  const configuredSet = new Set(configuredUrls)

  const handleToggleOfficialMarket = async (enabled: boolean): Promise<void> => {
    if (busyAction !== null) return
    setBusyAction('official-toggle'); setError('')
    try {
      const result = await context.remote.pluginManager.setBundleEnabled(OFFICIAL_MARKET, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed' || change.application === 'cancelled') {
        throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      }
      if (!enabled) setConfiguredUrls([])
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyAction(null)
      refresh(value => value + 1)
    }
  }

  const handleImport = async (): Promise<void> => {
    if (busyAction !== null) return
    setBusyAction('all'); setError('')
    try {
      const result = await importMarketSourcesToOfficial(context.remote, resolution, officialEnabled, runtime)
      setConfiguredUrls([...result.configuredUrls])
      reloadDiscoverIndexesIfMounted(context)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyAction(null)
      refresh(value => value + 1)
    }
  }

  const handleConfigureSingle = async (marketKey: BuiltInMarketKey, currentlyConfigured: boolean): Promise<void> => {
    if (busyAction !== null) return
    setBusyAction(marketKey); setError('')
    try {
      if (currentlyConfigured) {
        const nextUrls = await removeMarketSourcesFromOfficial(context.remote, marketKey)
        setConfiguredUrls([...nextUrls])
        onChanged()
      } else {
        const result = await configureSingleMarketToOfficial(context.remote, marketKey, runtime, officialEnabled)
        setConfiguredUrls([...result.configuredUrls])
        reloadDiscoverIndexesIfMounted(context)
        onChanged()
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyAction(null)
      refresh(value => value + 1)
    }
  }

  const handleToggleEndpoint = async (endpointUrl: string, enable: boolean): Promise<void> => {
    if (busyAction !== null) return
    setBusyAction(endpointUrl); setError('')
    try {
      const result = await toggleMarketEndpointInOfficial(context.remote, endpointUrl, enable, officialEnabled)
      setConfiguredUrls([...result.configuredUrls])
      if (enable) reloadDiscoverIndexesIfMounted(context)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyAction(null)
      refresh(value => value + 1)
    }
  }

  return <Modal open={open} onClose={onClose} title={t('来源配置', 'Source configuration')}
    closeLabel={t('关闭', 'Close')} className="dshNextPermissionsDialog">
    <div className="dshNextPermissionList" data-next-market-sources-dialog>
      <div className="dshNextMarketSourceNotice" role="note">
        <div className="dshNextMarketSourceNoticeCopy">
          <IconWarningOutlineRegular size={14} aria-hidden="true" />
          <span>{t(
            '“快速配置”会自动开启官方的“自定义插件市场”插件，直接配置下方已适配官方索引格式的内置插件市场（dsh-market）默认源，并将其同步为选中源。',
            '"Quick configuration" automatically enables the official "Custom Plugin Market" plugin, configures the default source of the adapted built-in plugin market below (dsh-market), and syncs it as the selected source.',
          )}</span>
        </div>
        <Button variant="primary" size="sm" disabled={importing} onClick={() => { void handleImport() }}>
          {busyAction === 'all' ? t('正在配置…', 'Configuring…') : t('快速配置', 'Quick configuration')}
        </Button>
      </div>
      {error && <p role="alert" className="dshDesktopSettingsError">{error}</p>}
      <div className="dshNextPermissionRow" role="group" aria-label={t('当前插件市场状态', 'Current plugin market status')}>
        <div className="dshNextPermissionCopy">
          <div className="dshNextMarketSourceTitle">
            <strong>{t('当前使用的插件市场', 'Currently active plugin market')}</strong>
            {resolution.enabled && <Tag>{zh ? activeMarketDef.title.zh : activeMarketDef.title.en}</Tag>}
            {resolution.enabled && activeMarketDef.bundle === COMMUNITY && <Tag>Beta</Tag>}
            {officialEnabled && <Tag tone="info">{t('官方自定义插件市场', 'Official Custom Plugin Market')}</Tag>}
          </div>
          {officialEnabled ? (
            <span className="dshNextPermissionStatus" role="status">
              <StateDot state="done" />
              {t(`已开启官方“自定义插件市场”插件（已配置 ${String(configuredUrls.length)} 个索引源）`,
                `Official "Custom Plugin Market" plugin enabled (${String(configuredUrls.length)} index sources configured)`)}
            </span>
          ) : !resolution.enabled ? (
            <p className="dshDesktopSettingsHint">
              {t('当前没有配置插件市场', 'No plugin market is currently configured')}
            </p>
          ) : null}
        </div>
      </div>
      <div className="dshNextPermissionRow" role="group" aria-label={t('官方自定义插件市场配置', 'Official Custom Plugin Market configuration')}>
        <div className="dshNextPermissionCopy">
          <div className="dshNextMarketSourceHeaderMain">
            <div className="dshNextMarketSourceTitle">
              <strong>{t('自定义插件市场', 'Custom plugin markets')}</strong>
              {officialRow?.version && <Tag>{`v${officialRow.version}`}</Tag>}
              <Tag tone="info">{t('实验性', 'Experimental')}</Tag>
            </div>
            {officialEnabled && <code className="dshNextMarketSourceUrl">{OFFICIAL_MARKET}</code>}
            <p className="dshDesktopSettingsHint">
              {officialEnabled
                ? t(
                  '在插件页添加「发现」标签页，从你添加的插件市场索引浏览和安装插件。',
                  'Adds a Discover tab to Plugins for browsing and installing bundles from plugin market indexes you add.',
                )
                : t(
                  '开启右侧开关或点击上方“快速配置”以启用官方“自定义插件市场”，启用后可在下方配置与管理内置插件源。',
                  'Turn on the switch on the right or click "Quick configuration" above to enable the official "Custom Plugin Market" and manage built-in sources below.',
                )}
            </p>
          </div>
        </div>
        <div className="dshNextPluginActions">
          <Switch label={t('启用官方自定义插件市场', 'Enable official Custom Plugin Market')} checked={officialEnabled}
            disabled={importing || officialLocked} onChange={enabled => { void handleToggleOfficialMarket(enabled) }} />
        </div>
      </div>
      {officialEnabled && <div className="dshNextMarketSourceSectionHeader">
        <div className="dshNextMarketSourceHeaderMain">
          <strong>{t('可供官方“自定义插件市场”配置的插件源', 'Plugin sources available for the official Custom Plugin Market')}</strong>
        </div>
      </div>}
      {officialEnabled && OFFICIAL_CONFIGURABLE_MARKET_SOURCES.map(marketDef => {
        const isCurrentMarket = resolution.enabled && resolution.marketKey === marketDef.key
        const isMarketConfigured = marketDef.sources.some(source => configuredSet.has(source.url))
        return <div key={marketDef.key} className="dshNextPermissionRow" role="group"
          aria-label={zh ? marketDef.title.zh : marketDef.title.en}>
          <div className="dshNextPermissionCopy">
            <div className="dshNextMarketSourceHeader">
              <div className="dshNextMarketSourceHeaderMain">
                <div className="dshNextMarketSourceTitle">
                  <strong>{zh ? marketDef.title.zh : marketDef.title.en}</strong>
                  <Tag>{marketDef.bundle === COMMUNITY ? t('社区插件市场', 'Community Market') : t('dsh-market', 'dsh-market')}</Tag>
                  {marketDef.bundle === COMMUNITY && <Tag>Beta</Tag>}
                  {isCurrentMarket && <Tag tone="info">{t('当前使用', 'In use')}</Tag>}
                  {isMarketConfigured && <Tag tone="success">{t('已配置', 'Configured')}</Tag>}
                </div>
                <p className="dshDesktopSettingsHint">{zh ? marketDef.description.zh : marketDef.description.en}</p>
              </div>
              <div className="dshNextPluginActions">
                <Button variant="outline" size="sm" disabled={importing}
                  className={isMarketConfigured ? 'dshNextMarketRemoveBtn' : undefined}
                  onClick={() => { void handleConfigureSingle(marketDef.key, isMarketConfigured) }}>
                  {busyAction === marketDef.key
                    ? t('正在处理…', 'Processing…')
                    : isMarketConfigured
                      ? t('重置', 'Reset')
                      : t('添加', 'Add')}
                </Button>
              </div>
            </div>
            <div className="dshNextMarketSourceEndpoints">
              {marketDef.sources.map(source => {
                const isConfigured = configuredSet.has(source.url)
                return <div key={source.url} className="dshNextMarketSourceItem" data-market-source-url={source.url}>
                  <div className="dshNextMarketSourceItemMain">
                    <div className="dshNextMarketSourceTitle">
                      <span>{zh ? source.label.zh : source.label.en}</span>
                      {isConfigured && <Tag tone="success">{t('已配置', 'Configured')}</Tag>}
                    </div>
                    <code className="dshNextMarketSourceUrl">{source.url}</code>
                  </div>
                  <Button variant="outline" size="sm" disabled={importing}
                    className={isConfigured ? 'dshNextMarketRemoveBtn' : undefined}
                    onClick={() => { void handleToggleEndpoint(source.url, !isConfigured) }}>
                    {busyAction === source.url
                      ? t('正在处理…', 'Processing…')
                      : isConfigured
                        ? t('删除配置', 'Remove configuration')
                        : t('配置此源', 'Configure source')}
                  </Button>
                </div>
              })}
            </div>
          </div>
        </div>
      })}
    </div>
  </Modal>
}


const remoteDescription = (t: Translate): string => t(
  '通过 Agents Anywhere 从手机或其他设备连接。启用后，在侧边栏的“远程控制”中完成配对。',
  'Connect from your phone or another device with Agents Anywhere. After enabling, pair it from Remote Control in the sidebar.',
)

const computerDescription = (t: Translate): string => t(
  '让 AI 查看屏幕、操作鼠标和键盘。截图理解需要支持图片输入的模型。',
  'Let AI view the screen and control the mouse and keyboard. Understanding screenshots requires a model with image input.',
)

function ComputerUseItem({ context, t, view }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.item'> & { context: Context }) {
  const zh = t('language') === 'zh'
  if (view === 'summary') return computerDescription((cn, en) => zh ? cn : en)
  return <ComputerUseSettings context={context} zh={zh} mode="page" />
}

function ComputerUseActions({ context, t, subject }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.detail.actions'> & { context: Context }) {
  if (subject.kind !== 'item' || subject.id !== COMPUTER_ITEM) return null
  return <ComputerUseSettings context={context} zh={t('language') === 'zh'} mode="actions" />
}

function PluginCard({ title, description, icon, onOpen, children }: {
  title: string; description: string; icon: ReactNode; onOpen(): void; children: ReactNode
}) {
  return <div className="dshNextPluginCard" data-next-plugin-card>
    <span className="dshNextPluginIcon" aria-hidden="true">{icon}</span>
    <div className="dshNextPluginCardMain">
      <button type="button" className="dshNextPluginCardOpen" aria-label={`${title} — ${description}`} onClick={onOpen}>{title}</button>
      <span className="dshNextPluginCardDescription">{description}</span>
    </div>
    <div className="dshNextPluginCardActions">{children}</div>
  </div>
}

function RemoteControlSettings({ context, t, row, loading, onChanged }: {
  context: Context
  t: Translate
  row: BundleInfo | undefined
  loading: boolean
  onChanged(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const change = async (enabled: boolean): Promise<void> => {
    if (busy || loading || !row) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await context.remote.pluginManager.setBundleEnabled(REMOTE, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed' || change.application === 'cancelled') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      if (change.application === 'restart-required') setNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
      if (change.application === 'overridden') setNotice(t('已保存，但当前配置覆盖了此选择。', 'Saved, but another configuration overrides this choice.'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); onChanged() }
  }
  const openPanel = (): void => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="远程控制"], [data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Remote Control"], [data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Mobile connection"], [data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="手机连接"], [data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Agents Anywhere"]')
    if (trigger) { setError(''); trigger.click() }
    else setError(t('远程控制界面尚未就绪，请稍后重试。', 'Remote control is not ready yet. Try again shortly.'))
  }
  return <div className="dshNextPluginDetail" data-next-remote-control>
    <div className="dshNextPluginActions">
      <Button variant="outline" size="sm" disabled={!row?.enabled || loading || busy} onClick={openPanel}>{t('打开面板', 'Open panel')}</Button>
      <Switch label={t('启用远程控制', 'Enable remote control')} checked={row?.enabled ?? false}
        disabled={loading || busy || !row || row.readOnlyReason !== undefined || row.error !== undefined}
        onChange={enabled => { void change(enabled) }} />
    </div>
    {notice && <span role="status" className="dshDesktopSettingsHint">{notice}</span>}
    {error && <span role="alert" className="dshDesktopSettingsError">{error}</span>}
  </div>
}

function readOfficialBundles(context: Context): BundleInfo[] | undefined {
  try {
    const get = (context as { get?: (key: string) => unknown }).get
    if (typeof get !== 'function') return undefined
    const slots = get.call(context, 'slots') as {
      readonly _core?: {
        readonly entries?: (key: string) => readonly {
          readonly options?: { readonly id?: string; readonly key?: string }
          readonly inject?: () => {
            readonly hooks?: {
              readonly pluginManager?: {
                readonly getSnapshot?: () => {
                  readonly status?: string
                  readonly packages?: readonly BundleInfo[]
                }
              }
            }
          }
        }[]
      }
    } | undefined
    const mainEntries = slots?._core?.entries?.('main')
    const overlayEntries = slots?._core?.entries?.('shell.overlay')
    const entry = mainEntries?.find(item => item.options?.key === 'plugins')
      ?? overlayEntries?.find(item => item.options?.id === 'plugin-manager.refresh-toast')
    const snapshot = entry?.inject?.()?.hooks?.pluginManager?.getSnapshot?.()
    if ((snapshot?.status === 'ready' || snapshot?.status === 'error') && Array.isArray(snapshot.packages)) {
      return [...snapshot.packages]
    }
  } catch {
    // Fallback to direct RPC when the official plugin manager store is unavailable.
  }
  return undefined
}

function reloadDiscoverIndexesIfMounted(context: Context): void {
  try {
    const slots = context.get('slots') as {
      readonly _core?: {
        readonly entries?: (key: string) => readonly {
          readonly options?: { readonly id?: string }
          readonly inject?: () => {
            readonly reload?: () => void
            readonly hooks?: { readonly discover?: { readonly getSnapshot?: () => { readonly status?: string } } }
          }
        }[]
      }
    } | undefined
    const entries = slots?._core?.entries?.('plugins.tab')
    const entry = entries?.find(item => item.options?.id === 'discover')
    const face = entry?.inject?.()
    if (face?.hooks?.discover?.getSnapshot?.().status !== 'idle') {
      face?.reload?.()
    }
  } catch {
    // Non-fatal UI refresh hint.
  }
}
