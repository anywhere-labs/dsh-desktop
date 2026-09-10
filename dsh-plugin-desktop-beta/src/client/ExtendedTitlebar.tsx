import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopFrameTitlebarView, type DesktopFrameTitlebarInjected } from './DesktopFrameTitlebarView.tsx'

export { DesktopVersionControl, DesktopModeControl, selectDesktopFrameMode } from './DesktopFrameTitlebarView.tsx'
export type { DesktopFrameTitlebarInjected } from './DesktopFrameTitlebarView.tsx'

export type DesktopFrameTitlebarProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopFrameTitlebarInjected>

export function DesktopFrameTitlebar(props: DesktopFrameTitlebarProps) {
  return createPortal(<DesktopFrameTitlebarView {...props} />, document.body)
}
