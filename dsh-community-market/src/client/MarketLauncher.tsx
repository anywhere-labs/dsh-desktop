import { useCallback, useSyncExternalStore } from 'react'
import {
  Button,
  IconCordisPluginOutline14,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketSettingsDocument } from '../catalog/source-store.js'
import type { createMarketViewStore } from './market-view-store.js'

export type MarketLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createMarketViewStore>>
  & PropsLocale<'community-market'>
  & InjectFace<{ marketSettings: SettingsScope<MarketSettingsDocument> }>

export function MarketLauncher({ wide, useStore, actions, t, marketSettings }: MarketLauncherProps) {
  const open = useStore(state => state.open)
  const subscribe = useCallback((listener: () => void) => marketSettings.subscribe(listener), [marketSettings])
  const readSettings = useCallback(() => marketSettings.getSnapshot(), [marketSettings])
  const settings = useSyncExternalStore(subscribe, readSettings)
  if (settings.value?.sidebarLauncherVisible === false) return null
  return (
    <Tooltip label={t('tab')} delayMs={500} disabled={wide}>
      <Button
        variant="ghost"
        className="dshMarketLauncher"
        data-wide={wide}
        aria-label={t('tab')}
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={<IconCordisPluginOutline14 size={wide ? 16 : 18} />}
        onClick={() => actions.open()}
      >
        {wide ? t('tab') : null}
      </Button>
    </Tooltip>
  )
}
