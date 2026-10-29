/**
 * Test fixtures for upstream APIs that differ between the DSH releases Next and Beta follow.
 * Like src/upstream-family.ts, this file is a declared difference between the variants while
 * Beta tracks a newer upstream prerelease than Next.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

/**
 * Run one parsed invocation through the tool runtime.
 * @param ctx - context owning the tool definitions and execution policy.
 * @param input - parsed invocation.
 * @returns the settled capability result.
 */
export function executeToolFixture(ctx: Context, input: ToolExecutionInput): Promise<ToolExecutionResult> {
  return ctx.tools.execute(input)
}

/**
 * Load what a test Context needs before its registered tools can execute.
 * @param _ctx - test root that already provides the tool runtime, which executes calls itself.
 */
export async function installToolExecution(_ctx: Context): Promise<void> {}
