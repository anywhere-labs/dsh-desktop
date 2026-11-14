/** Exercise the installed Session skill catalog with a missing project directory in Beta and Next. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

function runtimePath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve('@deepseek-ai/dsh-api-session-controller')
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'@deepseek-ai/dsh-api-session-controller'")) return undefined
    throw error
  }
}

/** A live Session whose `ensure()` rejects with `failure`; the registry records the directory it is asked about. */
function liveSession(failure) {
  const directories = []
  const skill = { name: 'my-skill', description: 'A user skill', invocation: { modelInvocable: true, userInvocable: true } }
  const ctx = {
    sessionQuery: {
      observeSession: async () => ({
        header: { cwd: '/gone/workspace' },
        projections: { values: { workingDirectory: '/gone/workspace', agentPreset: 'standard' } },
        [Symbol.dispose]() {},
      }),
    },
    agents: { get: () => ({ id: 'session-1' }) },
    workingDirectory: { defaultDirectory: '/default', ensure: async () => { throw failure } },
    get: name => name === 'skills' ? { list: async ({ cwd }) => { directories.push(cwd); return [skill] } } : undefined,
  }
  return { ctx, directories }
}

function workingDirectoryError(code) {
  return Object.assign(new Error('working-directory: directory does not exist: "/gone/workspace"'), { name: 'WorkingDirectoryError', code })
}

// Stable is frozen on 0.2.1-rc.3, whose catalog is not patched.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = runtimePath(workspace)
  test(`${workspace}: skill catalog with a missing project directory`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async t => {
    const { SessionSkillCatalog } = await import(pathToFileURL(entry).href)
    const list = ctx => SessionSkillCatalog.prototype.list.call({ ctx }, { sessionId: 'session-1' }, new AbortController().signal)

    await t.test('lists the skills under the recorded directory', async () => {
      const { ctx, directories } = liveSession(workingDirectoryError('WORKING_DIRECTORY_UNAVAILABLE'))
      assert.deepEqual(await list(ctx), { skills: [{ name: 'my-skill', description: 'A user skill', modelInvocable: true }] })
      assert.deepEqual(directories, ['/gone/workspace'])
    })

    await t.test('still fails on other working-directory errors', async () => {
      for (const failure of [workingDirectoryError('WORKING_DIRECTORY_INVALID'), new Error('access denied')]) {
        await assert.rejects(list(liveSession(failure).ctx), { code: 'gateway/internal' })
      }
    })
  })
}
