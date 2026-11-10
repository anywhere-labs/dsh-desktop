import { useEffect, useRef } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { ANDROID_LOGCAT_LOCALE_NAMESPACE } from './android-logcat-locales.ts'
import type { AndroidLogcatStore } from './android-logcat-store.ts'

export type AndroidLogcatLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<AndroidLogcatStore>
  & PropsLocale<typeof ANDROID_LOGCAT_LOCALE_NAMESPACE>

function AndroidLogcatIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3.25h12M2 6.5h12M2 9.75h8M2 13h6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="12.25" cy="11.75" r="2.25" fill="currentColor" />
    </svg>
  )
}

/** Sidebar footer action that toggles the Android Logcat bottom drawer. */
export function AndroidLogcatLauncher({ wide, useStore, actions, t }: AndroidLogcatLauncherProps) {
  const open = useStore(state => state.open)
  const focusReturnRequested = useStore(state => state.focusReturnRequested)
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  useEffect(() => {
    if (open || !focusReturnRequested) return
    document.getElementById('dsh-android-logcat-launcher')?.focus()
    actionsRef.current.consumeFocusReturn()
  }, [open, focusReturnRequested])
  return (
    <Tooltip label={t('launcher')} delayMs={500} disabled={wide}>
      <Button
        variant="ghost"
        id="dsh-android-logcat-launcher"
        className="dshAndroidLogcatLauncher"
        data-wide={wide}
        aria-label={t('launcher')}
        aria-controls="dsh-android-logcat-drawer"
        aria-expanded={open}
        icon={<AndroidLogcatIcon size={wide ? 16 : 18} />}
        onClick={() => open ? actions.close() : actions.open()}
      >
        {wide ? t('launcher') : null}
      </Button>
    </Tooltip>
  )
}
