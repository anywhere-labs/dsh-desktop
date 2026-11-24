/**
 * Register the session tab strip on the official conversation header.
 *
 * The seat is a `single` slot, so a plugin that renders its own strip there would clash at the same priority: this
 * entry registers one step lower, which shadows it instead of throwing, and keeps a single strip on screen.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionTabs } from './session-tabs-strip.tsx'

/** One step below the default, so an existing occupant is shadowed rather than duplicated. */
const PRIORITY = -1

/**
 * Register the strip while the client is mounted.
 * @param ctx - the client context.
 */
export function registerSessionTabs(ctx: Context): void {
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    locale: 'desktop-next',
    priority: PRIORITY,
    inject: () => ({ context: ctx }),
  }, SessionTabs))
}
