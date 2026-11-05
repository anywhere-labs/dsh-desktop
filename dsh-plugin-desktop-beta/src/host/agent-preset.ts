/** Resolve the packaged agent preset manifest from its unpacked copy, where the Host's filesystem service can read its skills. */
import { registerHooks, type ModuleHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/** The package whose `skills/` directory the Creator preset mounts. */
export const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'

/**
 * Keep the Creator preset's skill directory readable by the Host's filesystem service.
 *
 * The upstream Creator preset mounts `skills/` of the agent preset package as a custom
 * `skill-filesystem` root, locating the package with `require.resolve` of its manifest from the
 * web-app bundle. Custom roots are listed and read through the Host's filesystem service, which
 * stats with `bigint`; Electron's archive view answers for archived entries with plain-number
 * stats, so a root inside `app.asar` fails to list and the preset shows no skills. Packaging keeps
 * the whole package unpacked beside the archive, and this hook answers the manifest request with
 * that copy, so the preset derives a physical directory. Every other request, including the
 * package's own entry, keeps resolving inside the archive. Hooks apply only to this thread.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installAgentPresetResolution(runtimeDir: string): ModuleHooks | undefined {
  const archivePath = runtimeArchivePath(runtimeDir)
  if (archivePath === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = realpathSync(archivePath)
  const manifest = ['node_modules', ...AGENT_PRESET_PACKAGE.split('/'), 'package.json']
  const source = pathToFileURL(join(root, ...manifest)).href
  const destination = join(`${archive}.unpacked`, relative(archive, root), ...manifest)
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:') || !/\/node_modules\/@deepseek-ai\/dsh-agent-preset\/package\.json$/u.test(new URL(resolved.url).pathname)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (canonical !== source) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop agent preset resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      return { ...resolved, url: pathToFileURL(realpathSync(destination)).href }
    },
  })
}
