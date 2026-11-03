/**
 * The Anywhere account beyond Settings, where the plugin's configuration puts it: an entry in the left sidebar that
 * opens the account page in the main column, and a Conversation View tab that shows the page beside the conversation.
 * The right sidebar has no entry yet.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywherePlacementState } from '../account.ts'
import { AnywhereAccountSettings } from './account.tsx'
import type { OfficialModelsFace } from './models.tsx'
import { callHost, type AnywherePlacement, type AnywherePlacementView } from './shared.ts'

/** The account page's main-column panel and its sidebar entry share this id. */
export const ANYWHERE_PANEL_ID = 'tokens-anywhere' as MainPanelId
const VIEW_ID = 'tokens-anywhere'

/** What the account page needs wherever it shows. */
interface AccountFace {
  officialModels(): OfficialModelsFace | undefined
  placement: AnywherePlacement
}

/** The placement in the plugin's configuration, read once and written through the Host's placement route. */
export function anywherePlacement(): AnywherePlacement & { load(): Promise<void> } {
  let view: AnywherePlacementView | undefined
  const listeners = new Set<() => void>()
  const publish = (state: AnywherePlacementState | undefined): void => {
    if (state === undefined) return
    view = state
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: async () => { publish((await callHost<AnywherePlacementState>(ANYWHERE_ACCOUNT_ROUTES.placement)).result) },
    set: async (change) => {
      const reply = await callHost<AnywherePlacementState>(ANYWHERE_ACCOUNT_ROUTES.placement, change)
      publish(reply.result)
      if (reply.error !== undefined) throw new Error(reply.error.code)
    },
  }
}

/** The settings navigation's account glyph, at the sidebar's size. */
function AnywhereAccountGlyph({ size }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.375" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="6.5" r="2.125" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4.25 12.75c.75-1.5 2.15-2.25 3.75-2.25s3 .75 3.75 2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

/** The account page in the main column, as the left sidebar entry opens it. */
function AnywhereAccountPanel({ t, officialModels, placement }: PropsLocale<'tokens-anywhere'> & AccountFace) {
  return (
    <div className="dshAnywhereStandalone">
      <div className="dshAnywhereStandaloneScroll">
        <AnywhereAccountSettings language={t('language')} officialModels={officialModels} placement={placement} />
      </div>
    </div>
  )
}

/** The account page as a Conversation View: the tab names it, so the page drops its own heading. */
function AnywhereAccountView({ t, officialModels, placement }: PropsLocale<'tokens-anywhere'> & AccountFace) {
  return (
    <div className="dshAnywhereStandalone" data-view="">
      <div className="dshAnywhereStandaloneScroll">
        <AnywhereAccountSettings language={t('language')} officialModels={officialModels} placement={placement} heading={false} />
      </div>
    </div>
  )
}

/**
 * Keep the account's entries where the configuration puts them. The main-column panel itself stays registered, so a
 * page being read survives turning its sidebar entry off, and the sidebar's More menu can still open it.
 * @param ctx - the plugin's client context.
 * @param options.label - the account's name in the sidebar and the View tabs.
 */
export function registerAnywhereEntries(ctx: Context, { label, placement, officialModels }: AccountFace & { label: () => string }): void {
  const face: AccountFace = { officialModels, placement }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: ANYWHERE_PANEL_ID, locale: 'tokens-anywhere', inject: () => face,
  }, AnywhereAccountPanel))
  let sidebar: (() => void) | undefined
  let view: (() => void) | undefined
  const sync = (): void => {
    const current = placement.getSnapshot()
    if (current === undefined) return
    if (current.sidebar && sidebar === undefined) {
      sidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: ANYWHERE_PANEL_ID, order: 20, locale: 'tokens-anywhere', label,
      }, AnywhereAccountGlyph))
    } else if (!current.sidebar && sidebar !== undefined) {
      sidebar()
      sidebar = undefined
    }
    if (current.conversation && view === undefined) {
      view = ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: VIEW_ID, order: 50, locale: 'tokens-anywhere', label, inject: () => face,
      }, AnywhereAccountView))
    } else if (!current.conversation && view !== undefined) {
      view()
      view = undefined
    }
  }
  ctx.effect(() => {
    const unsubscribe = placement.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      sidebar?.()
      view?.()
      sidebar = undefined
      view = undefined
    }
  }, 'tokens-anywhere: entries where the configuration puts them')
}
