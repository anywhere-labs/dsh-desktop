/** The bundled Office payload the Web profile's Office rows use: where it lives and where the Host installs it. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { insideArchive } from '../asar-archive-policy.ts'

/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled payload directory; the sibling `office-skills` directory holds the skill resources. Missing resources fail Host startup. */
  readonly source: string
  /** Directory under the Next home receiving the installed payload. */
  readonly root: string
}

/**
 * Installation name under `<home>/dsh-runtimes`. Next shares `~/.dsh` with the official Desktop, and the
 * tool replaces an installation whose manifest differs, so each edition keeps its own directory.
 */
export const PRIMARY_RUNTIME_INSTALL_NAME = 'dsh-next-primary-runtime'

/**
 * Resolve the Office composition for one Host start.
 * @param runtimeDir - Application directory; the archive itself when packaged.
 * @param source - Bundled payload directory the shell selected for this CPU.
 * @param home - Next home receiving the installation.
 * @returns The configuration, or undefined for a development tree whose payload was not prepared.
 * @throws For a packaged Host started without a payload path.
 */
export function resolveOfficeConfig(runtimeDir: string, source: string | undefined, home: string): Config | undefined {
  const packaged = insideArchive(runtimeDir)
  if (source === undefined) {
    if (packaged) throw new Error('Next Host requires the bundled primary runtime path')
    return undefined
  }
  if (!packaged && !existsSync(join(source, 'runtime.json'))) return undefined
  return { source, root: join(home, 'dsh-runtimes', PRIMARY_RUNTIME_INSTALL_NAME) }
}
