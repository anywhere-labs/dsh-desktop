/** Resolve the packaged computer-use driver's platform package from its unpacked copy, whose library the system loader can open. */
import { registerHooks, type ModuleHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/** Scope and name prefix of the driver's platform packages, one per OS and CPU. */
export const CUA_DRIVER_PLATFORM_PACKAGES = '@trycua/cua-driver-'

/** A file inside one of the driver's platform packages. */
const PLATFORM_PACKAGE_FILE = /\/node_modules\/@trycua\/cua-driver-(?:darwin|win32|linux)-[^/]+\//u

/**
 * Keep the native computer-use driver loadable from the archive.
 *
 * `@trycua/cua-driver` locates its Rust library by resolving the manifest of the platform package
 * for this OS and CPU with `require.resolve`, joins the library file name onto that directory and
 * hands the path to its Node addon, which opens it with the system loader (`dlopen`, `LoadLibrary`).
 * Only Electron's own `fs` and `dlopen` read the archive, so a path inside `app.asar` fails there
 * with ENOTDIR although packaging unpacks the whole platform package beside the archive. This hook
 * answers every request for a file of a platform package with its unpacked copy, so the manifest
 * directory, the library and the addon are physical. The driver's JavaScript package and everything
 * else keep resolving inside the archive. Hooks apply only to this thread.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installCuaDriverResolution(runtimeDir: string): ModuleHooks | undefined {
  const archivePath = runtimeArchivePath(runtimeDir)
  if (archivePath === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = realpathSync(archivePath)
  const packages = ['node_modules', ...CUA_DRIVER_PLATFORM_PACKAGES.split('/')]
  const source = pathToFileURL(join(root, ...packages)).href
  const destination = pathToFileURL(join(`${archive}.unpacked`, relative(archive, root), ...packages)).href
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:') || !PLATFORM_PACKAGE_FILE.test(new URL(resolved.url).pathname)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop computer-use driver resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      return { ...resolved, url: pathToFileURL(realpathSync(fileURLToPath(destination + canonical.slice(source.length)))).href }
    },
  })
}
