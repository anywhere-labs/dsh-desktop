import { useCallback, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketSettingsDocument } from '../catalog/source-store.js'

export interface MarketSidebarVisibilitySettingProps extends PropsLocale<'community-market'> {
  readonly marketSettings: SettingsScope<MarketSettingsDocument>
}

export function MarketSidebarVisibilitySetting({ marketSettings, t }: MarketSidebarVisibilitySettingProps) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const subscribe = useCallback((listener: () => void) => marketSettings.subscribe(listener), [marketSettings])
  const readSettings = useCallback(() => marketSettings.getSnapshot(), [marketSettings])
  const settings = useSyncExternalStore(subscribe, readSettings)
  const visible = settings.value?.sidebarLauncherVisible !== false
  const writable = settings.status === 'ready' && settings.writable

  const update = (): void => {
    setPending(true)
    setFailed(false)
    void marketSettings.set('sidebarLauncherVisible', !visible)
      .catch(() => { setFailed(true) })
      .finally(() => { setPending(false) })
  }

  return (
    <div className="dshMarketVisibilitySetting">
      <span className="dshMarketVisibilityCopy">
        <span id="dsh-market-sidebar-visibility-label" className="dshMarketVisibilityTitle">
          {t('sidebarLauncherVisibility')}
        </span>
        <span className="dshMarketVisibilityBody">{t('sidebarLauncherVisibilityBody')}</span>
        {failed && <span className="dshMarketError" role="alert">{t('sidebarLauncherVisibilityError')}</span>}
      </span>
      <button
        type="button"
        role="switch"
        className="dshMarketVisibilityToggle"
        aria-checked={visible}
        aria-labelledby="dsh-market-sidebar-visibility-label"
        disabled={!writable || pending}
        onClick={update}
      >
        <span className="dshMarketVisibilityKnob" aria-hidden="true" />
      </button>
    </div>
  )
}
