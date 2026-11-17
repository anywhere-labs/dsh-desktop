/**
 * Client face of `@agents-anywhere/dsh-tokens-anywhere`: the Anywhere account page in the official Settings dialog,
 * and wherever the plugin's configuration puts it besides (./entries.tsx). Every call goes to the Host face's routes
 * (../account.ts).
 */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AnywhereAccountSettings } from './account.tsx'
import { AnywhereAccountGlyph, anywherePlacement, registerAnywhereEntries } from './entries.tsx'
import type { ModelSettings } from './models.tsx'
import type { AnywherePlacement, WatchRoutes } from './shared.ts'
import { installAnywhereAccountStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'tokens-anywhere': 'title' | 'language'
  }
}

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: Context): void {
  // The page, its Settings section, the sidebar entry and the View tab go by the product's own name in both languages.
  ctx.effect(() => ctx.locale.register('tokens-anywhere', {
    zh: { title: 'Tokens Anywhere', language: 'zh' },
    en: { title: 'Tokens Anywhere', language: 'en' },
  }), 'tokens-anywhere: labels')
  ctx.effect(installAnywhereAccountStyles, 'tokens-anywhere: page styles')
  const t = ctx.locale.bind('tokens-anywhere')
  // Settings → Models opens through the settings shell's own store (dsh-client-ui-settings-general), whose handle gives
  // every create() the one instance the shell renders. A handle that makes fresh instances would open nothing, so it
  // does not count.
  const modelSettings: ModelSettings = () => {
    for (const entry of ctx.slots.entries('sidebar.settings')) {
      const store = entry.store as { create?: () => unknown } | undefined
      if (typeof store?.create !== 'function') continue
      const shell = store.create() as { actions?: { openSection?: (id: string) => void } } | undefined
      const actions = shell?.actions
      if (typeof actions?.openSection !== 'function' || store.create() !== shell) continue
      return () => { actions.openSection?.('models') }
    }
    return undefined
  }
  // The routes live in `llm-pi-ai`, which Settings → Models edits: when the settings mirror shows it moved, the page
  // reads the account again, and the Host answers once it has settled the edit.
  const routeListeners = new Set<() => void>()
  const watchRoutes: WatchRoutes = (listener) => {
    routeListeners.add(listener)
    return () => { routeListeners.delete(listener) }
  }
  ctx.inject(['configForms'], (inner) => {
    const mirror = inner.configForms.describe()
    const revision = (): number | undefined => mirror.getSnapshot().view?.namespaces.find(view => view.ns === 'llm-pi-ai')?.revision
    let seen = revision()
    inner.effect(() => mirror.subscribe(() => {
      const next = revision()
      if (next === seen) return
      seen = next
      for (const listener of [...routeListeners]) listener()
    }), 'tokens-anywhere: routes edited in Settings → Models')
  })
  const placement = anywherePlacement()
  // The settings shell draws a section's navigation glyph from the `settings.section.icon` slot, keyed by the section id.
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'tokens-anywhere' }, AnywhereAccountGlyph))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'tokens-anywhere', order: 90, locale: 'tokens-anywhere', label: () => t('title'),
    inject: () => ({ modelSettings, placement, watchRoutes }),
  }, AnywhereAccount))
  // The left sidebar entry and the Conversation View follow the configuration, read once from the Host.
  registerAnywhereEntries(ctx, { label: () => t('title'), placement, modelSettings, watchRoutes })
  void placement.load().catch(() => {})
}

function AnywhereAccount({ t, modelSettings, placement, watchRoutes }: PropsLocale<'tokens-anywhere'> & {
  modelSettings: ModelSettings
  placement: AnywherePlacement
  watchRoutes: WatchRoutes
}) {
  return createElement(AnywhereAccountSettings, { language: t('language'), modelSettings, placement, watchRoutes })
}
