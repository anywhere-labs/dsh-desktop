/** The app icon row of Desktop settings; setup offers the same choice on its first page. */
import { useId, useRef, useState } from 'react'
import { appIconDescription, appIconLabel, DESKTOP_APP_ICONS, type DesktopAppIcon } from '../app-icon.ts'
import type { DesktopCommand, DesktopState } from '../desktop-contract.ts'
import { AppIconPreview } from './app-icon-previews.tsx'

/**
 * The artwork in the Dock, window frames and tray: the default whale tail, or the classic DeepSeek whale. A choice
 * shows at once; Safe Mode keeps the default.
 */
export function NextAppIconSetting({ state, language, run }: {
  state: Pick<DesktopState, 'preferences' | 'platform' | 'safeMode'>; language: string; run(command: DesktopCommand): Promise<unknown>
}) {
  const zh = language.startsWith('zh')
  const labelId = useId()
  const choices = useRef<Partial<Record<DesktopAppIcon, HTMLButtonElement | null>>>({})
  const [pending, setPending] = useState<DesktopAppIcon>()
  const [failure, setFailure] = useState('')
  const value = pending ?? state.preferences.appIcon ?? 'default'
  const choose = (appIcon: DesktopAppIcon): void => {
    if (appIcon === value || pending !== undefined) return
    setPending(appIcon); setFailure('')
    void run({ type: 'app-icon', appIcon })
      .catch((error: unknown) => { setFailure(error instanceof Error ? error.message : String(error)) })
      .finally(() => { setPending(undefined) })
  }
  return <div className="dshDesktopSettingsUpdateRow" data-next-app-icon="">
    <span className="dshDesktopSettingsToggleCopy">
      <span className="dshDesktopSettingsToggleLabel" id={labelId}>{zh ? '应用图标' : 'App icon'}</span>
      <span className="dshDesktopSettingsToggleDescription">{state.safeMode ? zh ? '安全模式固定使用默认图标。' : 'Safe Mode always shows the default icon.'
        : appIconDescription(state.platform, zh)}</span>
      {failure && <span role="alert" className="dshDesktopSettingsError">{failure}</span>}
    </span>
    <span className="dshDesktopSettingsIconChoices" role="radiogroup" aria-labelledby={labelId}>
      {DESKTOP_APP_ICONS.map((icon, index) => <button key={icon} ref={button => { choices.current[icon] = button }} type="button" role="radio"
        className="dshDesktopSettingsIconChoice" aria-checked={value === icon} tabIndex={value === icon ? 0 : -1} disabled={state.safeMode}
        onClick={() => { choose(icon) }}
        onKeyDown={event => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
          if (step === 0) return
          event.preventDefault()
          const next = DESKTOP_APP_ICONS[(index + step + DESKTOP_APP_ICONS.length) % DESKTOP_APP_ICONS.length]!
          choices.current[next]?.focus()
          choose(next)
        }}>
        <AppIconPreview icon={icon} size={40} />
        <span>{appIconLabel(icon, zh)}</span>
      </button>)}
    </span>
  </div>
}
