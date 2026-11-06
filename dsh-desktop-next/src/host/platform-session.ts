/**
 * Keep the shell's embedded Platform page signed in with the Host's DeepSeek account.
 *
 * The official account plugin opens its usage and top-up pages through the native
 * `dshPlatform` bridge, and the shell signs those pages in with the account grant this
 * module publishes (upstream apps/desktop-host/src/platform-session.ts). Credentials cross
 * only the private Host IPC channel; no renderer receives them from here.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PlatformSession } from '@deepseek-ai/dsh-deepseek-account'
import { hostLog } from './logging.ts'

/**
 * Publish the grant of each account provider lifetime, clearing it on removal or stream termination.
 * @param ctx - Host context owning the account dependency subscription.
 * @param publish - delivers one session, or null once none is valid, to the Electron shell.
 */
export function installPlatformSessionPublisher(ctx: Context, publish: (session: PlatformSession | null) => void): void {
  ctx.inject(['deepseekAccount'], (accountCtx) => {
    const account = accountCtx.deepseekAccount
    accountCtx.effect(() => {
      const lifetime = new AbortController()
      const updates = (async () => {
        try {
          // Identity changes re-read the grant too: the shell keys the page's storage by account ID.
          for await (const _state of account.watch(lifetime.signal, true)) {
            if (lifetime.signal.aborted) break
            const session = await account.getPlatformSession()
            // Disposal can abort during the credential read.
            if (!lifetime.signal.aborted) publish(session)
          }
        } catch (error) {
          if (!lifetime.signal.aborted) hostLog({ source: 'host.account', event: 'platform-session.failed', level: 'warn', error })
        } finally {
          if (!lifetime.signal.aborted) publish(null)
        }
      })()
      return async () => {
        lifetime.abort()
        publish(null)
        await updates
      }
    })
  })
}
