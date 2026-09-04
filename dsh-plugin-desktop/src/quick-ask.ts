/** Host-owned Quick Ask: one native prompt creates one ordinary Session in this Host. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { DesktopQuickAskSubmission, DesktopQuickLaunchSpec } from './runtime.ts'
import { DEFAULT_MAIN_WINDOW_SHORTCUT, DEFAULT_QUICK_ASK_SHORTCUT } from './quick-ask-shortcut.ts'

export const name = 'desktop-quick-ask'
export const inject = ['desktopRuntime', 'sessionController', 'workspaceRegistry', 'settings']
export const DESKTOP_QUICK_ASK_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-quick-ask')
export interface DesktopQuickAskSettings {
  readonly quickAskShortcut: string
  readonly mainWindowShortcut: string
  readonly workspaceId: string
}

const DesktopShortcutSchema = z.string().pattern(/^(?=.{1,80}$)(?:(?:CommandOrControl|Command|Control|Alt|Option|AltGr|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen)$/u)

export const DesktopQuickAskSettingsSchema: z<DesktopQuickAskSettings> = z.object({
  quickAskShortcut: DesktopShortcutSchema.default(DEFAULT_QUICK_ASK_SHORTCUT),
  mainWindowShortcut: DesktopShortcutSchema.default(DEFAULT_MAIN_WINDOW_SHORTCUT),
  workspaceId: z.string().default(''),
})

function quickAskTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/gu, ' ').trim()
  return `Quick Ask · ${[...oneLine].slice(0, 56).join('')}`
}

function resolveWorkspace(ctx: Context, requested: string | undefined): { readonly workspaceId?: WorkspaceId } {
  if (!requested) return {}
  const workspace = ctx.workspaceRegistry.list().find(candidate => String(candidate.id) === requested)
  return workspace === undefined ? {} : { workspaceId: workspace.id }
}

export async function submitQuickAsk(ctx: Context, submission: DesktopQuickAskSubmission): Promise<{ readonly sessionId: string }> {
  const prompt = submission.prompt.trim()
  if (!prompt) throw new Error('dsh-plugin-desktop: Quick Ask prompt is empty')
  if (Buffer.byteLength(prompt, 'utf8') > 64 * 1024) throw new Error('dsh-plugin-desktop: Quick Ask prompt is too large')
  const created = await ctx.sessionController.create(resolveWorkspace(ctx, submission.workspaceId))
  try {
    await ctx.sessionController.rename({ sessionId: created.sessionId, title: quickAskTitle(prompt) })
  } catch (cause) {
    ctx.logger.warn(`dsh-plugin-desktop: failed to name Quick Ask Session: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  await ctx.sessionController.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId: created.sessionId as SessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  }, new AbortController().signal)
  return { sessionId: String(created.sessionId) }
}

/** Register live settings, native shortcuts, and the one-shot Session bridge. */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(
    DESKTOP_QUICK_ASK_SETTINGS_NAMESPACE,
    DesktopQuickAskSettingsSchema,
    { applies: 'live' },
  )
  let value = settings.get()
  const spec = (): DesktopQuickLaunchSpec => ({
    quickAskShortcut: value.quickAskShortcut,
    mainWindowShortcut: value.mainWindowShortcut,
    locale: () => ctx.desktopRuntime.locale,
    workspaces: () => ctx.workspaceRegistry.list().map(workspace => ({ id: String(workspace.id), title: workspace.title })),
    submit: submission => submitQuickAsk(ctx, submission),
    showMain: () => { ctx.desktopRuntime.show() },
  })
  const registration = ctx.desktopRuntime.registerQuickLaunch(spec())
  ctx.effect(() => {
    const stop = settings.watch((next, previous) => {
      const result = registration.update({
        quickAskShortcut: next.quickAskShortcut,
        mainWindowShortcut: next.mainWindowShortcut,
      })
      if (!result.ok) {
        ctx.logger.error(`dsh-plugin-desktop: ${result.action} shortcut ${result.reason}; keeping previous shortcuts`)
        void settings.replace(previous).catch(cause => {
          ctx.logger.error(`dsh-plugin-desktop: failed to restore Quick Ask settings: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
        return
      }
      value = next
      registration.refresh(spec())
    })
    return () => {
      stop()
      registration.dispose()
    }
  }, 'dsh-plugin-desktop: native Quick Ask and global shortcuts')
}
