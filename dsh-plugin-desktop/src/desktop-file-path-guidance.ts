import { isAbsolute } from 'node:path'
import type {} from '@deepseek-ai/dsh-agent'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { WorkspaceSourceRoots } from './workspace-source-roots.ts'

const GUIDANCE = [
  'When reporting files to the user (including final answers, changed-file lists, and links), use the verified absolute filesystem path for each file, not a relative path or basename alone.',
  'If files belong to multiple working directories, group them under their actual directory roots before listing them. Put the Session working directory first; sort other directory groups by absolute root path, then sort absolute file paths within each group.',
  'An independent Git worktree is its own working directory when its root is verified. A relative path such as .worktrees/... is not enough to establish the file location: resolve it against its actual root first.',
  'Attached source folders are separate roots. The Files browser selection does not change the Session working directory or the ownership of a file. Never prepend the selected browser root to an unrelated Session-relative path.',
  'Check ambiguous paths and same-named files against the actual filesystem or tool result. Do not invent an absolute path when it cannot be established; say that the location is unverified instead.',
  'These are rules for your user-facing output, not instructions to rewrite user quotations, tool arguments, or stored review records. The listed roots are context, not additional filesystem permissions.',
].join('\n')

/** Render only this Session's Host-known roots; never use the Files browser selection as cwd. */
export function renderDesktopFilePathGuidance(cwd?: string, attachedRoots?: readonly string[]): string {
  if (cwd === undefined || !isAbsolute(cwd)) return GUIDANCE
  return [
    GUIDANCE,
    `Session working directory: ${JSON.stringify(cwd)}`,
    `Attached source directory roots: ${JSON.stringify([...(attachedRoots ?? [])].sort())}`,
  ].join('\n')
}

/** Evaluated on every prompt assembly so new Sessions and attached-root changes do not leak stale roots. */
export function desktopFilePathPromptSection(
  order: number,
  sourceRoots: Pick<WorkspaceSourceRoots, 'attachedRoots'>,
): PromptSection {
  return {
    name: 'desktop:file-path-output',
    order,
    interpolate: false,
    text: ({ agent }) => {
      const cwd = agent?.session.header.cwd
      if (cwd === undefined || !isAbsolute(cwd)) return renderDesktopFilePathGuidance()
      try {
        return renderDesktopFilePathGuidance(cwd, sourceRoots.attachedRoots(cwd))
      } catch {
        // A missing workspace or invalid source store must not prevent prompt assembly.
        return renderDesktopFilePathGuidance(cwd) + '\nAttached source directory roots are unavailable; verify them before grouping files.'
      }
    },
  }
}
