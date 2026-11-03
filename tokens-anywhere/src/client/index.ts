/**
 * Client face of tokens-anywhere: the Anywhere account page in the official Settings dialog, and wherever the plugin's
 * configuration puts it besides (./entries.tsx). Every call goes to the Host face's routes (../account.ts).
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
import type { OfficialModelsFace } from './models.tsx'
import type { AnywherePlacement } from './shared.ts'
import { installAnywhereAccountStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'tokens-anywhere': 'title' | 'language'
  }
}

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('tokens-anywhere', {
    zh: { title: 'Anywhere 账户', language: 'zh' },
    en: { title: 'Anywhere account', language: 'en' },
  }), 'tokens-anywhere: labels')
  ctx.effect(installAnywhereAccountStyles, 'tokens-anywhere: page styles')
  const t = ctx.locale.bind('tokens-anywhere')
  // Custom configuration edits the account's routes with the official Models section's own parts.
  const officialModels = (): OfficialModelsFace | undefined =>
    ctx.slots.entries('settings.section').find(entry => entry.options.id === 'models')?.inject?.() as OfficialModelsFace | undefined
  const placement = anywherePlacement()
  // The settings shell draws a section's navigation glyph from the `settings.section.icon` slot, keyed by the section id.
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'tokens-anywhere' }, AnywhereAccountGlyph))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'tokens-anywhere', order: 90, locale: 'tokens-anywhere', label: () => t('title'),
    inject: () => ({ officialModels, placement }),
  }, AnywhereAccount))
  // The left sidebar entry and the Conversation View follow the configuration, read once from the Host.
  registerAnywhereEntries(ctx, { label: () => t('title'), placement, officialModels })
  void placement.load().catch(() => {})
}

function AnywhereAccount({ t, officialModels, placement }: PropsLocale<'tokens-anywhere'> & { officialModels(): OfficialModelsFace | undefined; placement: AnywherePlacement }) {
  return createElement(AnywhereAccountSettings, { language: t('language'), officialModels, placement })
}
