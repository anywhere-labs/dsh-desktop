/**
 * DSH plugin entry: serves ACP for this DeepSeek Harness on a local RPC
 * endpoint. ACP clients reach it through the bundled stdio launcher.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { AcpBridge } from './bridge.js'
import { fromCordis } from './acp/log.js'
import { defaultHome } from './paths.js'

export const name = 'agents-anywhere-acp-bridge'
/** Sessions are created, prompted and followed through DSH's own Session Controller. */
export const inject = ['sessionController', 'workspaceRegistry']

export interface Config {
  /** Where endpoint records and the launcher are written; defaults to `~/.agents-anywhere/dsh-acp`. */
  home?: string
}

export const Config: z<Config> = z.object({
  home: z.string().description('ACP 端点记录和启动脚本所在目录，留空使用 ~/.agents-anywhere/dsh-acp'),
})

/**
 * Whether the plugin unloads on its own while DSH runs on: disabled, removed, uninstalled or reloaded.
 * When DSH stops, a scope around the plugin unloads first: an enclosing fiber has lost its id, or (the root,
 * which restarts rather than going away) has left the state it is in while plugins run.
 * @param active - the root fiber's state while the plugin started; Cordis keeps its values in a const enum.
 */
function unloadedAlone(ctx: Context, active: Context['fiber']['state']): boolean {
  for (let fiber = ctx.fiber; ;) {
    const parent = fiber.parent.fiber
    if (parent === fiber) return true
    if (parent.uid === null || parent.state !== active) return false
    fiber = parent
  }
}

/**
 * The root Context. Cordis in dsh 0.2.3 keys it by the global `cordis.root` symbol; the 0.2.2 releases expose `ctx.root`.
 * @param ctx - the plugin's Context.
 * @returns the root Context of the running DSH.
 */
function rootOf(ctx: Context): Context {
  const root = Reflect.get(ctx, Symbol.for('cordis.root')) as Context | undefined
  return root ?? (ctx as Context & { readonly root: Context }).root
}

export function apply(ctx: Context, config: Config): void {
  const log = fromCordis(ctx.logger)
  const bridge = new AcpBridge(ctx, { home: config.home || defaultHome() }, log)
  const active = rootOf(ctx).fiber.state
  ctx.effect(() => {
    const started = bridge.start().catch(error => log.error('acp-bridge: ACP endpoint failed to start', error))
    return async () => {
      // Read before anything is awaited: the enclosing scopes are what tells the two apart.
      const alone = unloadedAlone(ctx, active)
      await started
      await bridge.close()
      // A DSH that stops keeps the launcher, to be started again by the next editor.
      if (alone) await bridge.withdrawLauncher().catch(error => log.warn('acp-bridge: could not withdraw the launcher', error))
    }
  }, 'agents-anywhere-acp-bridge')
}
