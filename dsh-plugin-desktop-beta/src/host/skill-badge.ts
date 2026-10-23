/** Resolve the bundled badge skill package from its unpacked copy, so the directory it announces to the model holds a PNG that shells and the Host's filesystem service can read. */
import { createRequire, isBuiltin, registerHooks, type ModuleHooks, type ResolveHookSync } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/** The package whose `assets/` directory the `dsh-badge` skill announces as its resource base. */
export const SKILL_BADGE_PACKAGE = '@deepseek-ai/dsh-skill-badge'

/** A file inside the badge skill package. */
const PACKAGE_FILE = /\/node_modules\/@deepseek-ai\/dsh-skill-badge\//u

/**
 * Keep the badge skill's PNG where the skill says it is.
 *
 * `@deepseek-ai/dsh-skill-badge` derives its resource base from `import.meta.url`, reads the skill body
 * beside it, and that body tells the model to upload `dsh-badge.png` from the announced directory where
 * a Shields.io image cannot be imported. Only Electron's own `fs` reads the archive: a shell `cp` of a
 * path inside `app.asar` fails with ENOTDIR, and the Host's filesystem service stats with `bigint`,
 * which Electron's archive view answers with plain-number stats, so the `read` tools fail as well.
 * Packaging keeps the whole package unpacked beside the archive, and this hook answers every request
 * for one of its files with that copy, so the module runs there and announces a physical directory.
 * Requests made from the unpacked copy resolve as if made from the archived one, so its bare imports
 * find the archive's packages (one shared skill registry) and its relative imports come back to the
 * copy; the ES module resolver takes that parent from the request, while the CommonJS resolver keeps
 * its parent module and so gets a request of its own from the archived file. Everything else keeps
 * resolving inside the archive. Hooks apply only to this thread.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installSkillBadgeResolution(runtimeDir: string): ModuleHooks | undefined {
  const archivePath = runtimeArchivePath(runtimeDir)
  if (archivePath === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = realpathSync(archivePath)
  const packageDir = ['node_modules', ...SKILL_BADGE_PACKAGE.split('/')]
  const source = `${pathToFileURL(join(root, ...packageDir)).href}/`
  const unpacked = join(`${archive}.unpacked`, relative(archive, root), ...packageDir)
  // Loaded modules carry canonical URLs, so the unpacked copy is compared in its canonical spelling once it exists.
  const destination = `${pathToFileURL(existsSync(unpacked) ? realpathSync(unpacked) : unpacked).href}/`
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL
      const resolved = parent !== undefined && parent.startsWith(destination) && !isBuiltin(specifier)
        ? resolveFromArchivedCopy(specifier, context, nextResolve, source + parent.slice(destination.length))
        : nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:') || !PACKAGE_FILE.test(new URL(resolved.url).pathname)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop badge skill resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      return { ...resolved, url: pathToFileURL(realpathSync(fileURLToPath(destination + canonical.slice(source.length)))).href }
    },
  })
}

/** A resolve hook's request and continuation. */
type Resolve = Parameters<ResolveHookSync>

/**
 * Resolve a request made from the unpacked copy as if its parent were the archived copy.
 * @param specifier - Requested module.
 * @param context - Request as received by the hook.
 * @param nextResolve - Continuation of the hook chain.
 * @param parentURL - The archived copy of the requesting file.
 * @returns The resolution, through the hook chain either way.
 */
function resolveFromArchivedCopy(specifier: string, context: Resolve[1], nextResolve: Resolve[2], parentURL: string): ReturnType<ResolveHookSync> {
  if (!context.conditions.includes('require')) return nextResolve(specifier, { ...context, parentURL })
  // That request runs the whole hook chain itself, so this result ends the current one.
  return { url: pathToFileURL(createRequire(fileURLToPath(parentURL)).resolve(specifier)).href, shortCircuit: true }
}
