import { delimiter, join } from 'node:path'
import { expect, it } from 'vitest'
import { bundledPnpmEntry, bundledPnpmInvocation } from '../src/bundled-pnpm.ts'
import { NEXT_PACKAGE } from '../src/profiles.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE } from '../src/pnpm-policy.ts'

it('runs the bundled pnpm through this executable with the unpacked Node launchers first on PATH', () => {
  const resources = join('/Applications', 'DSH Desktop Beta.app', 'Contents', 'Resources')
  const invocation = bundledPnpmInvocation(join(resources, 'app.asar'))
  expect(invocation.command).toBe(process.execPath)
  expect(invocation.args).toEqual(['--expose-internals', bundledPnpmEntry(NEXT_PACKAGE), PNPM_IGNORE_MINIMUM_RELEASE_AGE])
  expect(invocation.env.DSH_DESKTOP_NODE_EXECUTABLE).toBe(process.execPath)
  expect(invocation.env.PATH?.split(delimiter)[0]).toBe(join(resources, 'app.asar.unpacked', 'scripts', 'node-bin'))
})
