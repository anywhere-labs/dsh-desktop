/**
 * The Anywhere account beyond Settings, where the Desktop preferences put it: an entry in the left sidebar that opens
 * the account page in the main column, and a Conversation View tab that shows the page beside the conversation. The
 * right sidebar has no entry yet.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AnywhereAccountSettings } from './anywhere-account.tsx'
import type { OfficialModelsFace } from './anywhere-models.tsx'
import type { AnywherePlacement, AnywherePlacementView } from './anywhere-shared.ts'
import type { NextSettingsAdapter } from './settings-adapter.ts'

/** The account page's main-column panel and its sidebar entry share this id. */
export const ANYWHERE_PANEL_ID = 'anywhere-account' as MainPanelId
const VIEW_ID = 'anywhere-account'

/** What the account page needs wherever it shows. */
interface AccountFace {
  officialModels(): OfficialModelsFace | undefined
  placement: AnywherePlacement
}

/**
 * The placement kept in the Desktop preferences, read and written through the settings adapter.
 * @param adapter - the window's settings adapter; its state is the source.
 */
export function anywherePlacement(adapter: NextSettingsAdapter): AnywherePlacement {
  let source: unknown
  let view: AnywherePlacementView | undefined
  return {
    // One object per Desktop state, as React compares snapshots by identity.
    getSnapshot: () => {
      const state = adapter.getSnapshot()
      if (state !== source) {
        source = state
        view = state === undefined ? undefined : {
          sidebar: state.preferences.anywhereSidebar !== false,
          conversation: state.preferences.anywhereConversation === true,
          writable: !state.safeMode,
        }
      }
      return view
    },
    subscribe: listener => adapter.subscribe(listener),
    set: change => adapter.savePreferences({
      ...(change.sidebar === undefined ? {} : { anywhereSidebar: change.sidebar }),
      ...(change.conversation === undefined ? {} : { anywhereConversation: change.conversation }),
    }),
  }
}

/** The account glyph, sized by its owner: the settings navigation and the left sidebar both draw it. */
export function AnywhereAccountGlyph({ size }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.375" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="6.5" r="2.125" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4.25 12.75c.75-1.5 2.15-2.25 3.75-2.25s3 .75 3.75 2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

/** The account page in the main column, as the left sidebar entry opens it. */
function AnywhereAccountPanel({ t, officialModels, placement }: PropsLocale<'desktop-next'> & AccountFace) {
  return (
    <div className="dshAnywhereStandalone">
      <div className="dshAnywhereStandaloneScroll">
        <AnywhereAccountSettings language={t('language')} officialModels={officialModels} placement={placement} />
      </div>
    </div>
  )
}

/** The account page as a Conversation View: the tab names it, so the page drops its own heading. */
function AnywhereAccountView({ t, officialModels, placement }: PropsLocale<'desktop-next'> & AccountFace) {
  return (
    <div className="dshAnywhereStandalone" data-view="">
      <div className="dshAnywhereStandaloneScroll">
        <AnywhereAccountSettings language={t('language')} officialModels={officialModels} placement={placement} heading={false} />
      </div>
    </div>
  )
}

/**
 * Keep the account's entries where the preferences put them. The main-column panel itself stays registered, so a page
 * being read survives turning its sidebar entry off, and the sidebar's More menu can still open it.
 * @param ctx - the Next client context.
 * @param options.label - the account's name in the sidebar and the View tabs.
 */
export function registerAnywhereEntries(ctx: Context, { label, placement, officialModels }: AccountFace & { label: () => string }): void {
  const face: AccountFace = { officialModels, placement }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: ANYWHERE_PANEL_ID, locale: 'desktop-next', inject: () => face,
  }, AnywhereAccountPanel))
  let sidebar: (() => void) | undefined
  let view: (() => void) | undefined
  const sync = (): void => {
    const current = placement.getSnapshot()
    if (current === undefined) return
    if (current.sidebar && sidebar === undefined) {
      sidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: ANYWHERE_PANEL_ID, order: 20, locale: 'desktop-next', label,
      }, AnywhereAccountGlyph))
    } else if (!current.sidebar && sidebar !== undefined) {
      sidebar()
      sidebar = undefined
    }
    if (current.conversation && view === undefined) {
      view = ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: VIEW_ID, order: 50, locale: 'desktop-next', label, inject: () => face,
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
  }, 'Anywhere account entries where the preferences put them')
}
