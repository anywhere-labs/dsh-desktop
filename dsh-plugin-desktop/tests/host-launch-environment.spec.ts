import { expect, it } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { serializeHostEnvironment } from '../src/host-launch-environment.ts'
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
