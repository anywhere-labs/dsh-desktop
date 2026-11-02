/** Launch choices on the official Plugins page: one configuration page per bundle row, applied by the Host. */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { Choice } from './DesktopSettingsSection.tsx'
import {
  LAUNCH_PRESETS_ROUTE, type BilingualText, type LaunchPresetBundle, type LaunchPresetRow, type LaunchPresetState,
} from '../launch-presets.ts'

/** How soon after a row's page closes its bundle's page must open again to count as returning from it. */
const RETURN_WINDOW_MS = 1_000

/**
 * Per client: where each bundle page was last scrolled, and which bundle's row page closed last. The official page
 * keeps one scroll container for every view, so the short row page clamps it; returning restores the position.
 */
const scrollPositions = new WeakMap<Context, Map<string, number>>()
const closedRowPages = new WeakMap<Context, { bundle: string; at: number }>()

/**
 * Give each row a configure control on its bundle's page, opening the row's launch choices, and tag the row in the
 * page's component list and on its own page with what it runs. Returning from a row's page restores where its
 * bundle's page was scrolled.
 * @param ctx - client context with the Plugins page slots and the Remote.
 * @param bundle - the rows and their choices.
 */
export function registerLaunchPresets(ctx: Context, bundle: LaunchPresetBundle): void {
  ctx.slots.inject('plugins.row.config', () => {
    const disposers = bundle.rows.map(row => ctx.slots.register({ name: 'plugins.row.config', key: `${bundle.bundle}#${row.id}`,
      locale: 'desktop-next', inject: () => ({ context: ctx, bundle: bundle.bundle, row }),
    }, LaunchPresetPage))
    return () => { for (const dispose of disposers) dispose() }
  })
  ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({ name: 'plugins.detail.badge', id: 'desktop-next-launch-presets',
    inject: () => ({ bundle }),
  }, LaunchPresetRowTag))
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({ name: 'plugins.detail.section', id: 'desktop-next-launch-presets',
    inject: () => ({ context: ctx, bundle }),
  }, BundlePageAdditions))
}

/** The row page's tag naming what the row runs. */
function LaunchPresetRowTag({ subject, bundle }: PropsRuntime<'plugins.detail.badge'> & { bundle: LaunchPresetBundle }) {
  if (subject.kind !== 'row' || subject.pkg.name !== bundle.bundle) return null
  const row = bundle.rows.find(item => item.id === subject.row.rowId)
  return row === undefined ? null : <Tag className="dshNextPluginStatusTag" tone="info">{row.tag}</Tag>
}

/** A value as a quoted CSS string. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/gu, '\\$&').replace(/\n/gu, '\\A ')}"`
}

/**
 * Style sheet tagging each row in the bundle page's component list, beside the row's title control, as the official
 * info tags look. The official list draws its rows itself and has no slot there; its rows carry `data-plugin-row`.
 * @param bundle - the rows and their tags.
 * @returns rules scoped to the bundle's page.
 */
export function rowTagStyles(bundle: LaunchPresetBundle): string {
  const selector = (row: LaunchPresetRow): string => `[data-plugin-detail=${cssString(bundle.bundle)}] `
    + `[data-plugin-row$=${cssString(row.id)}] button:first-child:not([role="switch"])::after`
  return [
    `${bundle.rows.map(selector).join(', ')} { display: inline-flex; align-items: center; height: 18px; margin-left: 6px;`
    + ' padding: 0 7px; border-radius: 999px; font-size: 10px; line-height: 1; font-weight: 500; white-space: nowrap;'
    + ' background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);'
    + ' color: var(--dsw-alias-state-business-primary); }',
    ...bundle.rows.map(row => `${selector(row)} { content: ${cssString(row.tag)}; }`),
  ].join('\n')
}

/**
 * On the bundle's page: the rows' list tags, and its scroll position, recorded while it shows and restored when it
 * opens again from one of its rows' pages.
 */
function BundlePageAdditions({ subject, context, bundle }: PropsRuntime<'plugins.detail.section'> & {
  context: Context
  bundle: LaunchPresetBundle
}) {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const name = bundle.bundle
  const ours = subject.kind === 'bundle' && subject.pkg.name === name
  useEffect(() => {
    const body = ours ? anchor.current?.closest<HTMLElement>('[data-plugin-body]') : null
    if (body === null || body === undefined) return undefined
    let positions = scrollPositions.get(context)
    if (positions === undefined) scrollPositions.set(context, positions = new Map())
    const closed = closedRowPages.get(context)
    closedRowPages.delete(context)
    const top = positions.get(name)
    const returning = closed?.bundle === name && Date.now() - closed.at < RETURN_WINDOW_MS && top !== undefined
    positions.set(name, returning ? top : body.scrollTop)
    // After the page's own layout effects; the restored position also reaches the scroll listener.
    const frame = returning ? requestAnimationFrame(() => { body.scrollTop = top }) : undefined
    const record = (): void => { positions.set(name, body.scrollTop) }
    body.addEventListener('scroll', record, { passive: true })
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      body.removeEventListener('scroll', record)
    }
  }, [context, name, ours])
  return ours ? <><span ref={anchor} hidden /><style>{rowTagStyles(bundle)}</style></> : null
}

function LaunchPresetPage({ context, bundle, row, t, view }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.row.config'> & {
  context: Context
  bundle: string
  row: LaunchPresetRow
}) {
  const zh = t('language') === 'zh'
  if (view === 'summary') return zh ? row.title.zh : row.title.en
  return <LaunchPresetForm context={context} bundle={bundle} row={row} zh={zh} />
}

/** The row's choices, staged until saved; the Host reports which one the row runs with. */
function LaunchPresetForm({ context, bundle, row, zh }: { context: Context; bundle: string; row: LaunchPresetRow; zh: boolean }) {
  const t = (cn: string, en: string): string => zh ? cn : en
  const text = (value: BilingualText): string => zh ? value.zh : value.en
  useEffect(() => () => { closedRowPages.set(context, { bundle, at: Date.now() }) }, [bundle, context])
  const [state, setState] = useState<LaunchPresetState | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, refresh] = useState(0)
  useEffect(() => {
    const reload = (): void => { refresh(value => value + 1) }
    const off = context.remote.$on('plugin-manager/changed', reload)
    const reset = context.on('connection/reset', reload)
    return () => { off(); reset() }
  }, [context])
  useEffect(() => {
    const controller = new AbortController()
    void fetch(LAUNCH_PRESETS_ROUTE, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(t('无法读取当前设置。', 'Could not read the current setting.'))
      const current = ((await response.json()) as { rows?: LaunchPresetState[] }).rows?.find(item => item.row === row.id)
      setState(current)
      setSelected(staged => staged ?? current?.preset ?? null)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [context, row.id, revision])
  const save = async (): Promise<void> => {
    if (selected === null || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(LAUNCH_PRESETS_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ row: row.id, preset: selected }),
      })
      const payload = await response.json() as { rows?: LaunchPresetState[]; error?: string }
      const current = payload.rows?.find(item => item.row === row.id)
      if (current !== undefined) setState(current)
      if (!response.ok) {
        throw new Error(payload.error === 'inactive'
          ? t('这一行没有运行，开启插件和这一行后才能修改。', 'This row is not running. Turn on the plugin and this row to change it.')
          : payload.error ?? t('无法保存设置。', 'Could not save the setting.'))
      }
      setNotice(t('已保存，之后委派的任务按新设置启动。', 'Saved. Tasks delegated from now on start with this setting.'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  const active = state?.active === true
  return <div className="dshNextLaunchPresets" data-next-launch-presets={row.id}>
    <h4 className="dshNextLaunchPresetsTitle">{text(row.title)}</h4>
    {!loading && !active && <p className="dshDesktopSettingsHint">
      {t('这一行没有运行，开启插件和这一行后才能修改。', 'This row is not running. Turn on the plugin and this row to change it.')}
    </p>}
    {active && state.preset === null && <p className="dshDesktopSettingsHint">
      {t('这一行正在使用自定义启动参数，选择下面任一项会替换它们。', 'This row runs with custom launch arguments; choosing an option below replaces them.')}
    </p>}
    <div className="dshNextLaunchPresetChoices" role="radiogroup" aria-label={text(row.title)}>
      {row.presets.map(preset => <Choice key={preset.id} title={text(preset.title)} body={text(preset.description)}
        badge={preset.shipped === true ? t('默认', 'Default') : preset.unrestricted === true ? t('不受限制', 'Unrestricted') : undefined}
        selected={selected === preset.id} disabled={!active || saving}
        action={() => { setSelected(preset.id); setNotice('') }} />)}
    </div>
    <div className="dshNextPluginActions">
      <Button variant="primary" size="sm" disabled={!active || saving || selected === null || selected === state.preset}
        onClick={() => { void save() }}>{saving ? t('正在保存…', 'Saving…') : t('保存', 'Save')}</Button>
    </div>
    {notice && <p role="status" className="dshDesktopSettingsHint">{notice}</p>}
    {error && <p role="alert" className="dshDesktopSettingsError">{error}</p>}
  </div>
}
