type NativePlatform = 'darwin' | 'win32' | 'linux'

function nativePlatform(): NativePlatform {
  const value = new URLSearchParams(window.location.search).get('platform')
  return value === 'darwin' || value === 'win32' ? value : 'linux'
}

/** Only reserve renderer chrome when the BrowserWindow exposes native controls. */
export function desktopFrameIsVisible(search: string): boolean {
  return new URLSearchParams(search).get('frame') === 'true'
}

/** Independent 36px drag frame shared by Desktop-owned utility surfaces. */
export function DesktopFrame(): JSX.Element | null {
  if (!desktopFrameIsVisible(window.location.search)) return null
  return <header aria-hidden="true" className="dshNativeFrame" data-platform={nativePlatform()} />
}
