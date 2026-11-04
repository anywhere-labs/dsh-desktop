/**
 * The navigation icon of the Desktop settings section, through the `settings.section.icon` slot the settings shell of
 * dsh 0.2.2 renders for a matching section id. src/client/index.ts consumes it as `registerDesktopSettingsIcon` from
 * src/client/upstream-family.ts.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** A display glyph sized by the settings shell, which owns the button, the label and the icon wrapper. */
function IconDesktopSettings({ size }: PropsRuntime<'settings.section.icon'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5 14h6M8 11.5V14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Show the Desktop display glyph instead of the settings gear in the navigation row of one settings section.
 * @param ctx - client context with the slots service.
 * @param id - id of the Desktop `settings.section` registration.
 */
export function registerDesktopSettingsIcon(ctx: Context, id: string): void {
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id }, IconDesktopSettings))
}
