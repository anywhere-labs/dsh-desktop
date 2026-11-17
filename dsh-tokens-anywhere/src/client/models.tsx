/**
 * Tokens Anywhere's models on the account page. Tokens Anywhere configures them: the list, in the rows of Desktop
 * settings' notifications, switches whole families or single models on or off and renames models, and a switch sends
 * the Gemini models through Google's own API. Anything more is edited in Settings → Models, the official model
 * settings, which the page opens. Renaming or removing models there shows here as the list's own names and switches;
 * any other edit there makes the routes the user's (custom configuration) until the page puts Tokens Anywhere's back.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, IconEditOutlineRegular, IconRefreshOutlineRegular, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ANYWHERE_ACCOUNT_ROUTES, anywhereFamilyName, compareFamilies, type AnywhereAccountSnapshot, type AnywhereModelFamily, type AnywhereModelView,
} from '../account.ts'
import { ToggleRow } from './controls.tsx'
import { formatTokenLimit, type Copy, type RouteReply } from './shared.ts'

/** A family as the page names it: a vendor by DSH's name or its provider id, and models of no named provider as Other. */
export function familyName(family: AnywhereModelFamily, t: Copy): string {
  return family === 'other' ? t('其他', 'Other') : anywhereFamilyName(family)
}

/** Run an action on the Host; the page applies the state it answers with and shows its failure. */
export type AnywhereAction = (path: string, body?: object) => Promise<RouteReply | undefined>

/** Settings → Models, the official model settings: what opens them, or undefined where the page cannot. */
export type ModelSettings = () => (() => void) | undefined

function modelFacts(model: AnywhereModelView, t: Copy): string {
  return [
    model.id,
    ...(model.contextWindow === undefined ? [] : [t(`${formatTokenLimit(model.contextWindow)} 上下文`, `${formatTokenLimit(model.contextWindow)} context`)]),
    ...(model.maxTokens === undefined ? [] : [t(`${formatTokenLimit(model.maxTokens)} 输出`, `${formatTokenLimit(model.maxTokens)} output`)]),
    ...(model.vision ? [t('支持图片', 'Images')] : []),
  ].join(' · ')
}

export function ControlRow({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="dshAnywhereToggleRow">
      <span className="dshAnywhereToggleCopy">
        <span className="dshAnywhereToggleLabel">{label}</span>
        {description !== undefined && <span className="dshAnywhereToggleDescription">{description}</span>}
      </span>
      {children !== undefined && <div className="dshAnywhereToggleControl">{children}</div>}
    </div>
  )
}

/**
 * Who configures the routes. Editing them is Settings → Models' job, which the row opens; renames and removals there
 * come back as the list's own, and any other edit makes the routes the user's, which the row says, and it can put
 * Tokens Anywhere's routes back. That can lose edits, so it asks first.
 */
function ConfigurationRow({ state, t, act, modelSettings }: {
  state: AnywhereAccountSnapshot
  t: Copy
  act: AnywhereAction
  modelSettings: ModelSettings
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const custom = state.custom === true
  const open = modelSettings()
  const restore = async (): Promise<void> => {
    setConfirming(false)
    setBusy(true)
    await act(ANYWHERE_ACCOUNT_ROUTES.custom, { enabled: false })
    setBusy(false)
  }
  return (
    <>
      <ControlRow
        label={t('自定义配置', 'Custom configuration')}
        description={custom
          ? t('模型由你在 设置 → 模型 中管理，Tokens Anywhere 的新模型不会自动加入。', 'You manage these models in Settings → Models; new Tokens Anywhere models are not added for you.')
          : t('默认由 Tokens Anywhere 自动配置。在 设置 → 模型 中改名、删除模型会同步到这里；做其他修改后改由你管理，新模型不再自动加入。', 'Tokens Anywhere configures models for you. Renaming or removing models in Settings → Models shows here; after any other edit there they are yours to manage, and new models are no longer added.')}
      >
        {custom && (
          <Button variant="outline" size="sm" disabled={busy}
            onClick={() => { if (state.customEdited === true) setConfirming(true); else void restore() }}>
            {busy ? t('正在恢复…', 'Restoring…') : t('恢复自动配置', 'Back to automatic')}
          </Button>
        )}
        {open !== undefined && <Button variant="outline" size="sm" onClick={() => { open() }}>{t('前往模型设置', 'Go to Models')}</Button>}
      </ControlRow>
      {confirming && (
        <ControlRow label={t('恢复自动配置？', 'Back to automatic configuration?')} description={t('你在 设置 → 模型 中对这些模型的修改会丢失。', 'Your edits to these models in Settings → Models will be lost.')}>
          <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('取消', 'Cancel')}</Button>
          <Button variant="primary" size="sm" onClick={() => { void restore() }}>{t('恢复', 'Restore')}</Button>
        </ControlRow>
      )}
    </>
  )
}

/**
 * Gemini through Google's own API instead of Chat Completions, off by default as Tokens Anywhere's own DeepSeek Harness
 * guide sets it up. The switch rewrites the Gemini route, so it shows only while Tokens Anywhere configures the routes.
 * Shown as it will be once saved.
 */
function GeminiFormatRow({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: AnywhereAction }) {
  const [pending, setPending] = useState<boolean>()
  const set = async (next: boolean): Promise<void> => {
    setPending(next)
    await act(ANYWHERE_ACCOUNT_ROUTES.local, { geminiNative: next })
    setPending(undefined)
  }
  return (
    <ToggleRow
      label={t('用谷歌格式配置 Gemini 模型', 'Configure Gemini models in Google\'s format')}
      description={t('默认通过 OpenAI 格式调用，开启后改用谷歌的原生接口。', 'Gemini models use the OpenAI format by default; turn this on to use Google\'s own API.')}
      checked={pending ?? state.local.geminiNative}
      disabled={!state.local.writable || pending !== undefined}
      onChange={(next) => { void set(next) }}
    />
  )
}

/** One model of the list: renamed in place, and switched on or off for the model picker. */
function ModelRow({ model, t, act }: { model: AnywhereModelView; t: Copy; act: AnywhereAction }) {
  const [pending, setPending] = useState<boolean>()
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)

  const toggle = async (enabled: boolean): Promise<void> => {
    setPending(enabled)
    await act(ANYWHERE_ACCOUNT_ROUTES.model, { id: model.id, enabled })
    setPending(undefined)
  }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    if (draft.trim() === model.name) { setDraft(undefined); return }
    setSaving(true)
    // An empty name goes back to Tokens Anywhere's.
    const reply = await act(ANYWHERE_ACCOUNT_ROUTES.model, { id: model.id, name: draft.trim() === model.defaultName ? '' : draft })
    setSaving(false)
    if (reply !== undefined && reply.error === undefined) setDraft(undefined)
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); void save() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined) }
  }

  const callable = model.route !== undefined
  const on = pending ?? model.enabled
  return (
    <div className="dshAnywhereToggleRow dshAnywhereModel" data-off={callable && !on ? '' : undefined}>
      <span className="dshAnywhereToggleCopy">
        {draft === undefined ? (
          <span className="dshAnywhereToggleLabel">
            <span className="dshAnywhereModelTitle">{model.name}</span>
            {callable && (
              <button type="button" className="dshAnywhereIconButton" aria-label={t(`重命名 ${model.name}`, `Rename ${model.name}`)}
                title={t('重命名', 'Rename')} onClick={() => { setDraft(model.name) }}>
                <IconEditOutlineRegular size={14} />
              </button>
            )}
          </span>
        ) : (
          <span className="dshAnywhereModelEdit">
            <Input autoFocus value={draft} maxLength={80} disabled={saving} placeholder={model.defaultName}
              aria-label={t(`${model.id} 的显示名称`, `Display name of ${model.id}`)}
              onChange={(event) => { setDraft(event.target.value) }} onKeyDown={keys} />
            <Button variant="primary" size="sm" disabled={saving} onClick={() => { void save() }}>
              {saving ? t('正在保存…', 'Saving…') : t('保存', 'Save')}
            </Button>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(undefined) }}>{t('取消', 'Cancel')}</Button>
          </span>
        )}
        <span className="dshAnywhereToggleDescription">{modelFacts(model, t)}</span>
      </span>
      <div className="dshAnywhereToggleControl">
        {callable ? (
          <Switch checked={on} disabled={pending !== undefined}
            label={t(`在模型选择器中提供 ${model.name}`, `Offer ${model.name} in the model picker`)}
            onChange={(next) => { void toggle(next) }} />
        ) : (
          <span title={t('DSH 暂时不能调用这个模型。', 'DSH cannot call this model yet.')}>
            <Tag tone="neutral">{t('暂不支持', 'Not yet')}</Tag>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * What Tokens Anywhere configures, by family: each switched on or off as a whole, and opening to its models. A vendor
 * Tokens Anywhere starts serving shows as a family of its own, after the ones DSH knows by name.
 */
function ModelCatalogList({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: AnywhereAction }) {
  const id = useId()
  const [open, setOpen] = useState<ReadonlySet<AnywhereModelFamily>>(new Set())
  const [pending, setPending] = useState<ReadonlyMap<AnywhereModelFamily, boolean>>(new Map())
  const models = state.models ?? []
  const families = [...new Set(models.map(model => model.family))].sort(compareFamilies)
  const toggle = (family: AnywhereModelFamily): void => {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(family)) next.add(family)
      return next
    })
  }
  const switchFamily = async (family: AnywhereModelFamily, enabled: boolean): Promise<void> => {
    setPending(current => new Map(current).set(family, enabled))
    await act(ANYWHERE_ACCOUNT_ROUTES.model, { family, enabled })
    setPending((current) => {
      const next = new Map(current)
      next.delete(family)
      return next
    })
  }
  return (
    <>
      {families.map((family) => {
        const members = models.filter(model => model.family === family)
        const name = familyName(family, t)
        const callable = members.filter(model => model.route !== undefined).length
        const on = members.filter(model => model.enabled).length
        const count = on === callable
          ? t(`${members.length} 个模型`, `${members.length} models`)
          : on === 0
            ? t(`${members.length} 个模型，已全部关闭`, `${members.length} models, all off`)
            : t(`${members.length} 个模型，已开启 ${on} 个`, `${members.length} models, ${on} on`)
        const regionId = `${id}-${family}`
        return (
          <div key={family} className="dshAnywhereExpandableGroup">
            <ToggleRow
              label={name}
              badge={callable > 0 ? undefined : t('暂不支持', 'Not yet')}
              description={callable === 0 ? t(`${members.length} 个模型，DSH 暂时不能调用。`, `${members.length} models. DSH cannot call them yet.`) : count}
              checked={pending.get(family) ?? on > 0}
              disabled={callable === 0 || pending.has(family)}
              onChange={(next) => { void switchFamily(family, next) }}
              expander={{
                open: open.has(family), controls: regionId,
                label: t(family === 'other' ? '其他模型' : `${name} 模型`, `${name} models`),
                onToggle: () => { toggle(family) },
              }}
            />
            {open.has(family) && (
              <div id={regionId} className="dshAnywhereExpandedRows">
                {members.map(model => <ModelRow key={model.id} model={model} t={t} act={act} />)}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function AnywhereModelsPanel({ state, t, act, gemini, modelSettings }: {
  state: AnywhereAccountSnapshot
  t: Copy
  act: AnywhereAction
  /** Whether the site serves Gemini, which the Gemini format switch is for. */
  gemini: boolean
  modelSettings: ModelSettings
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [writing, setWriting] = useState(false)
  const custom = state.custom === true
  const offered = state.offered?.length ?? 0
  const changed = !custom && state.models?.some(model => model.name !== model.defaultName || (model.route !== undefined && !model.enabled)) === true
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await act(ANYWHERE_ACCOUNT_ROUTES.refresh, {})
    setRefreshing(false)
  }
  const restore = async (): Promise<void> => {
    setRestoring(true)
    await act(ANYWHERE_ACCOUNT_ROUTES.resetModels, {})
    setRestoring(false)
  }
  // Switched off in the plugin's configuration: nothing of ours is in the Profile to list or edit, until writing comes back on.
  if (!state.local.writeModels) {
    const write = async (): Promise<void> => {
      setWriting(true)
      await act(ANYWHERE_ACCOUNT_ROUTES.local, { writeModels: true })
      setWriting(false)
    }
    return (
      <div className="dshAnywherePanel">
        <div className="dshAnywherePanelHead">
          <p className="dshAnywhereSecondary">{t(
            '模型没有写入配置文件，模型选择器里不会出现 Tokens Anywhere 的模型。',
            'The models are not written into the configuration, so the model picker does not offer Tokens Anywhere\'s.',
          )}</p>
          <div className="dshAnywhereActions">
            <Button variant="outline" size="sm" disabled={writing || !state.local.writable} onClick={() => { void write() }}>
              {writing ? t('正在写入…', 'Writing…') : t('写入模型配置', 'Write the models')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="dshAnywherePanel">
      <div className="dshAnywherePanelHead">
        <p className="dshAnywhereSecondary">{state.models === undefined && !custom
          ? state.modelsError === undefined
            ? t('正在读取模型列表…', 'Reading the model list…')
            : t('暂时读不到模型列表，已配置好的模型仍可使用。', 'The model list is unavailable right now. Models already set up keep working.')
          : custom
            ? t(`模型选择器里有 ${offered} 个模型。`, `${offered} models in the model picker.`)
            : offered === 0
              ? t('模型已全部关闭，模型选择器里不会出现 Tokens Anywhere 的模型。', 'All models are off, so none of Tokens Anywhere\'s are in the model picker.')
              : t(`由 Tokens Anywhere 自动配置，模型选择器里有 ${offered} 个模型。`, `Configured by Tokens Anywhere, with ${offered} models in the model picker.`)}</p>
        <div className="dshAnywhereActions">
          {changed && (
            <Button variant="ghost" size="sm" disabled={restoring} onClick={() => { void restore() }}>
              {restoring ? t('正在恢复…', 'Restoring…') : t('恢复默认', 'Restore defaults')}
            </Button>
          )}
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} disabled={refreshing} onClick={() => { void refresh() }}>
            {refreshing ? t('正在刷新…', 'Refreshing…') : t('刷新', 'Refresh')}
          </Button>
        </div>
      </div>
      <div className="dshAnywhereRows">
        <ConfigurationRow state={state} t={t} act={act} modelSettings={modelSettings} />
        {!custom && gemini && <GeminiFormatRow state={state} t={t} act={act} />}
        {!custom && <ModelCatalogList state={state} t={t} act={act} />}
      </div>
    </div>
  )
}
