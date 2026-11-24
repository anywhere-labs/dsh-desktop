/**
 * Register the session strip's two seats on the official shell.
 *
 * - The title-bar seat is a `shell.overlay` list entry; it draws only while the strip is placed in the caption row.
 * - The header seat occupies `conversation.header.leading`, a `single` slot. A plugin drawing its own strip there
 *   registers at the default priority, so this entry takes one step lower and shadows it instead of throwing. While
 *   `dsh-multi-session` runs, this entry is withdrawn entirely so the plugin's own header strip shows, and both seats
 *   and the runtime stand aside: only one strip is ever on screen.
 */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSessionTabs } from './session-tabs-controller.ts'
import { SessionTabsSeat, type SeatProps } from './session-tabs-strip.tsx'

/** One step below the default, so an existing occupant is shadowed rather than duplicated. */
const HEADER_PRIORITY = -1

type SlotRegister = (options: Record<string, unknown>, component: (props: never) => unknown) => () => void

/**
 * Create the strip's runtime and register both seats while the client is mounted.
 *
 * The runtime reads the Session Controller and the Workspace service, which the client plugin itself does not
 * inject: it runs inside a `ctx.inject` scope, so it starts once both are available and stops with them.
 * @param ctx - the client context.
 */
export function registerSessionTabs(ctx: Context): void {
  ctx.inject(['sessions', 'uiWorkspace'], inner => {
    const controller = createSessionTabs(inner)
    inner.effect(() => controller.install(), 'Session tabs: follow the window, keep tabs warm, share state across pages')
    registerSeats(inner, controller)
  })
}

/**
 * Register the title-bar and header seats for one runtime.
 * @param ctx - the scope the runtime lives in.
 * @param controller - the runtime both seats read.
 */
function registerSeats(ctx: Context, controller: ReturnType<typeof createSessionTabs>): void {
  const slots = ctx.slots as unknown as { inject(name: string, apply: () => () => void): void; register: SlotRegister }
  const seat = (where: SeatProps['seat']) => function SessionTabsSlot(props: Omit<SeatProps, 'controller' | 'seat'>) {
    return createElement(SessionTabsSeat, { ...props, controller, seat: where })
  }
  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay', id: 'desktop-next-session-tabs', order: 10, locale: 'desktop-next',
  }, seat('titlebar') as (props: never) => unknown))
  slots.inject('conversation.header.leading', () => {
    let dispose: (() => void) | undefined
    const sync = (): void => {
      if (controller.yielded.get()) {
        dispose?.()
        dispose = undefined
      } else {
        dispose ??= slots.register({
          name: 'conversation.header.leading', locale: 'desktop-next', priority: HEADER_PRIORITY,
        }, seat('header') as (props: never) => unknown)
      }
    }
    sync()
    const unsubscribe = controller.yielded.subscribe(sync)
    return () => {
      unsubscribe()
      dispose?.()
      dispose = undefined
    }
  })
}
