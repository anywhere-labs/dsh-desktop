import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { createPackageRunner } from '../src/extensions.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE } from '../src/pnpm-policy.ts'

const runners: ReturnType<typeof createPackageRunner>[] = []
function runner() {
  const result = createPackageRunner({ command: process.execPath, env: {}, args: ['-e', `
    if (process.argv[1] === 'hold') {
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      process.stdout.write('ready');
    } else if (process.argv[1] === 'later') setTimeout(() => process.exit(0), 100);
  `, '--'] }, tmpdir())
  runners.push(result)
  return result
}
afterEach(async () => { await Promise.all(runners.splice(0).map(value => value.dispose())) })

it.each([[false, false], [true, false], [false, true], [true, true]])(
  'passes the Desktop policy once with invocation=%s and caller=%s', async (invocationPolicy, callerPolicy) => {
    const manager = createPackageRunner({ command: process.execPath, env: {},
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--',
        ...(invocationPolicy ? [PNPM_IGNORE_MINIMUM_RELEASE_AGE] : [])],
    }, tmpdir())
    runners.push(manager)
    const operation = manager.run([...(callerPolicy ? [PNPM_IGNORE_MINIMUM_RELEASE_AGE] : []), 'remove', 'fixture'])
    let output = ''
    operation.stdout.on('data', chunk => { output += chunk })
    expect((await operation.done).exitCode).toBe(0)
    expect(JSON.parse(output)).toEqual(['remove', 'fixture', PNPM_IGNORE_MINIMUM_RELEASE_AGE])
  },
)

it('does not let cancellation of a completed operation kill its successor', async () => {
  const manager = runner()
  const first = manager.run(['done'])
  expect((await first.done).exitCode).toBe(0)
  const second = manager.run(['later'])
  first.cancel()
  expect((await second.done).exitCode).toBe(0)
})

it('serializes operations and forcibly reaps an uncooperative process on disposal', async () => {
  const manager = runner()
  const child = manager.run(['hold'])
  await once(child.stdout, 'data')
  expect(() => manager.run(['done'])).toThrow('already active')
  await manager.dispose()
  const result = await child.done
  expect(result.exitCode === 0 && result.signal === null).toBe(false)
  expect(() => manager.run(['done'])).toThrow('disposed')
})
