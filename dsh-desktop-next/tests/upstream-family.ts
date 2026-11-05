/**
 * Test fixtures for upstream APIs that differ between the DSH releases Next and Beta follow.
 * Like src/upstream-family.ts, this file is a declared difference between the variants while
 * Beta tracks a newer upstream prerelease than Next.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'

export { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'

/**
 * Load what a test Context needs before its registered tools can execute.
 * @param ctx - test root that already provides the tool runtime.
 */
export async function installToolExecution(ctx: Context): Promise<void> {
  // dsh 0.2.2 dispatches every call through the selected executor plugin.
  await ctx.plugin(NativeToolExecutor)
}
