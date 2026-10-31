/**
 * Bounded Host failure details sent to the shell with `fatal`. Follows upstream Desktop's
 * `apps/desktop-host/src/fatal-diagnostic.ts` (added in dsh 0.2.2): a StartupError keeps its
 * configuration path and startup entries in non-enumerable fields that `util.inspect` omits, so
 * they are rendered here explicitly, followed by the startup composition where the DSH release
 * this Desktop follows records one.
 */

import { inspect } from 'node:util'
import { StartupError } from '@deepseek-ai/dsh-app-boot'
import { startupCompositionDiagnostic } from '../upstream-family.ts'

/** Maximum characters carried by one fatal diagnostic, including its truncation notice. */
export const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

/** Original-error budget when startup metadata needs space in the same report. */
const MAX_ORIGINAL_ERROR_CHARS = 8 * 1024

/** Startup entry details leave room for the sections that follow them. */
const MAX_STARTUP_ENTRY_CHARS = 8 * 1024

/**
 * Render the original error and explicitly selected startup metadata.
 * Selected metadata excludes configuration values and arbitrary startup logger arguments.
 * @param error - Failure received by the Host entry point.
 * @param composition - Renders the composition a StartupError recorded; absent where the DSH release records none.
 * @returns Bounded text with an explicit notice when the report is shortened.
 */
export function formatFatalDiagnostic(
  error: unknown, composition: ((error: StartupError) => readonly string[]) | undefined = startupCompositionDiagnostic,
): string {
  const original = inspect(error, { depth: 4, maxArrayLength: 50 })
  const sections: string[] = []
  const seen = new Set<Error>()
  function visit(value: unknown): void {
    if (!(value instanceof Error) || seen.has(value)) return
    seen.add(value)
    if (value instanceof StartupError) {
      if (value.startup !== undefined) {
        sections.push(`Configuration file: ${value.startup.configurationPath}`)
      }
      const entries = inspect(value.entries, { depth: 6, maxArrayLength: null, maxStringLength: 4096 })
      sections.push('--- startup entries ---', entries.length <= MAX_STARTUP_ENTRY_CHARS ? entries
        : `${entries.slice(0, MAX_STARTUP_ENTRY_CHARS).replace(/[\uD800-\uDBFF]$/u, '')}\n… (startup entries truncated at ${String(MAX_STARTUP_ENTRY_CHARS)} characters)`)
      if (composition !== undefined) sections.push(...composition(value))
    }
    visit(value.cause)
    if (value instanceof AggregateError) value.errors.forEach(visit)
  }
  visit(error)
  sections.unshift(sections.length === 0 || original.length <= MAX_ORIGINAL_ERROR_CHARS ? original
    : `${original.slice(0, MAX_ORIGINAL_ERROR_CHARS).replace(/[\uD800-\uDBFF]$/u, '')}\n… (original error truncated at ${String(MAX_ORIGINAL_ERROR_CHARS)} characters)`)
  const text = sections.join('\n')
  if (text.length <= MAX_FATAL_DIAGNOSTIC_CHARS) return text
  const notice = `\n… (Host diagnostic truncated at ${String(MAX_FATAL_DIAGNOSTIC_CHARS)} characters)`
  return text.slice(0, MAX_FATAL_DIAGNOSTIC_CHARS - notice.length).replace(/[\uD800-\uDBFF]$/u, '') + notice
}
