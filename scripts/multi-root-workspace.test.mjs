/** Run behavioral checks against the patched runtime actually installed in each channel. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const channels = ['dsh-plugin-desktop-beta', 'dsh-plugin-desktop', 'dsh-desktop-next']
const plain = value => JSON.parse(JSON.stringify(value))

async function browserModule(path, require) {
  let result
  runInNewContext(await readFile(path, 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { result = definition.factory(require) } } },
    queueMicrotask,
  }, { filename: path })
  return result
}

/** Use the shipped registry/entity code with a serialized, schema-validating domain table. */
function registryFixture(runtime) {
  const records = new Map()
  const headers = new Map()
  let tail = Promise.resolve()
  let queued
  const registry = new runtime.WorkspaceRegistry({
    reflect: { provide() {} },
    get: key => key === 'sessions' ? { get: id => headers.has(id) ? { header: headers.get(id) } : undefined } : undefined,
    logger: { warn() {} },
  })
  const table = {
    get: id => records.get(id),
    entries: () => records.entries(),
    get size() { return records.size },
    async put(id, value) { records.set(id, runtime.workspaceRecord.parse(value)) },
    async delete(id) { records.delete(id) },
    update(id, transform) {
      const result = tail.then(() => {
        const next = runtime.workspaceRecord.parse(transform(records.get(id)))
        records.set(id, next)
        return next
      })
      tail = result.then(() => {}, () => {})
      queued?.()
      queued = undefined
      return result
    },
  }
  registry.table = table
  registry.state = runtime.workspaceDomainState.parse({ initialized: true, workspaceIds: [] })
  registry.global = { async set(value) { registry.state = value } }
  return {
    registry, records, headers,
    nextUpdate: () => new Promise(resolve => { queued = resolve }),
    blockUpdates() {
      const gate = Promise.withResolvers()
      tail = tail.then(() => gate.promise)
      return gate.resolve
    },
  }
}

for (const channel of channels) {
  const require = createRequire(resolve(channel, 'package.json'))
  let entry
  try { entry = require.resolve('@deepseek-ai/dsh-workspace') } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
  }
  test(`${channel}: installed multi-root workspace runtime`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
    timeout: 30_000,
  }, async t => {
    const runtime = await import(pathToFileURL(entry).href)
    assert.equal(typeof runtime.WorkspaceRegistry.prototype.setRoots, 'function', 'installed workspace package must be patched')
    const root = await mkdtemp(join(tmpdir(), 'dsh-multi-root-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(async name => {
      const path = join(root, name)
      await mkdir(path)
      return realpath(path)
    }))
    const file = join(root, 'file')
    await writeFile(file, '')

    await t.test('old records retain one root without a storage version migration', () => {
      const f = registryFixture(runtime)
      const legacy = runtime.workspaceRecord.parse({ path: a, title: 'legacy', sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' })
      assert.equal(legacy.roots, undefined)
      assert.equal(runtime.workspaceDomainSpec.version, 2)
      f.records.set('legacy', legacy)
      f.registry.state.workspaceIds = ['legacy']
      f.registry.rebuildEntities()
      const workspace = f.registry.get('legacy')
      assert.deepEqual(workspace.roots, [a])
      assert.equal(workspace.path, a)
      workspace.roots.push(b)
      assert.deepEqual(workspace.roots, [a], 'root projection must not expose mutable record storage')
    })

    await t.test('create canonicalizes, deduplicates, resolves every root and reuses owned secondary roots', async () => {
      const { registry } = registryFixture(runtime)
      const alias = join(root, 'alias')
      await symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const workspace = await registry.create(a, 'multi', [b, alias, b])
      assert.deepEqual(workspace.roots, [a, b])
      assert.equal(await registry.resolveByPath(b), workspace)
      assert.equal(await registry.create(b, 'ignored'), workspace)
      assert.equal(workspace.title, 'multi')
    })

    await t.test('reordering switches the primary; direct and registry empty sets reject without writes', async () => {
      const { registry, records } = registryFixture(runtime)
      const workspace = await registry.create(a, 'multi', [b])
      await registry.setRoots(workspace.id, [b, a, b])
      assert.equal(workspace.path, b)
      assert.deepEqual(workspace.roots, [b, a])
      const before = structuredClone(records.get(workspace.id))
      await assert.rejects(registry.setRoots(workspace.id, []), { name: 'WorkspaceRootsInvalidError' })
      await assert.rejects(workspace.setRoots([]), { name: 'WorkspaceRootsInvalidError' })
      assert.deepEqual(records.get(workspace.id), before)
    })

    await t.test('invalid paths and roots owned by another workspace reject atomically', async () => {
      const { registry, records } = registryFixture(runtime)
      const first = await registry.create(a)
      await registry.create(b)
      const before = structuredClone(records.get(first.id))
      for (const roots of [[a, b], [a, file], [a, 'relative'], [a, join(root, 'missing')]]) {
        await assert.rejects(registry.setRoots(first.id, roots), { name: 'WorkspaceRootsInvalidError' })
        assert.deepEqual(records.get(first.id), before)
      }
    })

    await t.test('concurrent creates cannot claim the same additional root', async () => {
      const { registry } = registryFixture(runtime)
      const results = await Promise.allSettled([registry.create(a, 'a', [c]), registry.create(b, 'b', [c])])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.find(result => result.status === 'rejected').reason.name, 'WorkspaceRootsInvalidError')
      assert.equal(registry.list().length, 1)
    })

    await t.test('secondary-root sessions attach, root removal fails with details, then succeeds after detach', async () => {
      const { registry, headers, records } = registryFixture(runtime)
      const workspace = await registry.create(a, undefined, [b])
      headers.set('s', { id: 's', cwd: b })
      await workspace.attachSession('s')
      assert.deepEqual(workspace.sessionIds, ['s'])
      const before = structuredClone(records.get(workspace.id))
      await assert.rejects(registry.setRoots(workspace.id, [a]), error => {
        assert.equal(error.name, 'WorkspaceRootsInUseError')
        assert.equal(error.workspaceId, workspace.id)
        assert.deepEqual(error.roots, [b])
        assert.deepEqual(error.sessionIds, ['s'])
        return true
      })
      assert.deepEqual(records.get(workspace.id), before)
      await registry.setRoots(workspace.id, [b, a])
      await workspace.detachSession('s')
      await registry.setRoots(workspace.id, [a])
      assert.deepEqual(workspace.roots, [a])
    })

    await t.test('unresolved accounted cwd blocks removal without dropping membership', async () => {
      const { registry, headers } = registryFixture(runtime)
      const missingPath = join(root, 'vanishing-root')
      await mkdir(missingPath)
      const missing = await realpath(missingPath)
      const workspace = await registry.create(a, undefined, [missing])
      headers.set('missing-session', { id: 'missing-session', cwd: missing })
      await workspace.attachSession('missing-session')
      await rm(missing, { recursive: true })
      await registry.indexHeaders([...headers.values()])
      assert.equal(registry.missingSessionPaths.has('missing-session'), true)
      await assert.rejects(registry.setRoots(workspace.id, [a]), { name: 'WorkspaceRootsInUseError' })
      assert.deepEqual(workspace.sessionIds, ['missing-session'])
      await mkdir(missing)
      await registry.indexHeaders([...headers.values()])
      await registry.setRoots(workspace.id, [missing, a, c])
      assert.deepEqual(workspace.sessionIds, ['missing-session'])
      assert.deepEqual(workspace.roots, [missing, a, c])
    })

    await t.test('root removal sees an attachment queued earlier in the domain write chain', async () => {
      const f = registryFixture(runtime)
      const workspace = await f.registry.create(a, undefined, [b])
      f.headers.set('queued-session', { id: 'queued-session', cwd: b })
      const release = f.blockUpdates()
      let queued = f.nextUpdate()
      const attached = workspace.attachSession('queued-session')
      await queued
      queued = f.nextUpdate()
      const removal = f.registry.setRoots(workspace.id, [a])
      const rejected = assert.rejects(removal, { name: 'WorkspaceRootsInUseError' })
      await queued
      release()
      await attached
      await rejected
      assert.deepEqual(workspace.roots, [a, b])
      assert.deepEqual(workspace.sessionIds, ['queued-session'])
    })

    await t.test('attachment revalidates roots if a removal is ahead in the write chain', async () => {
      const f = registryFixture(runtime)
      const workspace = await f.registry.create(a, undefined, [b])
      f.headers.set('late-session', { id: 'late-session', cwd: b })
      const release = f.blockUpdates()
      let queued = f.nextUpdate()
      const removal = workspace.setRoots([a])
      await queued
      queued = f.nextUpdate()
      const attached = workspace.attachSession('late-session')
      const rejected = assert.rejects(attached, /no longer one of the workspace roots/)
      await queued
      release()
      await removal
      await rejected
      assert.deepEqual(workspace.roots, [a])
      assert.deepEqual(workspace.sessionIds, [])
    })

    await t.test('host, standalone remote and bundled browser remote keep the same setRoots schema', async () => {
      const { TYPERT } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-workspace-controller/typert')).href)
      const { TYPERT_REMOTE } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-workspace-controller/remote')).href)
      const remotes = await browserModule(require.resolve('@deepseek-ai/dsh-api-remotes/client'), require)
      const contributions = []
      const dispose = await remotes.apply({ remote: { async $mount(info) { contributions.push(info); return () => {} } } })
      const bundled = contributions.find(info => info.package === '@deepseek-ai/dsh-api-workspace-controller')
      assert.ok(bundled)
      const descriptors = [TYPERT.invocations, TYPERT_REMOTE.descriptors, bundled.descriptors].map(items => items.find(item => item.namespace === 'workspace' && item.method === 'setRoots'))
      const expected = { workspaceId: 'w', roots: [a, b] }
      for (const descriptor of descriptors) {
        assert.ok(descriptor, 'workspace/setRoots must be registered')
        assert.deepEqual(plain(descriptor.parameters[0].strictCodec.create().parse(expected)), expected)
        assert.throws(() => descriptor.parameters[0].strictCodec.create().parse({ roots: [a] }))
        assert.throws(() => descriptor.parameters[0].strictCodec.create().parse({ ...expected, unexpected: true }))
        const workspace = { workspaceId: 'w', path: a, roots: [a, b], title: 'multi', sessionIds: [], createdAt: 'now', updatedAt: 'now' }
        assert.deepEqual(plain(descriptor.result.create().parse({ workspace })), { workspace })
        const { roots, ...legacy } = workspace
        assert.throws(() => descriptor.result.create().parse({ workspace: legacy }))
      }
      assert.deepEqual(plain(descriptors[1].parameters[0].codec.jsonSchema), plain(descriptors[0].parameters[0].codec.jsonSchema))
      assert.deepEqual(plain(descriptors[2].result.jsonSchema), plain(descriptors[0].result.jsonSchema))
      await dispose()
    })

    await t.test('client facade forwards roots, installs complete rows and preserves structured refusal', async () => {
      const client = await browserModule(require.resolve('@deepseek-ai/dsh-api-workspace-controller/client'), specifier => {
        if (specifier === '@deepseek-ai/dsh-api-gateway/client') return {}
        if (specifier === '@deepseek-ai/dsh-client-store') return { notifySubscribers: listeners => { for (const listener of listeners) listener() } }
        return require(specifier)
      })
      const row = { workspaceId: 'w', path: a, roots: [a, b], title: 'multi', sessionIds: ['s'], createdAt: 'now', updatedAt: 'now' }
      let request
      let result = { ok: true, value: { workspace: row } }
      const model = new client.ClientWorkspaceModel({ async setRoots(input) { request = input; return result } })
      const facade = new client.WorkspaceController({ reflect: { provide() {} } }, model)
      assert.deepEqual(plain(await facade.setRoots('w', [a, b])), row)
      assert.deepEqual(plain(request), { workspaceId: 'w', roots: [a, b] })
      assert.deepEqual(plain(model.items), [row])
      const failure = { code: 'workspace/roots-in-use', message: 'still used', details: { workspaceId: 'w', roots: [b], sessionIds: ['s'] } }
      result = { ok: false, error: failure }
      await assert.rejects(facade.setRoots('w', [a]), error => {
        assert.equal(error.name, 'WorkspaceSetRootsError')
        assert.equal(error.rpcError, failure)
        return true
      })
      assert.deepEqual(plain(model.items), [row], 'failed mutation must not alter client state')
    })

    await t.test('setRoots authorization resolves the workspace resource and denies before dispatch', async () => {
      const { TYPERT } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-workspace-controller/typert')).href)
      const { TypertGatewayService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway')).href)
      const descriptor = TYPERT.invocations.find(item => item.namespace === 'workspace' && item.method === 'setRoots')
      const gateway = Object.create(TypertGatewayService.prototype)
      let decision
      gateway.ctx = {
        typert: { resources: { entries: () => [{ kind: 'workspace', field: 'workspaceId' }] } },
        remoteAccess: { decide(input) { decision = input; return { kind: 'deny', reason: 'policy' } } },
      }
      gateway.resolveDescriptor = () => descriptor
      gateway.resourceReaders = () => undefined
      gateway.resolveReceiverContext = () => { throw new Error('denied calls must never resolve the receiver') }
      const controller = new AbortController()
      await assert.rejects(gateway.prepareInvocation({
        namespace: 'workspace', method: 'setRoots', args: { request: { workspaceId: 'w', roots: [a, b] } },
        signal: controller.signal, peer: { principal: { kind: 'user', id: 'untrusted' }, signal: controller.signal },
      }, controller), error => error.code === 'remote-access/denied')
      assert.equal(decision.action, 'workspace/setRoots')
      assert.deepEqual(decision.resources, [{ kind: 'workspace', id: 'w' }])
    })
  })
}
