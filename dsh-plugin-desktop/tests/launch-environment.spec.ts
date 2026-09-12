import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { describe, expect, it } from 'vitest'
import { withDesktopDshHome } from '../src/launch-environment.ts'

describe('Desktop DSH home launch environment', () => {
  const homeDir = 'C:\\Users\\Desktop User\\AppData\\Roaming\\DSH Desktop\\safe-mode\\dsh-home'

  it.each(['DSH_HOME', 'dsh_home', 'Dsh_Home'])('overrides %s for Windows Host child launches', name => {
    const environment = createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { DSH_HOME: 'C:\\Users\\Desktop User\\.dsh' },
    }])
    const launch = withDesktopDshHome(environment, homeDir)

    expect(launch.get(name)).toEqual({ value: homeDir, source: 'process' })
    expect(launch.getFrom(name, ['process'])).toEqual({ value: homeDir, source: 'process' })
    expect(environment.get('DSH_HOME')?.value).toBe('C:\\Users\\Desktop User\\.dsh')
    expect(Object.isFrozen(launch)).toBe(true)
    expect(Object.isFrozen(launch.get(name))).toBe(true)
  })

  it('supplies the selected home even when it was absent from the inherited environment', () => {
    const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }])
    const launch = withDesktopDshHome(environment, homeDir)

    expect(launch.get('DSH_HOME')).toEqual({ value: homeDir, source: 'process' })
    expect(launch.getFrom('DSH_HOME', ['project-env', 'user-env'])).toBeUndefined()
    expect(launch.getFrom('DSH_HOME', [])).toBeUndefined()
  })

  it('preserves unrelated values, source restrictions, and file provenance', () => {
    const environment = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { VALUE: 'inherited' } },
      { source: 'project-env', path: 'C:\\Project\\.env', values: { VALUE: 'project' } },
      { source: 'user-env', path: 'C:\\Home\\.env', values: { VALUE: 'user' } },
    ])
    const launch = withDesktopDshHome(environment, homeDir)

    expect(launch.get('VALUE')).toEqual(environment.get('VALUE'))
    expect(launch.getFrom('VALUE', ['project-env'])).toEqual(environment.getFrom('VALUE', ['project-env']))
    expect(launch.getFrom('VALUE', ['user-env'])).toEqual(environment.getFrom('VALUE', ['user-env']))
    expect(launch.get('MISSING')).toBeUndefined()
  })
})
