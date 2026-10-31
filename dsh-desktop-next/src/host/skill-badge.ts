/** Resolve the bundled badge skill package from its unpacked copy, so the directory it announces to the model holds a PNG that shells and the Host's filesystem service can read. */
import type { ModuleHooks } from 'node:module'
import { installUnpackedPackageResolution } from './unpacked-package.ts'

/** The package whose `assets/` directory the `dsh-badge` skill announces as its resource base. */
export const SKILL_BADGE_PACKAGE = '@deepseek-ai/dsh-skill-badge'

/**
 * Keep the badge skill's PNG where the skill says it is.
 *
 * `@deepseek-ai/dsh-skill-badge` derives its resource base from `import.meta.url`, reads the skill body
 * beside it, and that body tells the model to upload `dsh-badge.png` from the announced directory where
 * a Shields.io image cannot be imported. Only Electron's own `fs` reads the archive: a shell `cp` of a
 * path inside `app.asar` fails with ENOTDIR, and the Host's filesystem service stats with `bigint`,
 * which Electron's archive view answers with plain-number stats, so the `read` tools fail as well.
 * Packaging keeps the whole package unpacked beside the archive, and the package runs from that copy.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installSkillBadgeResolution(runtimeDir: string): ModuleHooks | undefined {
  return installUnpackedPackageResolution(runtimeDir, SKILL_BADGE_PACKAGE, 'badge skill')
}
