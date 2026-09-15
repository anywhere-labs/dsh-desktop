/** Inline glyphs for the Desktop browser panel, drawn with `currentColor` only. */

/** Icons the panel uses. */
export type DesktopBrowserGlyphName =
  | 'browser' | 'back' | 'forward' | 'reload' | 'stop' | 'go' | 'menu' | 'close' | 'plus'

const PATHS: Record<DesktopBrowserGlyphName, string> = {
  browser: 'M2 3.5h12v9H2zM2 6.2h12M4 4.9h.01M5.4 4.9h.01',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  forward: 'M6 3.5 10.5 8 6 12.5',
  reload: 'M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.5 2.6V5h-2.4',
  stop: 'M4.5 4.5l7 7m0-7-7 7',
  go: 'M3 8h9m-3.5-3.5L12 8l-3.5 3.5',
  menu: 'M3 5h10M3 8h10M3 11h10',
  close: 'M4.5 4.5l7 7m0-7-7 7',
  plus: 'M8 3.5v9M3.5 8h9',
}

/** One 16-pixel icon. */
export function DesktopBrowserGlyph({ name }: { name: DesktopBrowserGlyphName }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
