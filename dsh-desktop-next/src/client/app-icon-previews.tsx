/** The icons:export thumbnails of each app icon choice, with this variant's own badge. */
import defaultPreview from '../../build/app-icon-preview.png'
import defaultDarkPreview from '../../build/app-icon-preview-dark.png'
import classicPreview from '../../build/classic/app-icon-preview.png'
import type { DesktopAppIcon } from '../app-icon.ts'

/** Each choice in a light and a dark theme. The classic icon looks the same in both, so it has one image. */
export const APP_ICON_PREVIEWS: Readonly<Record<DesktopAppIcon, { readonly light: string; readonly dark: string }>> = Object.freeze({
  default: Object.freeze({ light: defaultPreview, dark: defaultDarkPreview }),
  classic: Object.freeze({ light: classicPreview, dark: classicPreview }),
})

/**
 * A choice's thumbnail in the rendition the system shows for the page's theme, as the macOS Dock does with the layered
 * icon and Windows and Linux do with the Dark rendition.
 * @param props.icon - The choice.
 * @param props.size - Width and height in CSS pixels.
 */
export function AppIconPreview({ icon, size }: { icon: DesktopAppIcon; size: number }) {
  const { light, dark } = APP_ICON_PREVIEWS[icon]
  return <picture>
    {dark !== light && <source srcSet={dark} media="(prefers-color-scheme: dark)" />}
    <img src={light} alt="" width={size} height={size} draggable={false} />
  </picture>
}
