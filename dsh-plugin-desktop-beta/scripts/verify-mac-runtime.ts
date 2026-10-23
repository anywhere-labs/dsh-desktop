/** Check the bundled interpreter payloads inside a mounted Next application. */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { workspaceDependencyPaths } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { archivedPayload, verifyUpdaterManifestShim } from './packaged-payload.ts'
import { expectedNextVersion, verifyNextRuntimeTree } from './prepare-runtime.ts'
import { readSignedEntitlements } from './sign-runtime.ts'

const desktopRoot = resolve(import.meta.dirname, '..')

/** Runs one command and returns both output streams; rejects a non-zero exit. */
export type RunCommand = (command: string, args: readonly string[]) => string

const runCommand: RunCommand = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} ${result.signal ?? `exited with ${String(result.status)}`}: ${`${result.stdout}${result.stderr}`.trim()}`)
  return `${result.stdout}${result.stderr}`
}

/**
 * Verify every payload of a mounted application: the manifest copy the updaters of earlier
 * releases read first; manifests, files and CPU slices for both CPUs; imports, the Node version
 * and pnpm on the host's CPU; and, for a signed release, hardened-runtime signatures with the
 * upstream entitlement policy: JIT for Node, unsigned executable memory only for x64 Node, no
 * entitlements for Python.
 * @param appPath - Mounted `DSH Desktop Beta.app`.
 * @param signed - Whether the release carries Developer ID signatures.
 * @param run - Command executor.
 * @param readEntitlements - Entitlement reader for one signed file.
 */
export function verifyNextMacRuntime(
  appPath: string, signed: boolean, run: RunCommand = runCommand, readEntitlements: (file: string) => Record<string, unknown> = readSignedEntitlements,
): void {
  const resources = join(appPath, 'Contents', 'Resources')
  // The same path a 2.0.14 to 2.0.17 updater reads in the mounted image before it trusts the application.
  const archived = archivedPayload(resources)
  try { verifyUpdaterManifestShim(resources, archived, 'darwin', expectedNextVersion(desktopRoot)) } finally { archived.close() }
  const runtimeRoot = join(resources, 'runtime')
  for (const { arch, directory, manifest } of verifyNextRuntimeTree(runtimeRoot, 'darwin', expectedNextVersion(desktopRoot))) {
    const entries = workspaceDependencyPaths(directory, manifest)
    if (entries.node === undefined || entries.pnpm === undefined) throw new Error(`Next runtime: ${directory} resolves no Node or pnpm entry`)
    if (signed) {
      for (const file of [entries.python, entries.node]) {
        run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file])
        if (!/\bflags=0x[0-9a-f]+\(runtime\)(?:\s|$)/iu.test(run('/usr/bin/codesign', ['--display', '--verbose=4', file]))) {
          throw new Error(`Next runtime: ${file} is not signed with the hardened runtime`)
        }
      }
      const node = readEntitlements(entries.node)
      if (node['com.apple.security.cs.allow-jit'] !== true) throw new Error(`Next runtime: ${entries.node} must carry com.apple.security.cs.allow-jit`)
      if ((node['com.apple.security.cs.allow-unsigned-executable-memory'] === true) !== (arch === 'x64')) {
        throw new Error(`Next runtime: ${entries.node} must carry com.apple.security.cs.allow-unsigned-executable-memory only for x64`)
      }
      const python = Object.keys(readEntitlements(entries.python))
      if (python.length > 0) throw new Error(`Next runtime: ${entries.python} must carry no entitlements; found ${python.join(', ')}`)
    }
    if (arch !== process.arch) continue
    run(entries.python, ['-I', '-B', '-c', 'import numpy, pandas, docx, pptx, openpyxl, PIL, lxml, xlsxwriter'])
    run(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`])
    run(entries.node, [entries.pnpm, '--version'])
  }
}
