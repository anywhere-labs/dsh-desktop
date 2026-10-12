import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

export function withDesktopDshHome(
  environment: LaunchEnvironmentSnapshot,
  homeDir: string,
): LaunchEnvironmentSnapshot {
  const entry = Object.freeze({ value: homeDir, source: 'process' as const })
  return Object.freeze({
    get: (name: string) => name.toUpperCase() === 'DSH_HOME' ? entry : environment.get(name),
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) => {
      return name.toUpperCase() === 'DSH_HOME' && sources.includes('process')
        ? entry
        : environment.getFrom(name, sources)
    },
  })
}
