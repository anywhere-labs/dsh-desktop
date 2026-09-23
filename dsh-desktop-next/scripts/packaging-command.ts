import { spawnSync } from 'node:child_process'

/** Reuse shared commands while including Next in the signed release's build gate. */
export function runNextPackagingCommand(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, workspaceRoot: string): void {
  const result = spawnSync(command, args.map(arg => arg.replaceAll('dsh-plugin-desktop-beta', 'dsh-desktop-next')), { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaging command failed (${result.status}): ${command}`)
  // Root check builds Stable/Beta. Next has its own build/Host gates, which must
  // finish before the shared release helper invokes electron-builder.
  if (cwd === workspaceRoot && command === 'yarn' && args.length === 2 && args[0] === 'run' && args[1] === 'check') {
    runNextPackagingCommand(command, ['run', 'check:next'], cwd, env, workspaceRoot)
  }
}
