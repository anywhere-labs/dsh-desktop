/** The official Plugins panel's last listing, which Desktop's plugin controls render from before their own reads answer. */
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Read the bundles the official plugin manager store last listed. Its rows join each bundle row with the live plugin entry,
 * whose fiber phase they carry as `phase`.
 * @param context - the client context.
 * @returns the listed bundles, or undefined while the store is unavailable or has not listed yet.
 */
export function readOfficialBundles(context: Context): BundleInfo[] | undefined {
  try {
    const get = (context as { get?: (key: string) => unknown }).get
    if (typeof get !== 'function') return undefined
    const slots = get.call(context, 'slots') as {
      readonly _core?: {
        readonly entries?: (key: string) => readonly {
          readonly options?: { readonly id?: string; readonly key?: string }
          readonly inject?: () => {
            readonly hooks?: {
              readonly pluginManager?: {
                readonly getSnapshot?: () => {
                  readonly status?: string
                  readonly packages?: readonly BundleInfo[]
                }
              }
            }
          }
        }[]
      }
    } | undefined
    const mainEntries = slots?._core?.entries?.('main')
    const overlayEntries = slots?._core?.entries?.('shell.overlay')
    const entry = mainEntries?.find(item => item.options?.key === 'plugins')
      ?? overlayEntries?.find(item => item.options?.id === 'plugin-manager.refresh-toast')
    const snapshot = entry?.inject?.()?.hooks?.pluginManager?.getSnapshot?.()
    if ((snapshot?.status === 'ready' || snapshot?.status === 'error') && Array.isArray(snapshot.packages)) {
      return [...snapshot.packages]
    }
  } catch {
    // Fallback to direct RPC when the official plugin manager store is unavailable.
  }
  return undefined
}
