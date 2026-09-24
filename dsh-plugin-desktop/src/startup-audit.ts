/** Republish the Loader's startup activation report to the Host log. */
import type { Context } from '@deepseek-ai/cordis'
import { auditStartupEntries } from '@deepseek-ai/dsh-app-boot'

/**
 * Record every startup entry that did not activate.
 *
 * `boot()` already audits the settled tree, but its default sink is
 * `process.stderr`, which a packaged Electron Host discards. An optional entry
 * that never activated -- a failed import, or one still waiting on a service
 * nothing provides -- therefore leaves no trace in the Host log, the exported
 * diagnostics, or anything a bug report can carry. Re-running the audit costs
 * one synchronous pass over the Loader's entries and routes the identical
 * diagnostic through the logger the file exporter persists.
 *
 * Required-entry failures cannot reach here: `boot()` rejects on them before it
 * returns. The catch covers the case where that ever stops being true, because
 * a diagnostic must never be the thing that stops the app from starting.
 *
 * @param ctx - the settled boot context.
 * @param binName - the diagnostic prefix, matching the one `boot()` was given.
 */
export async function logInactiveStartupEntries(ctx: Context, binName: string): Promise<void> {
  try {
    await auditStartupEntries(ctx, binName, line => { ctx.logger.warn('%s', line.trimEnd()) })
  } catch (cause) {
    ctx.logger.warn(
      '%s',
      `${binName}: startup activation report failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}
