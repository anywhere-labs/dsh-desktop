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

export function apply(ctx: Context, config: Config): void {
  const log = fromCordis(ctx.logger)
  const bridge = new AcpBridge(ctx, { home: config.home || defaultHome() }, log)
  ctx.effect(() => {
    const started = bridge.start().catch(error => log.error('acp-bridge: ACP endpoint failed to start', error))
    return async () => {
      await started
      await bridge.close()
    }
  }, 'agents-anywhere-acp-bridge')
}
