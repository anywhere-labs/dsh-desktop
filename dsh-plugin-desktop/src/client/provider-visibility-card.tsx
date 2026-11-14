/**
 * Per-card provider-group switch, rendered next to each card's Edit / Delete
 * buttons. There is deliberately no separate settings section.
 *
 * `settings.models.provider-card` is a keyed slot dispatched with
 * `entryKey = settingsNs`, so one registration per settings namespace covers
 * every card of that family (saved rows, first-run setup rows and the
 * add-provider draft). The slot renders inside the `<li class="rowCard">`
 * after the header; we portal the switch into that card's own `.rowActions`
 * container so it sits in the same row as Edit.
 *
 * Route A stores disabled ids in `llm-pi-ai.disabledProviders`; the Host-side
 * `buildModelCatalog` patch reads the same namespace.
 */
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  disabledProvidersOp,
  DISABLED_PROVIDERS_NAMESPACE,
  readDisabledProviders,
  resetDisabledSelections,
  visibleFallback,
  withProviderToggled,
  type SessionDirectoryLike,
} from '../provider-visibility.ts'
import { en, zh } from './desktop-settings-locales.ts'

/** Structural view of the generated remote namespaces this surface consumes. */
interface RemoteLike {
  settings: {
    describe(): Promise<{ ok: boolean; value?: { namespaces: DescribedNamespace[] }; error?: { message: string } }>
    mutate(ns: string, ops: { op: 'set'; path: string[]; value: string[] }[], expectedRevision: number | undefined): Promise<{ ok: boolean; error?: { message: string } }>
  }
  session: {
    modelCatalog(): Promise<{ ok: boolean; value?: ModelCatalogLike; error?: { message: string } }>
  }
  $on(event: string, listener: () => void): () => void
}

export interface ModelCatalogLike {
  readonly default: { provider: string; model: string; reasoningEffort?: string }
  readonly groups: readonly { id: string; models: readonly { id: string }[] }[]
}

interface ModelDirectoriesLike {
  readonly live: { readonly directories: { readonly values: Iterable<SessionDirectoryLike> } }
}

interface DescribedNamespace {
  ns: string
  value: unknown
  user?: unknown
}

/** The slot's owner props (see ui-settings-models slot-contract.d.ts). */
export interface ProviderCardOwnerProps {
  provider: { provider: string; displayName: string; settingsNs: string; settingsPath: readonly string[]; declared?: boolean }
  configured: boolean
  keyConfigured: boolean
}

export type VisibilityContext = {
  remote: RemoteLike
  modelDirectories?: ModelDirectoriesLike
  slots: {
    inject(name: string, factory: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

type Translate = (key: 'providerVisibilityEnable' | 'providerVisibilityDisable') => string

/** Plain zh/en copy, independent of the slot's own locale namespace. */
export function providerVisibilityTranslate(language: string): Translate {
  const copy = language.startsWith('zh') ? zh : en
  return key => copy[key]
}

/** Read the persisted disabled list from the Host settings mirror. */
export async function readDisabled(remote: RemoteLike): Promise<string[]> {
  const answer = await remote.settings.describe()
  if (!answer.ok || !answer.value) return []
  const ns = answer.value.namespaces.find(entry => entry.ns === DISABLED_PROVIDERS_NAMESPACE)
  return readDisabledProviders(ns?.value)
}

/** Reset sessions still using a provider that was just hidden. */
export async function resetSelectionAfterDisable(
  ctx: VisibilityContext,
  disabled: readonly string[],
): Promise<void> {
  const directories = ctx.modelDirectories?.live.directories.values
  if (!directories) return
  const answer = await ctx.remote.session.modelCatalog()
  if (!answer.ok || !answer.value) return
  const fallback = visibleFallback(answer.value.default, disabled, answer.value.groups)
  if (fallback === undefined) return
  resetDisabledSelections(directories, disabled, fallback)
}

/** A shared store so every card reflects the same disabled list immediately. */
export interface VisibilityStore {
  get(): readonly string[]
  subscribe(listener: () => void): () => void
  set(next: readonly string[]): void
}

export function createVisibilityStore(initial: readonly string[] = []): VisibilityStore {
  let current = [...initial]
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: next => { current = [...next]; for (const listener of listeners) listener() },
  }
}

type CardProps = {
  provider: ProviderCardOwnerProps['provider']
  ctx: VisibilityContext
  store: VisibilityStore
  t: Translate
}

/** One switch, portalled into this card's `.rowActions` (next to Edit). */
export function ProviderVisibilityCard({ provider, ctx, store, t }: CardProps): ReactElement | null {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const [container, setContainer] = useState<Element | null>(null)
  const [enabled, setEnabled] = useState(() => !store.get().includes(provider.provider))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => store.subscribe(() => setEnabled(!store.get().includes(provider.provider))), [store, provider.provider])

  // The slot's own node is rendered inside the row card; find the actions row
  // belonging to THIS card and portal into it.
  useEffect(() => {
    const node = anchor.current
    if (node === null) return
    const card = node.closest('li')
    const actions = card?.querySelector('[class*="rowActions"]')
    if (actions) setContainer(actions)
  }, [])

  const toggle = async (next: boolean): Promise<void> => {
    const disabled = withProviderToggled(store.get(), provider.provider, next)
    store.set(disabled)
    setEnabled(next)
    setBusy(true)
    setError('')
    try {
      const answer = await ctx.remote.settings.mutate(
        DISABLED_PROVIDERS_NAMESPACE,
        [disabledProvidersOp(disabled) as { op: 'set'; path: string[]; value: string[] }],
        undefined,
      )
      if (!answer.ok) throw new Error(answer.error?.message ?? 'settings/mutate refused')
      if (!next) await resetSelectionAfterDisable(ctx, disabled)
    } catch (cause) {
      store.set(withProviderToggled(disabled, provider.provider, !next))
      setEnabled(!next)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const button = createElement(Switch, {
    checked: enabled,
    onChange: (next: boolean) => { void toggle(next) },
    label: `${enabled ? t('providerVisibilityDisable') : t('providerVisibilityEnable')} ${provider.displayName}`,
    disabled: busy,
    ...(error ? { title: error } : {}),
    className: 'dshProviderVisibilitySwitch',
  })

  return createElement('span', { ref: anchor, style: { display: 'none' }, 'aria-hidden': 'true' },
    container === null ? null : createPortal(button, container),
  )
}

/**
 * Register one keyed slot occupant per settings namespace. The models page
 * dispatches with `entryKey = settingsNs`; we register for the namespaces that
 * can own a user-configured provider.
 */
export function registerProviderVisibility(ctx: unknown): void {
  const c = ctx as VisibilityContext
  const t = providerVisibilityTranslate(typeof navigator === 'undefined' ? 'en' : navigator.language)
  const store = createVisibilityStore()
  void readDisabled(c.remote).then(list => store.set(list)).catch(() => {})
  c.remote.$on('settings/document-updated', () => {
    void readDisabled(c.remote).then(list => store.set(list)).catch(() => {})
  })
  const face: VisibilityContext = {
    remote: c.remote,
    slots: c.slots,
    ...(c.modelDirectories === undefined ? {} : { modelDirectories: c.modelDirectories }),
  }

  for (const key of ['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']) {
    c.slots.inject('settings.models.provider-card', () => c.slots.register({
      name: 'settings.models.provider-card',
      key,
      inject: () => ({ ctx: face, store, t }),
    }, ProviderVisibilityCard))
  }
}
