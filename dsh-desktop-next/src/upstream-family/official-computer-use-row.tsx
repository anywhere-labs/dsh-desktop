/**
 * The official Computer Use bundle of dsh 0.2.2 on the Computer Use (Next) page, shown as macOS Computer Use: a row that
 * switches the bundle through the official plugin manager, reports whether its macOS provider runs and, while the bundle
 * is on, opens the bundle's own page. The release installs the bundle on demand, so switching it on while the current
 * Profile lacks it downloads and installs the version the plugin manager offers, as the official Plugins page does.
 * src/client/computer-use.tsx consumes it as `useOfficialComputerUse` from src/client/upstream-family.tsx.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo, PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { IconChevronRightOutlineRegular, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { ComputerUsePluginArtwork } from '../client/computer-use-command-ui.tsx'

/** The official Computer Use bundle and its macOS provider, which take over PTC sessions while the bundle is on. */
const OFFICIAL_BUNDLE = '@deepseek-ai/dsh-cua-bundle'
const OFFICIAL_PROVIDER = '@deepseek-ai/dsh-experimental-cua-macos'
/** The Host settings route; it reports `officialSupported` beside the command mode. */
const COMPUTER_USE_SETTINGS_ROUTE = '/api/desktop-next/computer-use'

const STYLES = `
.dshNextComponentRow[data-opens] .dshNextComponentRowLine { position: relative; margin: -6px -8px; padding: 6px 8px; border-radius: 10px; }
.dshNextComponentRow[data-opens] .dshNextComponentRowLine:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshNextComponentRowOpen { display: inline-flex; align-items: center; gap: 2px; width: max-content; max-width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.dshNextComponentRowOpen::after { content: ''; position: absolute; inset: 0; border-radius: 10px; }
.dshNextComponentRowOpen:focus-visible { outline: none; }
.dshNextComponentRowOpen:focus-visible::after { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshNextComponentRowOpenIcon { flex: none; color: var(--dsw-alias-label-tertiary); }
.dshNextComponentRowLine:hover .dshNextComponentRowOpenIcon { color: var(--dsw-alias-label-primary); }
.dshNextComponentRowSwitch { position: relative; z-index: 1; display: inline-flex; flex: none; }
`

/**
 * Install the official row's styles for the client's lifetime.
 * @returns disposer that removes them.
 */
export function installOfficialComputerUseStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-desktop-next/official-computer-use'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}

/** What the Computer Use (Next) page hands the official row. */
export interface OfficialComputerUseOptions {
  context: Context
  t: (chinese: string, english: string) => string
  /** Whether the Computer Use (Next) page is open; its card in the overview lists no bundle. */
  page: boolean
  /** The page's reload counter, bumped by plugin-manager changes, window focus and writes. */
  revision: number
  onError(message: string): void
  onNotice(message: string): void
  /** Reload the page after a write. */
  onChanged(): void
}

/** The official row and the page's component count with it. */
export interface OfficialComputerUseView {
  row: ReactNode
  componentCount(commandActive: boolean): string
}

/**
 * Read the official bundle for the Computer Use (Next) page and render its row.
 * @param options - the page's context, copy, reload counter and notice callbacks.
 * @returns the row, or undefined outside the page and while the plugin manager lists no official bundle.
 */
export function useOfficialComputerUse({ context, t, page, revision, onError, onNotice, onChanged }: OfficialComputerUseOptions): OfficialComputerUseView | undefined {
  const [official, setOfficial] = useState<BundleInfo | undefined>(undefined)
  const [provider, setProvider] = useState<PluginInfo | undefined>(undefined)
  const [supported, setSupported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    if (!page) return
    let disposed = false
    void Promise.all([context.remote.pluginManager.listBundles(), context.remote.pluginManager.listPlugins()]).then(([bundles, plugins]) => {
      if (disposed) return
      if (!bundles.ok) throw new Error(bundles.error.message)
      if (!plugins.ok) throw new Error(plugins.error.message)
      setOfficial(bundles.value.find(bundle => bundle.name === OFFICIAL_BUNDLE))
      setProvider(plugins.value.find(item => item.moduleName === OFFICIAL_PROVIDER))
    }).catch(failure => { if (!disposed) onError(String(failure)) })
    return () => { disposed = true }
  }, [context, page, revision])
  useEffect(() => {
    if (!page || typeof fetch !== 'function') return
    let disposed = false
    void fetch(COMPUTER_USE_SETTINGS_ROUTE, { method: 'GET' })
      .then(async response => {
        if (!response.ok) return
        const payload = await response.json() as { officialSupported?: unknown } | null
        if (!disposed) setSupported(payload?.officialSupported === true)
      })
      .catch(() => {
        // Keep the switch locked while the Host route is unreachable, as in a mock environment.
      })
    return () => { disposed = true }
  }, [page, revision])
  if (!page || official === undefined) return undefined
  // The release offers the bundle from its catalog. A Profile that has not installed it lists it as missing, even when an
  // earlier Beta that shipped the bundle left it selected.
  const missing = official.availability === 'missing'
  const install = async (): Promise<void> => {
    const target = official.installTarget
    if (target === undefined) {
      throw new Error(official.error?.diagnostic ?? t('无法确定要安装的 macOS Computer Use 版本。', 'Could not determine which macOS Computer Use version to install.'))
    }
    setInstalling(true)
    try {
      const result = await context.remote.pluginManager.installBundle(target.spec, { enabled: true, saveExact: true })
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'cancelled') { onNotice(t('已取消安装。', 'Installation cancelled.')); return }
      if (change.application === 'failed') {
        const reason = change.error?.diagnostic || change.packageResult?.output.trim()
          || t('下载或安装 macOS Computer Use 失败。', 'Could not download or install macOS Computer Use.')
        const log = change.packageResult?.logPath
        throw new Error(log === undefined ? reason : `${reason}\n${t(`完整日志：${log}`, `Full log: ${log}`)}`)
      }
      if (change.application === 'restart-required') onNotice(t('已安装，请重启后台服务以应用。', 'Installed. Restart the background service to apply.'))
      if (change.application === 'overridden') onNotice(t('已安装，但当前配置覆盖了此开关。', 'Installed, but another configuration overrides this switch.'))
      setOfficial({ ...official, availability: 'profile', installed: true, enabled: true })
    } finally { setInstalling(false) }
  }
  const change = async (enabled: boolean): Promise<void> => {
    if (busy) return
    setBusy(true); onError(''); onNotice('')
    try {
      if (enabled && missing) { await install(); return }
      const result = await context.remote.pluginManager.setBundleEnabled(OFFICIAL_BUNDLE, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed' || change.application === 'cancelled') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      if (change.application === 'restart-required') onNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
      if (change.application === 'overridden') onNotice(t('已保存，但当前配置覆盖了此开关。', 'Saved, but another configuration overrides this switch.'))
      setOfficial({ ...official, enabled })
    } catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); onChanged() }
  }
  // The Host offers the official Computer Use only on macOS 14 and later, a narrower set than the bundle's platforms.
  const active = supported && !missing && official.enabled && provider?.fiberPhase === 'active'
  return {
    row: <OfficialComputerUseRow t={t} official={official} provider={provider} available={supported} installing={installing}
      disabled={busy || official.readOnlyReason !== undefined} onChange={enabled => { void change(enabled) }}
      onOpen={() => { context.get('pluginNavigation')?.openBundle(OFFICIAL_BUNDLE) }} />,
    componentCount: commandActive => {
      const running = [commandActive, active].filter(Boolean).length
      return [t('共 2 个', '2 total'),
        ...running > 0 ? [t(`${String(running)} 运行中`, `${String(running)} running`)] : [],
        ...running < 2 ? [t(`${String(2 - running)} 已停用`, `${String(2 - running)} off`)] : []].join(' · ')
    },
  }
}

/**
 * The switch for the official Computer Use bundle, titled macOS Computer Use. Where it cannot run, it stays off and refuses
 * input. While the current Profile lacks the bundle it stays off, and switching it on installs the bundle. While the bundle
 * is on, the whole row opens the bundle's own page; the switch keeps its own clicks.
 * @param props.official - the bundle as the plugin manager lists it.
 * @param props.provider - the bundle's macOS provider row, once the bundle has loaded.
 * @param props.available - whether this system can run the official Computer Use.
 * @param props.installing - whether switching it on is downloading and installing the bundle.
 * @param props.disabled - whether a write is in flight or the profile locks the bundle.
 * @param props.onOpen - open the bundle's page in the Plugins panel.
 */
function OfficialComputerUseRow({ t, official, provider, available, installing, disabled, onChange, onOpen }: {
  t: (chinese: string, english: string) => string
  official: BundleInfo
  provider: PluginInfo | undefined
  available: boolean
  installing: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void
  onOpen: () => void
}) {
  const missing = official.availability === 'missing'
  const enabled = available && !missing && official.enabled
  const active = enabled && provider?.fiberPhase === 'active'
  const failed = enabled && !active && (official.error !== undefined || provider?.fiberPhase === 'failed')
  const state = !available ? t('当前系统不支持', 'Not supported on this system')
    : installing ? t('正在下载并安装', 'Downloading and installing') : missing ? t('未安装', 'Not installed')
      : !enabled ? t('已关闭', 'Off') : active ? t('运行中', 'Running') : failed ? t('加载失败', 'Failed to load') : t('等待加载', 'Waiting to load')
  const title = 'macOS Computer Use'
  return <li className="dshNextComponentRow" data-plugin-row="official-computer-use"
    {...(active ? {} : { 'data-state': 'off' })} {...(enabled ? { 'data-opens': '' } : {})}>
    <div className="dshNextComponentRowLine">
      <span className="dshNextComponentRowIcon" aria-hidden="true">
        <ComputerUsePluginArtwork size={30} />
      </span>
      <div className="dshNextComponentRowMain">
        {enabled
          ? <button type="button" className="dshNextComponentRowOpen" onClick={onOpen}
            aria-label={t('查看 macOS Computer Use 的插件详情', 'View the macOS Computer Use plugin details')}>
            <span className="dshNextComponentRowId">{title}</span>
            <IconChevronRightOutlineRegular className="dshNextComponentRowOpenIcon" />
          </button>
          : <span className="dshNextComponentRowId">{title}</span>}
        <span className="dshNextComponentRowModule">
          {t(
            '仅支持 macOS 14 及以上的 PTC 模式。首次开启时会下载并安装官方插件。开启后，PTC 模式的会话改用 macOS Computer Use，取代 Computer Use（Next）；其他模式仍使用 Computer Use（Next）。',
            'Supports PTC mode on macOS 14 and later only. Turning it on the first time downloads and installs the official plugin. When on, macOS Computer Use replaces Computer Use (Next) in PTC sessions; other modes keep Computer Use (Next).',
          )}
        </span>
        <code className="dshNextComponentRowModule">{OFFICIAL_BUNDLE}</code>
      </div>
      <span className="dshNextComponentRowState">
        <StateDot state={active ? 'done' : installing ? 'ongoing' : failed ? 'error' : 'idle'} />
        {state}
      </span>
      <span className="dshNextComponentRowSwitch">
        <Switch label={t('启用 macOS Computer Use', 'Enable macOS Computer Use')} checked={enabled || installing} disabled={!available || disabled}
          title={available ? undefined : t('macOS Computer Use 仅支持 macOS 14 及以上', 'macOS Computer Use requires macOS 14 or later')}
          onChange={onChange} />
      </span>
    </div>
  </li>
}
