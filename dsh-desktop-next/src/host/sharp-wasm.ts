/** Keep Linux `sharp` off its native backends, whose bundled GLib collides with the one Electron links, so it runs its WebAssembly build. */
import { createRequire, registerHooks, type ModuleHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The WebAssembly build of `sharp` that Linux packages carry instead of the native backends. */
export const SHARP_WASM_PACKAGE = '@img/sharp-wasm32'

/** A native Linux `sharp` or `libvips` package, as `sharp` requests it. */
const SHARP_LINUX_NATIVE = /^@img\/sharp-(?:libvips-)?linux(?:musl)?-[^/]+(?:\/|$)/u

/**
 * Run Linux `sharp` on WebAssembly.
 *
 * Electron's Linux executable links the system GLib, so its `g_object_*` symbols come first in every
 * process it starts, the Node-mode Host included. `@img/sharp-libvips-linux-*` carries its own static
 * GLib, and the native addon's `g_object_unref` binds to Electron's copy for objects its own copy
 * created: image work fails GObject type checks and eventually crashes the Host with SIGSEGV, the
 * conflict sharp's `SharpElectronLinux` warning names. Refusing the native packages makes `sharp` fall
 * back to `@img/sharp-wasm32`, which Electron serves from the archive like any other package, the
 * worker threads it starts included. Packaging omits the native Linux packages too, so only a
 * Profile's own `sharp` meets the refusal; when that `sharp` brings no WebAssembly build, it gets the
 * runtime's copy only from the same release, because another release's binding does not match its
 * JavaScript. Hooks apply only to this thread.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @param platform - Platform the Host runs on.
 * @returns Installed resolver for the Host lifetime, or undefined off Linux.
 */
export function installSharpWasmResolution(runtimeDir: string, platform: NodeJS.Platform = process.platform): ModuleHooks | undefined {
  if (platform !== 'linux') return undefined
  const runtimeRequire = createRequire(join(runtimeDir, 'package.json'))
  let bundled: string | null | undefined
  const bundledVersion = (): string | null => {
    if (bundled === undefined) {
      try {
        bundled = (JSON.parse(readFileSync(runtimeRequire.resolve(`${SHARP_WASM_PACKAGE}/package`), 'utf8')) as { version?: string }).version ?? null
      } catch { bundled = null }
    }
    return bundled
  }
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (SHARP_LINUX_NATIVE.test(specifier)) throw missingModule(specifier)
      if (specifier !== SHARP_WASM_PACKAGE && !specifier.startsWith(`${SHARP_WASM_PACKAGE}/`)) return nextResolve(specifier, context)
      try {
        return nextResolve(specifier, context)
      } catch (cause) {
        if (!isMissingModule(cause)) throw cause
        const requester = owningPackage(context.parentURL)
        if (requester?.name !== 'sharp' || requester.version !== bundledVersion()) throw cause
        return { url: pathToFileURL(runtimeRequire.resolve(specifier)).href, shortCircuit: true }
      }
    },
  })
}

function isMissingModule(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

function missingModule(specifier: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Cannot find module '${specifier}'`), { code: 'MODULE_NOT_FOUND' })
}

/**
 * The package that owns a requesting module: the nearest manifest above it that names a package.
 * @param url - URL of the requesting module.
 * @returns Its name and version, or undefined for a request from no file.
 */
function owningPackage(url: string | undefined): { name?: string; version?: string } | undefined {
  if (url?.startsWith('file:') !== true) return undefined
  for (let directory = dirname(fileURLToPath(url)); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) continue
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown; version?: unknown }
    if (typeof parsed.name === 'string') return { name: parsed.name, ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}) }
  }
  return undefined
}
