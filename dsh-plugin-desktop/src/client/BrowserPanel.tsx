/** Desktop browser panel: tab strip, toolbar, and the host for the native page. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BROWSER_ZOOM_LEVELS, DesktopBrowserPanelController, type BrowserPanelSnapshot } from './browser-panel.ts'
import type { DesktopBrowserLocaleKey } from './browser-locales.ts'
import { DesktopBrowserGlyph } from './browser-glyphs.tsx'
import type { DesktopBrowserLayout } from '../desktop-browser-session.ts'

/** Registration-side capability: the per-Session panel controller factory. */
export interface DesktopBrowserPanelInjected {
  /** Controller of one Session, created on first request and shared by both surfaces. */
  readonly controller: (sessionId: string) => DesktopBrowserPanelController
}

/** Props of the panel's right-column entry. */
export type DesktopBrowserPanelProps =
  PropsRuntime<'rightbar'>
  & PropsLocale<'desktop.browser'>
  & InjectFace<DesktopBrowserPanelInjected>

/** Props of the header toggle that opens and closes the panel. */
export type DesktopBrowserToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'desktop.browser'>
  & InjectFace<DesktopBrowserPanelInjected>

type Translate = (key: DesktopBrowserLocaleKey) => string

/** The overlay entry: resolves the Session and defers every hook to its child. */
export function DesktopBrowserPanel({ t, useSessions, controller, width, viewportWidth }: DesktopBrowserPanelProps): React.ReactElement | null {
  const sessionId = useSessions(list => list.current)
  if (sessionId === undefined) return null
  return <BrowserPanelForSession controller={controller(sessionId)} t={t} width={width} viewportWidth={viewportWidth} />
}

/** The header button that shows and hides the panel for one Session. */
export function DesktopBrowserToggle({ t, sessionId, controller }: DesktopBrowserToggleProps): React.ReactElement {
  const panel = controller(sessionId)
  const snapshot = useSyncExternalStore(panel.subscribe, panel.getSnapshot, panel.getSnapshot)
  useEffect(() => {
    // The toggle outlives no panel: it only asks the Host for state so the
    // button can show whether the Agent opened the panel for this Session.
    panel.start()
  }, [panel])
  const tabCount = snapshot.state?.tabs.length ?? 0
  return (
    <button
      type="button"
      className="dshDesktopBrowserToggle"
      data-dsh-desktop-browser-action="toggle"
      aria-pressed={snapshot.open}
      title={t('toggleHint')}
      onClick={() => { panel.toggle() }}
    >
      <DesktopBrowserGlyph name="browser" />
      <span>{t('toggle')}</span>
      {tabCount > 0 && <span className="dshDesktopBrowserToggleCount" data-dsh-desktop-browser="tab-count">{tabCount}</span>}
    </button>
  )
}

/** One Session's panel instance. */
function BrowserPanelForSession({ controller, t, width, viewportWidth }: {
  controller: DesktopBrowserPanelController
  t: Translate
  /** Column width the frame currently gives this panel. */
  width: number
  /** Width of the whole window, so one step keeps its ratio. */
  viewportWidth: number
}): React.ReactElement | null {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const stage = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<'none' | 'tools' | 'history'>('none')
  const [frameInsets, setFrameInsets] = useState({ top: 0, left: 0 })

  useEffect(() => {
    controller.start()
    return () => { controller.setStage(null) }
  }, [controller])

  // This instance only exists for the Session on screen, so it owns the shared
  // column for as long as it is mounted and hands it back when it leaves.
  useEffect(() => {
    controller.setActive(true)
    return () => { controller.setActive(false) }
  }, [controller])

  // The frame owns the column width; the panel only remembers it so its own
  // width controls can ask for one step more or less.
  useEffect(() => {
    controller.setColumn(width, viewportWidth)
  }, [controller, width, viewportWidth])

  // Switching to a Session whose panel is closed hands the shared column back,
  // so the shipped right Sidebar gets it instead of an empty track.
  useEffect(() => {
    controller.idle()
  }, [controller, snapshot.open])

  // The page is composited above the renderer, so any transient surface drawn
  // over the placeholder must withdraw the view for as long as it is open.
  useEffect(() => {
    controller.setOcclusion(menu === 'none' ? 'none' : menu === 'history' ? 'history' : 'menu')
  }, [controller, menu])

  useLayoutEffect(() => {
    const element = stage.current
    controller.setStage(element)
    if (element === null) return () => {}
    const observer = new ResizeObserver(() => { controller.setStage(element) })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [controller, snapshot.open, snapshot.fullscreen])

  // An expanded panel takes the conversation column and the right column, so the
  // left sidebar, the caption row, the traffic lights and the drag region all
  // stay where the user left them.
  useLayoutEffect(() => {
    if (!snapshot.fullscreen) return () => {}
    const measure = (): void => {
      const row = document.querySelector('.dshDesktopMacCaptionRow, .dshDesktopWindowsCaptionRow')
      const sidebar = document.querySelector('.dshDesktopSidebarSurface')
      setFrameInsets({
        top: row === null ? 0 : Math.round(row.getBoundingClientRect().height),
        left: sidebar === null ? 0 : Math.round(sidebar.getBoundingClientRect().width),
      })
    }
    measure()
    const sidebar = document.querySelector('.dshDesktopSidebarSurface')
    const observer = new ResizeObserver(measure)
    if (sidebar !== null) observer.observe(sidebar)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [snapshot.fullscreen])

  // The column is laid out by the frame, so a window resize only has to re-report
  // the placeholder the shell places the guest view into.
  useLayoutEffect(() => {
    const measure = (): void => { controller.setStage(stage.current) }
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [controller, snapshot.open])

  const state = snapshot.state
  const active = state?.tabs.find(tab => tab.id === state.activeId)
  const onAddress = useCallback((event: React.ChangeEvent<HTMLInputElement>) => { controller.setAddress(event.target.value) }, [controller])
  const onAddressKey = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void controller.submitAddress()
  }, [controller])

  if (!snapshot.open) return null

  return (
    <aside
      className="dshDesktopBrowserPanel"
      data-dsh-desktop-browser="panel"
      data-open="true"
      data-connected={snapshot.connected}
      data-layout={snapshot.layout}
      data-fullscreen={snapshot.fullscreen || undefined}
      data-tabs={state?.tabs.length ?? 0}
      role="complementary"
      aria-label={t('title')}
      style={snapshot.fullscreen ? { position: 'fixed', top: frameInsets.top, right: 0, bottom: 0, left: frameInsets.left, width: 'auto', zIndex: 30, borderLeft: 0 } : undefined}
    >
      <div className="dshDesktopBrowserPanelToolbar" data-dsh-desktop-browser="toolbar">
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="back" title={t('back')} disabled={state?.canGoBack !== true} onClick={() => { void controller.act({ action: 'back' }) }}>
          <DesktopBrowserGlyph name="back" />
        </button>
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="forward" title={t('forward')} disabled={state?.canGoForward !== true} onClick={() => { void controller.act({ action: 'forward' }) }}>
          <DesktopBrowserGlyph name="forward" />
        </button>
        {state?.loading === true
          ? <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="stop" title={t('stop')} onClick={() => { void controller.act({ action: 'stop' }) }}><DesktopBrowserGlyph name="stop" /></button>
          : <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="reload" title={t('reload')} disabled={active === undefined} onClick={() => { void controller.act({ action: 'reload' }) }}><DesktopBrowserGlyph name="reload" /></button>}
        <input
          className="dshDesktopBrowserPanelAddress"
          data-dsh-desktop-browser="address"
          aria-label={t('address')}
          placeholder={t('addressPlaceholder')}
          value={snapshot.address}
          onChange={onAddress}
          onKeyDown={onAddressKey}
          spellCheck={false}
        />
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="address-open" title={t('open')} onClick={() => { void controller.submitAddress() }}>
          <DesktopBrowserGlyph name="go" />
        </button>
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="tools" data-active={menu === 'tools'} title={t('tools')} onClick={() => { setMenu(menu === 'tools' ? 'none' : 'tools') }}>
          <DesktopBrowserGlyph name="menu" />
        </button>
        <span className="dshDesktopBrowserPanelDivider" aria-hidden="true" />
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="narrower" title={t('narrower')} onClick={() => { controller.narrower() }}>
          <DesktopBrowserGlyph name="narrower" />
        </button>
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="wider" title={t('wider')} onClick={() => { controller.wider() }}>
          <DesktopBrowserGlyph name="wider" />
        </button>
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="fullscreen" data-active={snapshot.fullscreen} title={snapshot.fullscreen ? t('restore') : t('fullscreen')} onClick={() => { controller.toggleFullscreen() }}>
          <DesktopBrowserGlyph name={snapshot.fullscreen ? 'restore' : 'fullscreen'} />
        </button>
        <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-action="close" title={t('closePanel')} onClick={() => { controller.setOpen(false) }}>
          <DesktopBrowserGlyph name="close" />
        </button>
      </div>

      <div className="dshDesktopBrowserPanelTabs" data-dsh-desktop-browser="tabs" role="tablist" aria-label={t('tabs')}>
        {(state?.tabs ?? []).map(tab => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.active}
            className="dshDesktopBrowserPanelTab"
            data-dsh-desktop-browser-tab={tab.id}
            data-active={tab.active}
            onClick={() => { void controller.act({ action: 'tabs', op: 'select', tab: tab.id }) }}
          >
            <span className="dshDesktopBrowserPanelTabTitle" data-dsh-desktop-browser="tab-title">{tab.title === '' ? tab.url : tab.title}</span>
            <button
              type="button"
              className="dshDesktopBrowserPanelTabClose"
              data-dsh-desktop-browser-tab-close={tab.id}
              title={t('closeTab')}
              onClick={(event) => {
                event.stopPropagation()
                void controller.act({ action: 'tabs', op: 'close', tab: tab.id })
              }}
            >
              <DesktopBrowserGlyph name="close" />
            </button>
          </div>
        ))}
        <button type="button" className="dshDesktopBrowserPanelButton dshDesktopBrowserPanelNewTab" data-dsh-desktop-browser-action="new-tab" title={t('newTab')} onClick={() => { void controller.act({ action: 'tabs', op: 'new' }) }}>
          <DesktopBrowserGlyph name="plus" />
        </button>
      </div>

      <div className="dshDesktopBrowserPanelStage" data-dsh-desktop-browser="stage" ref={stage}>
        {(state?.tabs.length ?? 0) === 0 && (
          <div className="dshDesktopBrowserPanelEmpty" data-dsh-desktop-browser="empty">
            <div className="dshDesktopBrowserPanelEmptyTitle">{t('emptyTitle')}</div>
            <div>{t('emptyBody')}</div>
          </div>
        )}
      </div>

      {menu !== 'none' && (
        <div className="dshDesktopBrowserPanelMenu" data-dsh-desktop-browser="menu" data-menu={menu}>
          {menu === 'tools'
            ? (
              <>
                <div className="dshDesktopBrowserPanelMenuGroup">{t('zoom')}</div>
                {BROWSER_ZOOM_LEVELS.map(level => (
                  <button
                    key={level}
                    type="button"
                    className="dshDesktopBrowserPanelMenuItem"
                    data-dsh-desktop-browser-menu-item={`zoom-${String(level)}`}
                    data-selected={snapshot.layout === 'fit' && Math.abs(snapshot.zoom - level) < 0.001}
                    onClick={() => { controller.setZoom(level); setMenu('none') }}
                  >
                    <span>{`${String(Math.round(level * 100))}%`}</span>
                  </button>
                ))}
                <div className="dshDesktopBrowserPanelMenuGroup">Layout</div>
                <button type="button" className="dshDesktopBrowserPanelMenuItem" data-dsh-desktop-browser-menu-item="layout-fit" data-selected={snapshot.layout === 'fit'} onClick={() => { controller.setLayout('fit'); setMenu('none') }}>
                  <span>{t('layoutFit')}</span>
                </button>
                <button type="button" className="dshDesktopBrowserPanelMenuItem" data-dsh-desktop-browser-menu-item="layout-desktop" data-selected={snapshot.layout === 'desktop'} onClick={() => { controller.setLayout('desktop'); setMenu('none') }}>
                  <span>{t('layoutDesktop')}</span>
                </button>
                <button type="button" className="dshDesktopBrowserPanelMenuItem" data-dsh-desktop-browser-menu-item="history" onClick={() => { void controller.loadHistory(); setMenu('history') }}>
                  <span>{t('history')}</span>
                </button>
              </>
            )
            : (
              <div className="dshDesktopBrowserPanelHistory">
                {snapshot.history.length === 0
                  ? <div className="dshDesktopBrowserPanelMenuGroup">{t('history')}</div>
                  : snapshot.history.map(entry => (
                    <button
                      key={`${entry.url}:${entry.title}`}
                      type="button"
                      className="dshDesktopBrowserPanelMenuItem"
                      data-dsh-desktop-browser-menu-item={`history-${entry.url}`}
                      onClick={() => {
                        controller.setAddress(entry.url)
                        void controller.act({ action: 'navigate', url: entry.url }).then(() => { setMenu('none') })
                      }}
                    >
                      <span className="dshDesktopBrowserPanelTabTitle">{entry.title === '' ? entry.url : entry.title}</span>
                    </button>
                  ))}
              </div>
            )}
        </div>
      )}

      {snapshot.error !== undefined && (
        <div className="dshDesktopBrowserPanelError" data-dsh-desktop-browser="error">
          <span data-dsh-desktop-browser="error-text">{snapshot.error}</span>
          <span className="dshDesktopBrowserPanelStatusSpacer" />
          <button type="button" className="dshDesktopBrowserPanelButton" data-dsh-desktop-browser-error-dismiss="true" title={t('dismissError')} onClick={() => { controller.dismissError() }}>
            <DesktopBrowserGlyph name="close" />
          </button>
        </div>
      )}

      <div className="dshDesktopBrowserPanelStatus" data-dsh-desktop-browser="status">
        <span className="dshDesktopBrowserPanelDot" data-connected={snapshot.connected} />
        <span data-dsh-desktop-browser="viewport">
          {`${String(state?.viewport.width ?? 0)}×${String(state?.viewport.height ?? 0)}`}
        </span>
        <span data-dsh-desktop-browser="zoom">{`${String(Math.round((state?.zoom ?? 1) * 100))}%`}</span>
        <span data-dsh-desktop-browser="layout">{state?.layout === 'desktop' ? t('layoutDesktop') : t('layoutFit')}</span>
        <span className="dshDesktopBrowserPanelStatusSpacer" />
        <span data-dsh-desktop-browser="phase">{state?.loading === true ? t('loading') : snapshot.connected ? t('ready') : t('disconnected')}</span>
      </div>
    </aside>
  )
}

/** Layout levels the panel exposes to tests and to the Agent's contract. */
export const DESKTOP_BROWSER_LAYOUTS: readonly DesktopBrowserLayout[] = ['fit', 'desktop']

/** Re-export for consumers that build their own toolbar. */
export { DesktopBrowserPanelController }
export type { BrowserPanelSnapshot }
