/** Desktop-owned find bar rendered into the frame-wide `shell.overlay` seat. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DesktopClientEnvironment } from './environment.ts'
import type { DesktopFindController, DesktopFindState } from './find-controller.ts'

/** Top inset keeping the bar clear of the window chrome it floats over. */
const FIND_BAR_TOP = { chrome: 12, dragRegion: 40 } as const

/** Registration-side capabilities for the Desktop find bar. */
export interface DesktopFindBarInjected {
  /** Shared find state machine owned by the Desktop client plugin. */
  readonly controller: DesktopFindController
  /** Renderer environment selecting the bar's inset below the window chrome. */
  readonly environment: DesktopClientEnvironment
}

/** Renderer-composed find-bar props. */
export type DesktopFindBarProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'desktop.find'>
  & InjectFace<DesktopFindBarInjected>

/**
 * Render the current match count for the bar.
 * @param state - current find snapshot.
 * @param t - find-bar translator.
 * @returns the localized count, or the no-results label.
 */
function countLabelOf(state: DesktopFindState, t: DesktopFindBarProps['t']): string {
  if (state.matches === 0) return t('noResults')
  return t(state.truncated ? 'matchCountTruncated' : 'matchCount', {
    active: state.activeIndex + 1,
    total: state.matches,
  })
}

/** Desktop find bar: query input, match count, navigation, and case toggle. */
export function DesktopFindBar({ controller, environment, t }: DesktopFindBarProps) {
  const state = useSyncExternalStore(
    useCallback(listener => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getSnapshot(), [controller]),
    // The bar never hydrates, but the third seat keeps the component renderable
    // outside a browser so presentation tests can assert its markup.
    useCallback(() => controller.getSnapshot(), [controller]),
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-focusing on every open request (not only on the closed→open edge) is
  // what makes a second Ctrl/Cmd+F return to the input after a match was
  // clicked in the page.
  useEffect(() => {
    if (!state.open) return
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [state.open, state.focusToken])

  const onInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    // Enter belongs to match navigation, never to the composer's send path.
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) controller.previous()
    else controller.next()
  }, [controller])

  if (!state.open) return null

  const top = environment.mode === 'advanced' && environment.platform !== 'linux'
    ? FIND_BAR_TOP.dragRegion
    : FIND_BAR_TOP.chrome
  const empty = state.matches === 0
  return (
    <div
      className="dshFindBar"
      data-dsh-find-excluded=""
      role="search"
      aria-label={t('label')}
      style={{ '--dsh-find-top': `${top}px` } as CSSProperties}
    >
      <input
        ref={inputRef}
        className="dshFindBarInput"
        type="text"
        value={state.query}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        spellCheck={false}
        autoComplete="off"
        onChange={event => { controller.setQuery(event.target.value) }}
        onKeyDown={onInputKeyDown}
      />
      <span
        className="dshFindBarCount"
        role="status"
        aria-live="polite"
        title={state.truncated ? t('truncatedHint', { total: state.matches }) : undefined}
      >
        {countLabelOf(state, t)}
      </span>
      <button
        type="button"
        className="dshFindBarButton"
        disabled={empty}
        aria-label={t('previous')}
        title={t('previous')}
        onClick={() => { controller.previous() }}
      >
        <ChevronUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className="dshFindBarButton"
        disabled={empty}
        aria-label={t('next')}
        title={t('next')}
        onClick={() => { controller.next() }}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className="dshFindBarButton"
        aria-label={t('matchCase')}
        title={t('matchCase')}
        aria-pressed={state.matchCase}
        onClick={() => { controller.toggleMatchCase() }}
      >
        <CaseSensitive aria-hidden="true" />
      </button>
      <button
        type="button"
        className="dshFindBarButton"
        aria-label={t('close')}
        title={t('close')}
        onClick={() => { controller.close() }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
