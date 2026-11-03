/**
 * The Tokens Anywhere card on the Plugins overview (./plugin-controls.tsx), between Remote Control and Computer Use
 * (Next). The plugin is the `tokens-anywhere` row of Next's own Profile layer (../../cordis.patch.yml), so the card's
 * switch is the official manager's row switch, which writes the usual `disabled` override into the Profile patch. The
 * card and its button open the account page the plugin registers in the main column (tokens-anywhere
 * src/client/entries.tsx), which exists only while the plugin runs: while it is off, neither responds.
 */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

/** The module the row names. */
const MODULE = 'tokens-anywhere'
/** The account page's main-column panel, the plugin's `ANYWHERE_PANEL_ID`. */
export const TOKENS_ANYWHERE_PANEL = 'tokens-anywhere'

type Translate = (cn: string, en: string) => string

interface RowCacheEntry {
  loaded: boolean
  row: PluginInfo | undefined
}

/** The last listing per client, so a remounted page shows the switch as it was while the Host answers again. */
const rowCache = new WeakMap<Context, RowCacheEntry>()

function cachedRow(context: Context): RowCacheEntry {
  let entry = rowCache.get(context)
  if (!entry) {
    entry = { loaded: false, row: undefined }
    rowCache.set(context, entry)
  }
  return entry
}

export const tokensAnywhereDescription = (t: Translate): string => t(
  '登录 Tokens Anywhere 账户，自动配置模型，查看余额和用量。',
  'Sign in to your Tokens Anywhere account to get its models set up and see your balance and usage.',
)

/** The card's row and actions, shared by the card itself and its button. */
export interface TokensAnywhereCard {
  readonly row: PluginInfo | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string
  readonly notice: string
  /** The plugin is on and the card idle: only then do the card and its button respond, and open the page. */
  readonly openable: boolean
  /** Show the account page, or say why it cannot show. */
  open(): void
  /** Switch the row through the official manager. */
  change(enabled: boolean): void
}

/**
 * The card's row, kept by the overview, since both the card and its button open the page.
 * @param options.revision - the overview's reload count; each change lists the row again.
 * @param options.openPage - select the account page; throws while the plugin has not registered it.
 * @param options.onChanged - the switch changed the Profile, so the overview reloads.
 */
export function useTokensAnywhere({ context, t, revision, openPage, onChanged }: {
  context: Context
  t: Translate
  revision: number
  openPage(): void
  onChanged(): void
}): TokensAnywhereCard {
  const cache = cachedRow(context)
  const [row, setRow] = useState<PluginInfo | undefined>(() => cache.row)
  const [loading, setLoading] = useState(() => !cache.loaded)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let disposed = false
    if (!cache.loaded) setLoading(true)
    void context.remote.pluginManager.listPlugins().then(result => {
      if (disposed) return
      if (!result.ok) throw new Error(result.error.message)
      const rows = result.value.filter(item => item.moduleName === MODULE)
      const next = rows.length === 1 ? rows[0] : undefined
      cache.row = next
      cache.loaded = true
      setRow(next)
    }).catch(failure => {
      if (!disposed) {
        if (!cache.loaded) setRow(undefined)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [cache, context, revision])
  const change = async (enabled: boolean): Promise<void> => {
    if (!row || busy || loading) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await context.remote.pluginManager.setPluginEnabled(row.entryId, enabled)
      if (!result.ok) throw new Error(result.error.message)
      const change = result.value
      if (change.application === 'failed' || change.application === 'cancelled') throw new Error(change.error?.diagnostic ?? t('无法更改插件状态。', 'Could not change the plugin state.'))
      if (change.application === 'restart-required') setNotice(t('已保存，请重启后台服务以应用。', 'Saved. Restart the background service to apply.'))
      if (change.application === 'overridden') setNotice(t('已保存，但当前配置覆盖了此开关。', 'Saved, but another configuration overrides this switch.'))
      const next = { ...row, enabled }
      cache.row = next
      setRow(next)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); onChanged() }
  }
  const openable = row?.enabled === true && !loading && !busy
  const open = (): void => {
    if (!openable) return
    try {
      openPage()
      setError('')
    } catch {
      setError(row?.fiberPhase === 'failed' ? t('Tokens Anywhere 加载失败。', 'Tokens Anywhere failed to load.')
        : t('Tokens Anywhere 尚未就绪，请稍后重试。', 'Tokens Anywhere is not ready yet. Try again shortly.'))
    }
  }
  return { row, loading, busy, error, notice, openable, open, change: enabled => { void change(enabled) } }
}

/** The card's button and switch, and what the last of them said. */
export function TokensAnywhereActions({ t, card }: { t: Translate; card: TokensAnywhereCard }) {
  const { row, loading, busy } = card
  return <div className="dshNextPluginDetail" data-next-tokens-anywhere>
    <div className="dshNextPluginActions">
      <Button variant="outline" size="sm" disabled={!card.openable} onClick={card.open}>{t('打开页面', 'Open page')}</Button>
      <Switch label={t('启用 Tokens Anywhere', 'Enable Tokens Anywhere')} checked={row?.enabled ?? false}
        disabled={loading || busy || !row || row.readOnlyReason !== undefined} onChange={card.change} />
    </div>
    {card.notice && <span role="status" className="dshDesktopSettingsHint">{card.notice}</span>}
    {card.error && <span role="alert" className="dshDesktopSettingsError">{card.error}</span>}
  </div>
}

/** The plugin's sidebar glyph, a person in a ring, drawn as the cards' artwork in the official blues. */
export function TokensAnywhereArtwork({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="url(#dsh-next-tokens-anywhere-art)" strokeWidth={2.2} strokeLinecap="round">
        <circle cx="18" cy="18" r="10.5" />
        <circle cx="18" cy="15.53" r="3.5" fill="url(#dsh-next-tokens-anywhere-art)" fillOpacity={0.2} />
        <path d="M11.82 25.82c1.24-2.47 3.54-3.71 6.18-3.71s4.94 1.24 6.18 3.71" />
      </g>
      <defs>
        <linearGradient id="dsh-next-tokens-anywhere-art" x1="8" y1="8" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#679EFE" />
          <stop offset="1" stopColor="#4561EE" />
        </linearGradient>
      </defs>
    </svg>
  )
}
