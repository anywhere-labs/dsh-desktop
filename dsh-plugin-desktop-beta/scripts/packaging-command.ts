import { spawnSync } from 'node:child_process'

/** Reuse shared commands while routing the root build gate directly to Next's package preflight. */
export function runNextPackagingCommand(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, workspaceRoot: string): void {
  // Root `yarn run check` builds Stable/Beta. Route it directly to Next's macOS package preflight.
  const isRootCheck = cwd === workspaceRoot && command === 'yarn' && args.length === 2 && args[0] === 'run' && args[1] === 'check'
  if (isRootCheck && env.DSH_PACKAGE_CHECK_ALREADY_RAN === '1') return
  const mappedArgs = isRootCheck
    ? ['workspace', 'dsh-plugin-desktop-beta', 'check:mac-package']
    : args.map(arg => arg.replaceAll(/dsh-plugin-desktop(?!-beta)/gu, 'dsh-plugin-desktop-beta'))
  const result = spawnSync(command, mappedArgs, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaging command failed (${result.status}): ${command}`)
}
