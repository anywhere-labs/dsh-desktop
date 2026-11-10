/** Sidebar footer launcher toggling the Desktop terminal panel. */
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE } from './desktop-terminal-panel-locales.ts'
import type { DesktopTerminalLauncherInjected } from './desktop-terminal-panel-face.ts'

export type DesktopTerminalLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof DESKTOP_TERMINAL_PANEL_LOCALE_NAMESPACE>
  & InjectFace<DesktopTerminalLauncherInjected>

function TerminalPanelIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="m4.8 6.3 2 1.9-2 1.9M8.4 10.1h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Sidebar footer action that toggles the bottom terminal panel. */
export function DesktopTerminalLauncher({ wide, t, usePanel, togglePanel }: DesktopTerminalLauncherProps) {
  const open = usePanel(value => value.open)
  return (
    <Tooltip label={t('launcher')} delayMs={500} disabled={wide}>
      <Button
        variant="ghost"
        id="dsh-desktop-terminal-launcher"
        className="dshDesktopTerminalLauncher"
        data-wide={wide}
        aria-label={t('launcher')}
        aria-controls="dsh-desktop-terminal-panel"
        aria-expanded={open}
        icon={<TerminalPanelIcon size={wide ? 16 : 18} />}
        onClick={() => togglePanel()}
      >
        {wide ? t('launcher') : null}
      </Button>
    </Tooltip>
  )
}
