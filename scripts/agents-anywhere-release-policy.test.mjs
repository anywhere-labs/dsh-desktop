import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { AA_PACKAGE, AA_PEERS, AA_REPOSITORY, AA_WORKSPACES, assertPreparedAaRelease } from './agents-anywhere-release-policy.mjs'
import { prepareInstalledAaRuntime } from './prepare-agents-anywhere-runtime.mjs'

const commit = 'a'.repeat(40)
const version = '0.1.0-dev.0.desktop.caaaaaaaaaaaa.r12345678'
const artifact = `agents-anywhere-dsh-bridge-next-${version}.tgz`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-aa-policy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), JSON.stringify(data))
  }
  const patch = (path, change) => {
    const data = JSON.parse(readFileSync(join(root, path), 'utf8'))
    change(data)
    write(path, data)
  }
  const runtimePeers = Object.fromEntries(AA_PEERS.map(name => [name, '0.1.5-rc.2 || 0.1.6-alpha.2']))
  for (const [index, workspace] of AA_WORKSPACES.entries()) {
    write(`${workspace}/package.json`, {
      dependencies: {
        [AA_PACKAGE]: `file:../vendor/agents-anywhere/${artifact}`,
        ...Object.fromEntries(AA_PEERS.map(name => [name, index === 0 ? '0.1.5-rc.2' : '0.1.6-alpha.2'])),
      },
    })
    write(`${workspace}/node_modules/${AA_PACKAGE}/package.json`, { version, peerDependencies: runtimePeers })
  }
  write(`vendor/agents-anywhere/${artifact}`, 'prepared AA bytes')
  write('vendor/agents-anywhere/provenance.json', {
    repository: AA_REPOSITORY, commit, artifact, desktopVersion: version, runtimePeers,
    sha256: createHash('sha256').update(readFileSync(join(root, 'vendor/agents-anywhere', artifact))).digest('hex'),
  })
  return { root, patch }
}

test('accepts the latest AA with both Desktop runtime peer ranges installed', t => {
  const { root } = fixture(t)
  assert.equal(assertPreparedAaRelease(root, commit).commit, commit)
})

test('rejects the former stable-old/beta-new split even if the tarball is valid', t => {
  const { root, patch } = fixture(t)
  patch('dsh-plugin-desktop/package.json', data => { data.dependencies[AA_PACKAGE] = 'file:../vendor/agents-anywhere/old.tgz' })
  assert.throws(() => assertPreparedAaRelease(root, commit), /dsh-plugin-desktop references a different AA artifact/)
})

test('rejects a prepared artifact after AA main advances', t => {
  const { root } = fixture(t)
  assert.throws(() => assertPreparedAaRelease(root, 'b'.repeat(40)), /not from the latest AA main commit/)
})

test('rejects stale installed code despite updated manifests and provenance', t => {
  const { root, patch } = fixture(t)
  patch(`dsh-plugin-desktop/node_modules/${AA_PACKAGE}/package.json`, data => { data.version = '0.1.0-old' })
  assert.throws(() => assertPreparedAaRelease(root, commit), /outdated installed AA package/)
})

test('requires rebuilding the AA peer patch after a Desktop runtime update', t => {
  const { root, patch } = fixture(t)
  patch('dsh-plugin-desktop-beta/package.json', data => { data.dependencies[AA_PEERS[0]] = '0.1.6-alpha.3' })
  assert.throws(() => assertPreparedAaRelease(root, commit), /runtime peers have changed/)
})

test('rejects corrupted or replaced vendor bytes', t => {
  const { root } = fixture(t)
  writeFileSync(join(root, 'vendor/agents-anywhere', artifact), 'replaced bytes')
  assert.throws(() => assertPreparedAaRelease(root, commit), /checksum mismatch/)
})

test('repairs the 0644 uv payload for both Mac architectures in both channels', { skip: process.platform === 'win32' }, t => {
  const { root } = fixture(t)
  const files = AA_WORKSPACES.flatMap(workspace => ['arm64', 'x64'].map(arch =>
    join(root, workspace, 'node_modules', '@dataiku', `uv-darwin-${arch}`, 'bin', 'uv')))
  for (const path of files) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'uv fixture')
    chmodSync(path, 0o644)
  }
  prepareInstalledAaRuntime(root, 'darwin')
  for (const path of files) {
    assert.equal(statSync(path).mode & 0o777, 0o755)
    assert.doesNotThrow(() => accessSync(path, constants.X_OK))
    assert.equal(readFileSync(path, 'utf8'), 'uv fixture')
  }
})
