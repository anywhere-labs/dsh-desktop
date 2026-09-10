import { DesktopOwnedFrame, type AdvancedFrameProps } from './AdvancedFrame.tsx'

/** Extended root owner beneath the independent inverted-L Desktop frame. */
export function ExtendedFrame(props: AdvancedFrameProps) {
  return <DesktopOwnedFrame {...props} mode="extended" />
}
