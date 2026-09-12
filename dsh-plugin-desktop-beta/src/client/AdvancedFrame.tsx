import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './contracts.ts'
import type { DesktopClientPlatform } from './environment.ts'
import {
  collapsedSidebarWidth, computeDesktopColumns, DesktopLayoutState,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, RIGHTBAR_DEFAULT_RATIO,
} from './layout-state.ts'

/** Private values assembled by one Desktop-owned shell registration. */
export interface AdvancedFrameInjected {
  /** Desktop-owned panel state exposed through the standard layout service. */
  layout: DesktopLayoutState
  /** Host platform controlling native title-bar spacing. */
  platform: DesktopClientPlatform
}

/** Full enhanced-mode root slot props. */
export type AdvancedFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.overlay'>
  & AdvancedFrameInjected

/** Enhanced-mode owner preserving the original Desktop layout contract. */
export function AdvancedFrame(props: AdvancedFrameProps) {
  return <DesktopOwnedFrame {...props} mode="advanced" />
}

/** Shared panel mechanics below the two mode-specific root boundaries. */
export function DesktopOwnedFrame({
  layout,
  mode,
  platform,
  renderSlot,
  usePanelInfo,
}: AdvancedFrameProps & {
  readonly mode: 'extended' | 'advanced'
}) {
  const subscribeLayout = useCallback((listener: () => void) => layout.subscribe(listener), [layout])
  const readLayout = useCallback(() => layout.getSnapshot(), [layout])
  const panels = useSyncExternalStore(subscribeLayout, readLayout, readLayout)
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  useEffect(() => {
    const element = frameRef.current
    if (element === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = element.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { layout.setNarrow(narrow) }, [layout, narrow])

  const collapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = collapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const rightbarPreference = panels.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  const normal = computeDesktopColumns(
    viewport, !panels.rightbarShown && narrow ? 0 : sidebarPreference,
    rightbarPreference, collapsedSidebarWidth(mode, platform),
  )
  const normalRef = useRef(normal)
  normalRef.current = normal
  const columns = computeDesktopColumns(
    viewport,
    sidebarPreference,
    panels.rightbarTrack ? rightbarPreference : 0,
    collapsedSidebarWidth(mode, platform),
  )
  // Enhanced macOS keeps a wider native rail around the centered upstream
  // sidebar. Extended mode and other platforms retain the upstream 56px rail.
  const sidebarOwnerWidth = collapsed ? SIDEBAR_COLLAPSED : columns.sidebar
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => {
    sidebarBase.current = columnsRef.current.sidebar
    setDragging(true)
  }, [])
  const onRightbarStart = useCallback(() => {
    rightbarBase.current = normalRef.current.rightbar
    setDragging(true)
  }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    layout.setSidebar(sidebarBase.current + dx)
  }, [layout])
  const onRightbarDrag = useCallback((dx: number) => {
    layout.setRightbar(rightbarBase.current - dx, viewport)
  }, [layout, viewport])

  return (
    <div
      ref={frameRef}
      className="dshDesktopFrame"
      data-desktop-mode={mode}
      data-desktop-platform={platform}
      data-sidebar-collapsed={collapsed || undefined}
      data-rightbar-collapsed={columns.rightbar === 0 || undefined}
      data-rightbar-fullscreen={panels.rightbarFullscreen || undefined}
      data-dragging={dragging || undefined}
      style={{ gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.rightbar}px` }}
    >
      {mode === 'advanced' && platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true" />}
      <aside className="dshDesktopSidebarSurface">
        <div className="dshDesktopUpstreamSidebar">
          {renderSlot('sidebar', { collapsed, width: sidebarOwnerWidth })}
        </div>
      </aside>
      <main className="dshDesktopConversationSurface"><MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} /></main>
      <aside className="dshDesktopRightbarSurface" data-rightbar-col>
        {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
      </aside>
      {/* Electron resolves app regions in DOM order; Desktop overlays must remain later. */}
      {mode === 'advanced' && platform === 'win32' && <div className="dshDesktopWindowsCaptionRow" aria-hidden="true" />}
      <div className="dshDesktopOverlay" data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {!collapsed && (
        <ResizeHandle
          side="sidebar"
          left={columns.sidebar}
          onStart={onSidebarStart}
          onDrag={onSidebarDrag}
          onEnd={onDragEnd}
        />
      )}
      {panels.rightbarShown && normal.rightbar > 0 && !panels.rightbarFullscreen && (
        <ResizeHandle
          side="rightbar"
          left={viewport - normal.rightbar}
          onStart={onRightbarStart}
          onDrag={onRightbarDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  )
}

function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

function ResizeHandle(props: {
  side: 'sidebar' | 'rightbar'
  left: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  return (
    <div
      className="dshDesktopResizeHandle"
      data-side={props.side}
      data-dragging={dragging || undefined}
      style={{ left: props.left }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
