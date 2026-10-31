import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { after, test } from 'node:test'

// Execute the exact patched vendored JavaScript, with only external/native seams
// supplied by the test. This keeps the checks runnable before package installation
// and exercises real behavior rather than searching patch text for feature names.
// The Win32 seam is mocked: these do not claim native Windows enforcement.
// Per-root SIDs are intentional: granting the primary SID on every root would
// leave removed roots writable through their standing ACEs in newly minted tokens.
const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-multi-root-sandbox-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))
const versions = ['0.2.1-rc.3', '0.2.1-rc.5', '0.2.2-alpha.2']
const packages = ['dsh-sandbox', 'dsh-sandbox-policy', 'dsh-sandbox-local', 'dsh-sandbox-windows-acl']
const plain = (value) => JSON.parse(JSON.stringify(value))
const schema = new Proxy(function () {}, { get: () => schema, apply: () => schema })
class Service {
  static init = Symbol('init')
  constructor(ctx) { this.ctx = ctx }
}
class HarnessError extends Error {}
const base = {
  ...fs, ...path, ...os, createHash, fileURLToPath, process, Buffer,
  Service, HarnessError, z: schema, z$1: schema,
  assertNever: (value) => { throw new Error(`Unexpected ${value}`) },
  createLazyRequire: () => () => { throw new Error('Native FFI was not mocked') },
}
function evaluate(source, names, bindings = {}, setup = '') {
  const executable = source.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(import.meta.url))
    .replaceAll('import.meta.resolve', '__resolve')
  const context = vm.createContext({ ...base, ...bindings })
  vm.runInContext(`${executable}\n${setup}\nglobalThis.result = { ${names.join(', ')} };`, context)
  return context.result
}
function fixture(version) {
  const dirs = {}
  for (const name of packages) {
    const directory = path.join(temp, version, name)
    fs.mkdirSync(directory, { recursive: true })
    execFileSync('tar', ['-xzf', path.join(root, 'vendor/dsh-runtime', version, `deepseek-ai-${name}-${version}.tgz`), '-C', directory])
    const pkg = path.join(directory, 'package')
    execFileSync('git', ['apply', path.join(root, 'patches', `${name}@${version}.patch`)], { cwd: pkg })
    dirs[name] = pkg
  }
  const source = (name, file = 'index.js') => fs.readFileSync(path.join(dirs[name], 'lib', file), 'utf8')
  const sandbox = evaluate(source('dsh-sandbox'), ['canonicalPath', 'workspaceWritableRoots', 'writableRoots', 'SandboxProvider', ...(version === '0.2.2-alpha.2' ? ['SandboxUnsupportedPolicyError'] : [])])
  const policy = evaluate(source('dsh-sandbox-policy'), ['SandboxPolicyService', 'renderPolicyContext'])
  const aclFile = fs.readdirSync(path.join(dirs['dsh-sandbox-windows-acl'], 'lib')).find((name) => /^types-.*\.js$/.test(name))
  const aclSource = source('dsh-sandbox-windows-acl', aclFile)
  const acl = evaluate(aclSource, ['AclSandbox', 'workspaceWriteSid', 'tempWriteSid', 'assertTempRootOutsideWorkspace'], { BUNDLED_SKILL_RANK: 0 })
  const local = evaluate(source('dsh-sandbox-local'), ['LocalSandboxProvider', 'bwrapProfileArgs', 'landlockProfileArgs', 'seatbeltProfileArgs'], {
    ...sandbox, ...acl, LAUNCHER_BIN: 'landlock', LAUNCHER_FAILURE_EXIT: 125,
    grantArgs: (grants) => [JSON.stringify(grants)],
  })
  const primary = path.join(temp, version, 'primary')
  const secondary = path.join(temp, version, 'secondary')
  const unselected = path.join(temp, version, 'unselected')
  for (const directory of [primary, secondary, unselected]) fs.mkdirSync(directory)
  return { source, aclSource, sandbox, policy, acl, local, primary, secondary, unselected }
}

for (const version of versions) {
  const f = fixture(version)
  const multi = { mode: 'workspace-write', workspaceRoot: f.primary, workspaceRoots: [f.primary, f.secondary] }
  const legacy = { mode: 'workspace-write', workspaceRoot: f.primary }
  test(`${version}: legacy writable roots are unchanged; all workspace roots are canonical and deduplicated`, () => {
    const expected = [...new Set([f.primary, '/tmp', os.tmpdir()].map(f.sandbox.canonicalPath))]
    assert.deepEqual(plain(f.sandbox.writableRoots(legacy)), expected)
    assert.deepEqual(plain(f.sandbox.writableRoots({ ...legacy, workspaceRoots: [] })), expected)
    assert.deepEqual(plain(f.sandbox.workspaceWritableRoots({ ...multi, workspaceRoots: [f.primary, f.secondary, f.secondary] })), [f.primary, f.secondary])
    assert(!f.sandbox.workspaceWritableRoots(multi).includes(f.unselected))
    assert.deepEqual(plain(f.sandbox.writableRoots({ ...multi, mode: 'read-only' })), [])
  })
  test(`${version}: policy preserves primary order for secondary cwd and symlink spelling`, () => {
    const alias = path.join(temp, version, 'secondary-alias')
    fs.symlinkSync(f.secondary, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const service = Object.create(f.policy.SandboxPolicyService.prototype)
    Object.assign(service, {
      workspaceRoot: f.unselected, defaultMode: 'workspace-write', overrideOf: () => undefined,
      ctx: { get: () => ({ list: () => [{ path: f.primary, roots: [f.primary, f.secondary] }] }) },
    })
    for (const cwd of [f.secondary, alias]) {
      const resolved = service.resolve({ session: { id: 'session', header: { cwd } } })
      assert.equal(resolved.workspaceRoot, f.primary)
      assert.deepEqual(plain(resolved.workspaceRoots), [f.primary, f.secondary])
      assert.equal(resolved.sessionId, 'session')
      assert(f.policy.renderPolicyContext(resolved).includes(f.secondary))
    }
    assert.deepEqual(plain(service.resolve().workspaceRoots), [f.unselected])
    assert.deepEqual(plain(service.resolve({ session: { id: 'outside', header: { cwd: f.unselected } } }).workspaceRoots), [f.unselected])
    service.ctx.get = () => { throw new Error('unmounted') }
    assert.deepEqual(plain(service.resolve({ session: { id: 'old', header: { cwd: f.secondary } } }).workspaceRoots), [f.secondary])
  })
  test(`${version}: malformed/old registry entries fall back without granting an unrelated directory`, () => {
    const service = Object.create(f.policy.SandboxPolicyService.prototype)
    Object.assign(service, { workspaceRoot: f.primary, defaultMode: 'workspace-write', overrideOf: () => undefined })
    for (const entry of [{ path: f.primary }, { path: f.primary, roots: [] }, { path: f.primary, roots: [f.primary, 'relative'] }, { path: f.primary, roots: [f.unselected] }]) {
      service.ctx = { get: () => ({ list: () => [entry] }) }
      assert.deepEqual(plain(service.resolve({ session: { id: 's', header: { cwd: f.primary } } }).workspaceRoots), [f.primary])
    }
  })
  test(`${version}: bwrap, Landlock, Seatbelt and filesystem root sets agree`, () => {
    const bwrap = plain(f.local.bwrapProfileArgs(multi))
    for (const directory of [f.primary, f.secondary]) {
      const index = bwrap.indexOf(directory)
      assert.equal(bwrap[index - 1], '--bind')
      assert.equal(bwrap[index + 1], directory)
    }
    assert(!bwrap.includes(f.unselected))
    const landlock = JSON.parse(f.local.landlockProfileArgs(multi)[0])
    assert.deepEqual(landlock.readWrite, ['/dev/null', '/tmp', f.primary, f.secondary])
    const seatbelt = f.local.seatbeltProfileArgs(multi)[1]
    for (const directory of f.sandbox.writableRoots(multi)) assert(seatbelt.includes(JSON.stringify(directory)))
    assert(!seatbelt.includes(JSON.stringify(f.unselected)))
    assert(!f.local.bwrapProfileArgs({ ...multi, mode: 'read-only' }).includes(f.primary))
    assert.deepEqual(JSON.parse(f.local.landlockProfileArgs({ ...multi, mode: 'read-only' })[0]).readWrite, ['/dev/null'])
  })
  test(`${version}: Windows argv names every root while retaining primary identity`, () => {
    const provider = Object.create(f.local.LocalSandboxProvider.prototype)
    provider.windowsAclRunnerInvocation = () => ['node', 'runner.js']
    let granted
    provider.materializeAclGrant = (_session, roots) => { granted = roots; return { dir: '/private-temp', writeSid: 'temp-sid' } }
    const argv = plain(provider.windowsAclRunnerArgv({ ...multi, sessionId: 's' }))
    assert.deepEqual(argv.slice(2, 6), ['--workspace', f.primary, '--workspace', f.secondary])
    assert.deepEqual(plain(granted), [f.primary, f.secondary])
    assert.equal(argv[argv.indexOf('--write-sid') + 1], f.acl.workspaceWriteSid(f.primary))
    const old = plain(provider.windowsAclRunnerArgv(legacy))
    assert.deepEqual(old, ['node', 'runner.js', '--workspace', f.primary, '--temp', os.tmpdir(), '--mode', 'workspace-write'])
  })
  test(`${version}: ACL constructor rejects mismatched root/SID pairs`, () => {
    const roots = [f.primary, f.secondary]
    const sids = roots.map(f.acl.workspaceWriteSid)
    const valid = { mode: 'workspace-write', writableDirs: roots, writeSid: sids[0], workspaceWriteSids: sids, tempDir: null }
    assert.doesNotThrow(() => new f.acl.AclSandbox(valid))
    assert.throws(() => new f.acl.AclSandbox({ ...valid, workspaceWriteSids: [sids[0]] }), /must match/)
    assert.throws(() => new f.acl.AclSandbox({ ...valid, workspaceWriteSids: [sids[0], f.acl.workspaceWriteSid(f.unselected)] }), /does not match/)
    assert.throws(() => new f.acl.AclSandbox({ ...valid, mode: 'read-only' }), /must match/)
  })
  test(`${version}: newly minted Windows token omits removed-root SID and frees every allocation`, async () => {
    const tokens = [], grants = [], freed = []
    const api = {
      convertStringSidToSidW: (sid, slot) => { slot.value = sid; return 1 },
      closeHandle: () => 1,
    }
    const { AclSandbox } = evaluate(f.aclSource, ['AclSandbox'], {
      BUNDLED_SKILL_RANK: 0, mockApi: api, tokens, grants, freed,
      allocPtrSlot: () => ({}), decodePtr: (slot) => slot.value,
    }, `
      win32 = async () => mockApi;
      openCurrentProcessToken = () => 'current';
      makeWellKnownSid = (_api, kind) => 'known-' + kind;
      findLogonSid = () => 'logon';
      createRestrictedToken = (_api, _current, _logon, sids) => { tokens.push([...sids]); return 'token'; };
      restrictTokenIntegrity = () => {};
      setTokenDefaultDaclGrant = () => {};
      grantWrite = (_api, directory, sid) => grants.push([directory, sid]);
      freeSidBestEffort = (_api, sid) => { if (sid !== undefined) freed.push(sid); };
    `)
    for (const roots of [[f.primary, f.secondary], [f.primary]]) {
      const sids = roots.map(f.acl.workspaceWriteSid)
      const instance = new AclSandbox({ mode: 'workspace-write', writableDirs: roots, writeSid: sids[0], workspaceWriteSids: sids, tempDir: null })
      await instance.init()
      instance.dispose()
    }
    assert.deepEqual(plain(tokens), [[f.acl.workspaceWriteSid(f.primary), f.acl.workspaceWriteSid(f.secondary)], [f.acl.workspaceWriteSid(f.primary)]])
    assert(!tokens.flat().includes(f.acl.workspaceWriteSid(f.unselected)))
    assert.deepEqual(plain(grants[1]), [f.secondary, f.acl.workspaceWriteSid(f.secondary)])
    assert(freed.includes(f.acl.workspaceWriteSid(f.secondary)))
  })
  test(`${version}: a partial SID allocation failure frees all earlier capabilities and never mints a token`, async () => {
    const freed = []
    let minted = false
    const sids = [f.primary, f.secondary].map(f.acl.workspaceWriteSid)
    const api = {
      convertStringSidToSidW: (sid, slot) => {
        if (sid === sids[1]) throw new Error('second allocation failed')
        slot.value = sid
        return 1
      },
      closeHandle: () => 1,
    }
    const { AclSandbox } = evaluate(f.aclSource, ['AclSandbox'], {
      BUNDLED_SKILL_RANK: 0, mockApi: api, freed,
      mint: () => { minted = true },
      allocPtrSlot: () => ({}), decodePtr: (slot) => slot.value,
    }, `
      win32 = async () => mockApi;
      openCurrentProcessToken = () => 'current';
      createRestrictedToken = mint;
      freeSidBestEffort = (_api, sid) => { if (sid !== undefined) freed.push(sid); };
    `)
    const instance = new AclSandbox({ mode: 'workspace-write', writableDirs: [f.primary, f.secondary], writeSid: sids[0], workspaceWriteSids: sids, tempDir: null })
    await assert.rejects(instance.init(), /second allocation failed/)
    assert.equal(minted, false)
    assert.deepEqual(freed, [sids[0]])
  })
  test(`${version}: all Windows temp boundaries are checked before materializing any grant`, () => {
    let grants = 0
    const { LocalSandboxProvider } = evaluate(f.source('dsh-sandbox-local'), ['LocalSandboxProvider'], {
      ...f.sandbox, ...f.acl, LAUNCHER_BIN: 'landlock', LAUNCHER_FAILURE_EXIT: 125,
      AclWriteGrant: { create: () => { grants++; throw new Error('grant must not be attempted') } },
    })
    const provider = Object.create(LocalSandboxProvider.prototype)
    provider.workspaceGrants = new Map()
    provider.tempCapabilities = new Map()
    assert.throws(() => provider.materializeAclGrant('s', [f.primary, path.parse(os.tmpdir()).root]), /temp/i)
    assert.equal(grants, 0)
  })
  test(`${version}: runner rejects a missing secondary root before touching native APIs`, () => {
    const stderr = []
    let settled
    const source = f.source('dsh-sandbox-windows-acl', 'runner.js').replace(/main\(\)\.then\([\s\S]*?\n\}\);/, '')
    const { main, parseArgs } = evaluate(source, ['main', 'parseArgs'], {
      ...f.acl,
      process: { argv: ['node', 'runner', '--workspace', f.primary, '--workspace', path.join(temp, 'missing'), '--temp', os.tmpdir(), '--mode', 'workspace-write', '--', 'cmd'], stderr: { write: (value) => stderr.push(value) } },
      win32: () => { settled = 'native'; throw new Error('native should not run') },
    })
    assert.deepEqual(plain(parseArgs(['--workspace', f.primary, '--workspace', f.secondary, '--temp', os.tmpdir(), '--mode', 'workspace-write', '--', 'cmd']).workspaces), [f.primary, f.secondary])
    assert.throws(() => parseArgs(['--workspace', '', '--temp', os.tmpdir(), '--mode', 'workspace-write', '--', 'cmd']))
    const spelled = parseArgs(['--workspace', f.primary + path.sep, '--workspace', f.secondary + path.sep + '.', '--temp', os.tmpdir(), '--mode', 'workspace-write', '--', 'cmd'])
    assert.equal(spelled.workspace, f.primary)
    assert.deepEqual(plain(spelled.workspaces), [f.primary, f.secondary])
    assert.doesNotThrow(() => new f.acl.AclSandbox({
      mode: spelled.mode, writableDirs: spelled.workspaces,
      writeSid: f.acl.workspaceWriteSid(spelled.workspace),
      workspaceWriteSids: spelled.workspaces.map(f.acl.workspaceWriteSid), tempDir: null,
    }))
    return assert.rejects(main(), /./).then(() => {
      assert.equal(settled, undefined)
      assert(stderr.join('').includes('--workspace is not an existing directory'))
    })
  })
  if (version === '0.2.2-alpha.2') test(`${version}: explicit additional grants preserve strict validation and Windows rejection`, () => {
    const extra = { ...multi, additionalWritableRoots: [f.unselected] }
    assert.deepEqual(plain(f.sandbox.workspaceWritableRoots(extra)), [f.primary, f.secondary, f.unselected])
    const alias = path.join(temp, version, 'extra-alias')
    fs.symlinkSync(f.unselected, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => f.sandbox.workspaceWritableRoots({ ...multi, additionalWritableRoots: [alias] }), /symlinked grants/)
    assert.throws(() => f.sandbox.workspaceWritableRoots({ ...multi, additionalWritableRoots: [path.join(temp, 'missing')] }), /cannot read/)
    const provider = Object.create(f.local.LocalSandboxProvider.prototype)
    assert.throws(() => provider.windowsAclRunnerArgv(extra), /does not support additional writable directories/)
    assert.deepEqual(plain(f.sandbox.workspaceWritableRoots({ ...extra, mode: 'read-only' })), [])
  })
}

// Also exercise the installed packages so wrong resolutions or unapplied patches
// cannot be hidden by a successful vendored-patch fixture.
const channels = {
  'dsh-plugin-desktop': '0.2.1-rc.3',
  'dsh-desktop-next': '0.2.1-rc.5',
  'dsh-plugin-desktop-beta': '0.2.2-alpha.2',
}
for (const [channel, version] of Object.entries(channels)) {
  test(`${channel}: installed runtime exposes and consumes the multi-root policy`, async () => {
    const require = createRequire(path.join(root, channel, 'package.json'))
    const sandbox = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox')))
    const { LocalSandboxProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-local')))
    const { SandboxPolicyService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-policy')))
    const primary = path.join(temp, version, 'primary')
    const secondary = path.join(temp, version, 'secondary')
    const service = Object.create(SandboxPolicyService.prototype)
    Object.assign(service, {
      workspaceRoot: primary, defaultMode: 'workspace-write', overrideOf: () => undefined,
      ctx: { get: () => ({ list: () => [{ path: primary, roots: [primary, secondary] }] }) },
    })
    const policy = service.resolve({ session: { id: 'installed', header: { cwd: secondary } } })
    assert.equal(policy.workspaceRoot, primary)
    assert.deepEqual(sandbox.workspaceWritableRoots(policy), [primary, secondary])
    const provider = Object.create(LocalSandboxProvider.prototype)
    provider.internals = { chain: ['bwrap'] }
    const confined = await provider.confine(['/bin/true'], policy)
    assert(confined.argv.includes(primary))
    assert(confined.argv.includes(secondary))
  })
  test(`${channel}: installed filesystem writes agree with selected roots and reject removal/read-only`, async () => {
    const require = createRequire(path.join(root, channel, 'package.json'))
    const { SandboxedFileSystem } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-fs-sandbox')))
    const directory = fs.mkdtempSync(path.join(root, '.multi-root-fs-'))
    try {
      const [primary, secondary, unselected] = ['primary', 'secondary', 'unselected'].map((name) => path.join(directory, name))
      for (const selected of [primary, secondary, unselected]) fs.mkdirSync(selected)
      const filesystem = Object.create(SandboxedFileSystem.prototype)
      Object.assign(filesystem, { config: { cwd: primary, diffBasisMaxBytes: 4096 }, internals: {}, locks: new Map() })
      const policy = { mode: 'workspace-write', workspaceRoot: primary, workspaceRoots: [primary, secondary] }
      for (const selected of [primary, secondary]) {
        const target = await filesystem.resolve(path.join(selected, 'file'))
        await filesystem.writeText(target, 'permitted', undefined, undefined, policy)
        assert.equal(fs.readFileSync(path.join(selected, 'file'), 'utf8'), 'permitted')
        await assert.rejects(filesystem.writeText(target, 'denied', undefined, undefined, { ...policy, mode: 'read-only' }), (error) => error.code === 'FS_SANDBOX_DENIED')
      }
      const unselectedTarget = await filesystem.resolve(path.join(unselected, 'file'))
      await assert.rejects(filesystem.writeText(unselectedTarget, 'denied', undefined, undefined, policy), (error) => error.code === 'FS_SANDBOX_DENIED')
      const removedTarget = await filesystem.resolve(path.join(secondary, 'file'))
      await assert.rejects(filesystem.writeText(removedTarget, 'denied', undefined, undefined, { ...policy, workspaceRoots: [primary] }), (error) => error.code === 'FS_SANDBOX_DENIED')
      assert.equal(fs.existsSync(path.join(unselected, 'file')), false)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('native Linux bwrap: both selected roots writable, unselected root denied, read-only denies both', {
  skip: process.env.DSH_TEST_NATIVE_SANDBOX !== '1' || process.platform !== 'linux',
}, async (t) => {
  // Outside os.tmpdir(): the existing sandbox policy deliberately permits /tmp.
  const directory = fs.mkdtempSync(path.join(root, '.multi-root-native-'))
  try {
    const [primary, secondary, unselected] = ['primary', 'secondary', 'unselected'].map((name) => path.join(directory, name))
    for (const selected of [primary, secondary, unselected]) fs.mkdirSync(selected)
    for (const channel of Object.keys(channels)) {
      const require = createRequire(path.join(root, channel, 'package.json'))
      const { LocalSandboxProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox-local')))
      const provider = Object.create(LocalSandboxProvider.prototype)
      provider.internals = { chain: ['bwrap'] }
      for (const mode of ['workspace-write', 'read-only']) {
        const policy = { mode, workspaceRoot: primary, workspaceRoots: [primary, secondary] }
        const code = `const fs = require('node:fs'); console.log(JSON.stringify(${JSON.stringify([primary, secondary, unselected])}.map((directory) => { try { fs.writeFileSync(directory + '/probe', 'test'); return true; } catch { return false; } })))`
        const confined = await provider.confine([process.execPath, '-e', code], policy)
        const result = spawnSync(confined.argv[0], confined.argv.slice(1), { encoding: 'utf8', timeout: 10000 })
        if (result.error?.code === 'ENOENT' || /No permissions to create new namespace|Creating new namespace failed|Operation not permitted/.test(result.stderr ?? '')) {
          t.skip(`Host cannot launch bubblewrap: ${result.error?.message ?? result.stderr.trim()}`)
          return
        }
        assert.equal(result.status, 0, `${channel}: ${result.stderr || result.error}`)
        assert.deepEqual(JSON.parse(result.stdout.trim()), mode === 'workspace-write' ? [true, true, false] : [false, false, false])
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
