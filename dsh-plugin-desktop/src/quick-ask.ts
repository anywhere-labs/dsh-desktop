/** Host-owned Quick Ask: one native prompt creates one ordinary Session in this Host. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { DesktopQuickAskHistoryMessage, DesktopQuickAskModel, DesktopQuickAskSubmission, DesktopQuickAskUpdate, DesktopQuickLaunchSpec } from './runtime.ts'
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
  const sessionId = submission.sessionId as SessionId | undefined
    ?? (await ctx.sessionController.create(resolveWorkspace(ctx, submission.workspaceId))).sessionId
  if (submission.sessionId === undefined) {
    try {
      await ctx.sessionController.rename({ sessionId, title: quickAskTitle(prompt) })
    } catch (cause) {
      ctx.logger.warn(`dsh-plugin-desktop: failed to name Quick Ask Session: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  if (submission.model?.provider && submission.model?.model) {
    try {
      await selectQuickAskModel(ctx, String(sessionId), submission.model)
    } catch (cause) {
      ctx.logger.warn(`dsh-plugin-desktop: failed to select model for Quick Ask Session: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  await ctx.sessionController.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  }, new AbortController().signal)
  return { sessionId: String(sessionId) }
}

interface QuickAskSession {
  readonly header: { readonly id: SessionId }
  snapshotEvents(): readonly unknown[]
}

function quickAskSessions(ctx: Context): readonly { readonly id: string, readonly title: string }[] {
  const sessions = ctx.get('sessions') as unknown as { list(): QuickAskSession[] } | undefined
  return sessions?.list().map(session => ({ id: String(session.header.id), title: quickAskHistory(session)[0]?.text.slice(0, 64) || String(session.header.id) })) ?? []
}

export function quickAskHistory(session: { snapshotEvents(): readonly unknown[] }): readonly DesktopQuickAskHistoryMessage[] {
  return session.snapshotEvents().map(event => {
    const candidate = event as { readonly type?: string, readonly data?: { readonly role?: string, readonly content?: readonly { readonly type: string, readonly text?: string }[] } }
    if (candidate.type !== 'user/message' && candidate.type !== 'assistant/message') return undefined
    const text = assistantText(candidate.data?.content ?? [])
    if (!text) return undefined
    return { role: candidate.type === 'user/message' ? 'user' as const : 'assistant' as const, text }
  }).filter((message): message is DesktopQuickAskHistoryMessage => message !== undefined)
}

function assistantText(content: readonly { readonly type: string, readonly text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

export function sessionActiveModel(session: { snapshotEvents(): readonly unknown[] }): { provider: string, model: string } | undefined {
  const events = session.snapshotEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const candidate = events[i] as { readonly type?: string, readonly data?: Record<string, unknown> }
    if (candidate.type === 'model/selection' && candidate.data?.provider && candidate.data?.model) {
      return { provider: String(candidate.data.provider), model: String(candidate.data.model) }
    }
    const header = candidate.data?.header as { readonly config?: { readonly provider?: unknown, readonly model?: unknown } } | undefined
    if (candidate.type === 'request/header' && header?.config?.provider && header?.config?.model) {
      return { provider: String(header.config.provider), model: String(header.config.model) }
    }
  }
  return undefined
}

export async function selectQuickAskModel(ctx: Context, sessionId: string, model: { provider: string, model: string }): Promise<void> {
  const sessionController = ctx.get('sessionController') as unknown as { selectModel?(request: { sessionId: SessionId, provider: string, model: string }): Promise<unknown> } | undefined
  if (typeof sessionController?.selectModel === 'function') {
    await sessionController.selectModel({
      sessionId: sessionId as SessionId,
      provider: model.provider,
      model: model.model,
    })
  }
}

let cachedModels: readonly DesktopQuickAskModel[] = []

async function refreshModels(ctx: Context): Promise<void> {
  try {
    const sessionController = ctx.get('sessionController') as unknown as { modelCatalog?(): Promise<{ readonly default: { readonly provider: string, readonly model: string }, readonly groups: readonly { readonly id: string, readonly name: string, readonly models: readonly { readonly id: string, readonly name: string }[] }[] }> } | undefined
    if (typeof sessionController?.modelCatalog !== 'function') return
    const catalog = await sessionController.modelCatalog()
    const result: DesktopQuickAskModel[] = []
    const defaultKey = catalog.default ? `${catalog.default.provider}:${catalog.default.model}` : ''
    for (const group of catalog.groups) {
      for (const model of group.models) {
        result.push({
          provider: group.id,
          model: model.id,
          name: model.name || model.id,
          group: group.name || group.id,
          isDefault: `${group.id}:${model.id}` === defaultKey,
        })
      }
    }
    cachedModels = result
  } catch (cause) {
    ctx.logger.warn(`dsh-plugin-desktop: failed to load model catalog: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Register live settings, native shortcuts, and the one-shot Session bridge. */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(
    DESKTOP_QUICK_ASK_SETTINGS_NAMESPACE,
    DesktopQuickAskSettingsSchema,
    { applies: 'live' },
  )
  let value = settings.get()
  void refreshModels(ctx)
  const host = ctx as unknown as { on(event: string, listener: () => void): void }
  host.on('llm/adapters-updated', () => { void refreshModels(ctx) })
  const listeners = new Set<(update: DesktopQuickAskUpdate) => void>()
  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.header.id)
    let update: DesktopQuickAskUpdate | undefined
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      update = { sessionId, type: 'assistant-delta', turn: event.data.turn, text: event.data.chunk.text }
    } else if (event.type === 'assistant/message') {
      update = { sessionId, type: 'assistant-message', turn: event.data.turn, text: assistantText(event.data.message.content) }
    } else if (event.type === 'turn/end') {
      const reason = event.data.reason.kind
      update = { sessionId, type: 'turn-end', turn: event.data.turn, failed: reason === 'error' || reason === 'max-tokens' }
    }
    if (update !== undefined) for (const listener of listeners) listener(update)
  })
  const spec = (): DesktopQuickLaunchSpec => ({
    quickAskShortcut: value.quickAskShortcut,
    mainWindowShortcut: value.mainWindowShortcut,
    locale: () => ctx.desktopRuntime.locale,
    workspaces: () => ctx.workspaceRegistry.list().map(workspace => ({ id: String(workspace.id), title: workspace.title })),
    sessions: () => quickAskSessions(ctx),
    models: () => cachedModels,
    sessionModel: sessionId => {
      const sessions = ctx.get('sessions') as unknown as { get(id: SessionId): QuickAskSession | undefined } | undefined
      const session = sessions?.get(sessionId as SessionId)
      return session === undefined ? undefined : sessionActiveModel(session)
    },
    selectModel: (sessionId, model) => selectQuickAskModel(ctx, sessionId, model),
    history: sessionId => {
      const sessions = ctx.get('sessions') as unknown as { get(id: SessionId): QuickAskSession | undefined } | undefined
      const session = sessions?.get(sessionId as SessionId)
      return session === undefined ? [] : quickAskHistory(session)
    },
    submit: submission => submitQuickAsk(ctx, submission),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
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
