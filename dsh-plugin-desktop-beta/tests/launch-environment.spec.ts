import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { describe, expect, it } from 'vitest'
import { electronBuilderEnvironment } from '../scripts/electron-builder-environment.ts'
import { serializeHostEnvironment } from '../src/host-launch-environment.ts'
import { withDesktopDshHome } from '../src/launch-environment.ts'

describe('Desktop DSH home launch environment', () => {
  const homeDir = 'C:\\Users\\Desktop User\\AppData\\Roaming\\DSH Desktop Beta\\safe-mode\\dsh-home'

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

describe('Host launch environment serialization', () => {
  it('retains shadowed environment values and their trust sources across structured clone', () => {
    const snapshot = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { EXAMPLE: 'inherited' } },
      { source: 'project-env', path: '/fixture/project/.env', values: { EXAMPLE: 'project' } },
      { source: 'user-env', path: '/fixture/user/.env', values: { EXAMPLE: 'user', ONLY_USER: 'value' } },
    ])
    const restored = createLaunchEnvironmentSnapshot(structuredClone(serializeHostEnvironment(snapshot, ['EXAMPLE', 'ONLY_USER'])))
    expect(restored.get('EXAMPLE')).toEqual(snapshot.get('EXAMPLE'))
    expect(restored.getFrom('EXAMPLE', ['project-env'])).toEqual(snapshot.getFrom('EXAMPLE', ['project-env']))
    expect(restored.getFrom('ONLY_USER', ['process'])).toBeUndefined()
    expect(restored.get('ONLY_USER')).toEqual(snapshot.get('ONLY_USER'))
  })
})

describe('Electron Builder resource environment', () => {
  it('selects bounded dependency traversal without mutating the caller', () => {
    const source = { SAFE_VALUE: 'kept', NODE_OPTIONS: '--enable-source-maps' }

    expect(electronBuilderEnvironment(source)).toEqual({
      SAFE_VALUE: 'kept',
      DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
      NODE_OPTIONS: '--enable-source-maps',
    })
    expect(source).toEqual({ SAFE_VALUE: 'kept', NODE_OPTIONS: '--enable-source-maps' })
  })

  it('forces traversal when a caller tries to disable the product safeguard', () => {
    expect(electronBuilderEnvironment({ DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '0' }))
      .toEqual({ DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1' })
  })
})
