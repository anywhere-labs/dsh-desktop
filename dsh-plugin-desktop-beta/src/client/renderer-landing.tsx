/** Say why the main window opened a new conversation instead of the one that kept crashing it (#1690). */
import { createElement, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { RendererLanding } from '../renderer-landing.ts'

/** Long enough to read a sentence that names the conversation; then it fades like any other notice. */
const HOLD_MS = 12_000

/**
 * The client Session Controller's list. This package also compiles the Host, whose `dsh-session` declares a
 * different `sessions` service on the same Context, so the client shape is named here.
 */
interface ClientSessionList {
  readonly list: {
    subscribe(listener: () => void): () => void
    getSnapshot(): { readonly byId: Readonly<Record<string, { readonly title?: string } | undefined>> }
  }
}

/**
 * Show the notice once in the document that started without the held-back Session. Opening it again is
 * the user's call; if it fails once more, the next document lands elsewhere again.
 * @param ctx - the Next client plugin context.
 * @param landing - what the preload removed before the official client restored its selection.
 */
export function registerRendererLanding(ctx: Context, landing: RendererLanding): void {
  ctx.inject(['uiWorkspace', 'sessions'], inner => {
    inner.slots.inject('shell.overlay', () => inner.slots.register({
      name: 'shell.overlay', id: 'desktop-next-renderer-landing', order: 80, locale: 'desktop-next',
      inject: () => ({ context: inner, landing }),
    }, RendererLandingNotice))
  })
}

function RendererLandingNotice({ t, context, landing }: PropsLocale<'desktop-next'> & { context: Context; landing: RendererLanding }) {
  const [open, setOpen] = useState(true)
  const sessionId = landing.sessionId as SessionId
  const { list } = context.sessions as unknown as ClientSessionList
  // The list arrives after the shell mounts; the sentence names the conversation once it does.
  const title = useSyncExternalStore(
    listener => list.subscribe(listener),
    () => list.getSnapshot().byId[sessionId]?.title?.trim() ?? '',
  )
  if (!open) return null
  const zh = t('language') === 'zh'
  const count = String(landing.failures)
  const text = zh
    ? `${title ? `会话「${title}」` : '上次的会话'}已导致界面崩溃 ${count} 次，已改为打开新会话`
    : `${title ? `“${title}”` : 'The last conversation'} crashed the window ${count} times, so a new conversation opened instead`
  return createElement(Toast, {
    text, holdMs: HOLD_MS, icon: createElement(IconWarningOutlineRegular, { size: 18 }),
    actions: [{ prefix: zh ? '，也可' : '. ', label: zh ? '重新打开该会话' : 'Open it again', onClick: () => {
      setOpen(false)
      context.uiWorkspace.openSession(sessionId)
    } }],
    onDone: () => { setOpen(false) },
  })
}
