/** Run one archived package from its unpacked copy, for packages that hand their own files to other programs. */
import { createRequire, isBuiltin, registerHooks, type ModuleHooks, type ResolveHookSync } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/**
 * Answer every request for one of the package's files with its unpacked copy, so the module runs there and
 * the locations it derives from its own URL are physical files that shells, child processes and the Host's
 * filesystem service can open. Packaging must keep the whole package unpacked beside the archive.
 * Requests made from the unpacked copy resolve as if made from the archived one, so its bare imports find
 * the archive's packages (one shared instance each) and its relative imports come back to the copy; the ES
 * module resolver takes that parent from the request, while the CommonJS resolver keeps its parent module
 * and so gets a request of its own from the archived file. Everything else keeps resolving inside the
 * archive. Hooks apply only to this thread.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @param packageName - Package that must run from its unpacked copy.
 * @param label - What the package is, for the error on a copy resolved elsewhere inside the archive.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installUnpackedPackageResolution(runtimeDir: string, packageName: string, label: string): ModuleHooks | undefined {
  const archivePath = runtimeArchivePath(runtimeDir)
  if (archivePath === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = realpathSync(archivePath)
  const packageDir = ['node_modules', ...packageName.split('/')]
  const packageFile = `/node_modules/${packageName}/`
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
      if (!resolved.url.startsWith('file:') || !new URL(resolved.url).pathname.includes(packageFile)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop ${label} resolved outside the runtime package directory: ${resolved.url}`)
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
