/** Electron Builder's beforeBuild hook: the prepared payload is the only source of `node_modules`. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PAYLOAD_DIR } from './packaged-payload.ts'
import { DESKTOP_RUNTIME_FILE, readDesktopRuntime } from '../src/runtime-tree.ts'

interface BuildContext {
  appDir: string
  electronVersion?: string
  platform: { nodeName: string }
  arch: string
}

/**
 * Check that a payload prepared for this platform and Electron exists, then return false so that
 * electron-builder neither rebuilds nor collects `node_modules` itself: the payload file sets
 * already carry the dependency tree the prepare step materialized and sealed.
 * @param context - Electron Builder's beforeBuild context.
 * @returns False: dependencies are handled outside electron-builder.
 */
export default async function beforeBuild(context: BuildContext): Promise<boolean> {
  const file = join(context.appDir, ...PAYLOAD_DIR.split('/'), DESKTOP_RUNTIME_FILE)
  if (!existsSync(file)) throw new Error(`Next packaging: no prepared payload at ${PAYLOAD_DIR}; run scripts/prepare-payload.ts first`)
  const descriptor = readDesktopRuntime(file)
  if (descriptor.platform !== context.platform.nodeName) {
    throw new Error(`Next packaging: the prepared payload targets ${descriptor.platform}, not ${context.platform.nodeName}`)
  }
  if (typeof context.electronVersion === 'string' && descriptor.release.electronVersion !== context.electronVersion) {
    throw new Error(`Next packaging: the prepared payload declares Electron ${descriptor.release.electronVersion}, but ${context.electronVersion} is being packaged`)
  }
  console.log(`Packaging the prepared Next payload: ${String(descriptor.files.length)} files for ${descriptor.platform} ${descriptor.archs.join('/')}`)
  await Promise.resolve()
  return false
}
