/** Keep release cache dependencies scoped to the platform and payload that consume them. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const upstream = 'deepseek-harness/scripts/primary-runtime/lock.json'

test('real runtime and CI digests follow source, dependency and target-lock changes without a format bump', () => {
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const root = mkdtempSync(join(tmpdir(), 'desktop-cache-inputs-'))
  const workspace = 'dsh-desktop-next'
  const family = `${workspace}/scripts/upstream-family.ts`
  const sources = ['primary-runtime.ts', 'prepare-runtime.ts', 'prune-python-tests.ts'].map(name => `${workspace}/scripts/${name}`)
  const shared = ['scripts/windows-python-sitecustomize.py']
  const manifest = JSON.parse(readFileSync(join(repository, workspace, 'package.json'), 'utf8'))
  const version = manifest.dependencies['@deepseek-ai/dsh-skill-office']
  const owned = ['dsh-skill-office', 'dsh-tool-workspace-dependencies']
    .map(name => `vendor/dsh-runtime/${version}/deepseek-ai-${name}-${version}.tgz`)
  const officeArchive = owned[0]
  owned.push(`patches/pnpm@${manifest.dependencies.pnpm}.patch`)
  const unrelated = ['yarn.lock', 'package.json', `${workspace}/package.json`]
  const supplement = 'scripts/primary-runtime-win-arm64.json'
  const probe = `
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    import { nextRuntimeCacheKey } from './${workspace}/scripts/prepare-runtime.ts';
    import { primaryRuntimePayloadDigest, readPrimaryRuntimeLock } from './${workspace}/scripts/primary-runtime.ts';
    import { OFFICE_SKILLS_IN_PACKAGE } from './${family}';
    const require = createRequire(new URL('./${workspace}/package.json', import.meta.url));
    const pnpm = JSON.parse(readFileSync(require.resolve('pnpm'), 'utf8')).version;
    const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64', 'linux-x64', 'linux-arm64'];
    const payloads = targets.map(target => primaryRuntimePayloadDigest(target, readPrimaryRuntimeLock(undefined, target), pnpm));
    const keys = [['darwin', 'arm64'], ['win32', 'x64'], ['win32', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']].map(([platform, arch]) => nextRuntimeCacheKey(platform, arch));
    console.log(JSON.stringify({ payloads, keys, officeSkillsInPackage: OFFICE_SKILLS_IN_PACKAGE }));
  `
  const snapshot = (cwd = root) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd, encoding: 'utf8' }))
  try {
    for (const path of [...sources, ...shared, ...owned, ...unrelated, upstream, supplement, family,
      `${workspace}/scripts/upstream-family/cua-native.ts`, `${workspace}/scripts/upstream-family/cua-windows-native.ts`, `${workspace}/src/upstream-family/official-cua.ts`,
      `${workspace}/src/host/unpacked-package.ts`, `${workspace}/src/host/office-engine.ts`, 'dsh-plugin-desktop/package.json',
      'dsh-plugin-desktop/scripts/mac-universal.ts', 'dsh-plugin-desktop/scripts/windows-architecture.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      copyFileSync(join(repository, path), join(root, path))
    }
    symlinkSync(join(repository, workspace, 'node_modules'), join(root, workspace, 'node_modules'), 'junction')
    const before = snapshot()
    assert.deepEqual(snapshot(repository), before, 'Checkout location must not affect cache identities')
    const cli = execFileSync(process.execPath, [`${workspace}/scripts/prepare-runtime.ts`, '--cache-key'], { cwd: root, encoding: 'utf8' }).trim()
    assert.match(cli, /^[a-f0-9]{64}$/u)
    assert.ok(before.keys.includes(cli), 'The CI command must use the same runtime input identity')
    assert.equal(existsSync(join(root, workspace, '.desktop-build')), false, 'Cache-key mode must not prepare or modify a runtime')
    for (const path of [...sources, ...shared, ...owned, ...unrelated, upstream, supplement, family]) {
      const original = readFileSync(join(root, path))
      let changed = Buffer.concat([original, Buffer.from(`\n${path.endsWith('.ts') ? '//' : '#'} changed build input\n`)])
      if (path === upstream || path === supplement) {
        const lock = JSON.parse(original.toString('utf8'))
        if (path === supplement) lock.artifact.pythonSha256 = 'f'.repeat(64)
        else lock.wheels[0].sha256 = 'f'.repeat(64)
        changed = JSON.stringify(lock)
      } else if (path === family) {
        changed = original.toString('utf8').replace(/OFFICE_SKILLS_IN_PACKAGE = (?:true|false)/u,
          `OFFICE_SKILLS_IN_PACKAGE = ${!before.officeSkillsInPackage}`)
      } else if (path.endsWith('package.json')) {
        const value = JSON.parse(original.toString('utf8'))
        value.description = 'Unrelated metadata edit'
        if (path === 'package.json') value.resolutions['unrelated-frontend-package@npm:1.0.0'] = '1.0.1'
        else value.devDependencies['unrelated-frontend-package'] = '1.0.1'
        changed = JSON.stringify(value)
      }
      writeFileSync(join(root, path), changed)
      const after = snapshot()
      for (const field of ['payloads', 'keys']) {
        before[field].forEach((value, index) => {
          const affected = !unrelated.includes(path) && !(path === officeArchive && before.officeSkillsInPackage)
            && (path !== supplement || index === (field === 'payloads' ? 3 : 2))
          assert.equal(after[field][index] !== value, affected, `${path}: ${field}[${index}] must follow the effective inputs`)
        })
      }
      if (path === sources[0]) assert.deepEqual(snapshot(), after, 'Unchanged inputs must reuse the new identity on the next build')
      writeFileSync(join(root, path), original)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
