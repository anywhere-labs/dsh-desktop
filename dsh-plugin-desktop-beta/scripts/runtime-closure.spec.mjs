import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyRuntimeClosure } from './runtime-closure.mjs'

const manifests = {
  '@deepseek-ai/root': {
    dependencies: { '@deepseek-ai/leaf': '1.0.0' },
    peerDependencies: { '@deepseek-ai/service': '1.0.0' },
  },
  '@deepseek-ai/leaf': {},
  '@deepseek-ai/service': {},
}

async function loadPackage(name) {
  const manifest = manifests[name]
  assert.ok(manifest, `missing fixture manifest for ${name}`)
  return { manifest, path: `/virtual/${name}/package.json` }
}

test('rejects a required first-party peer that is not declared at the root', async () => {
  const result = await verifyRuntimeClosure({
    name: 'runtime',
    dependencies: { '@deepseek-ai/root': '1.0.0' },
  }, loadPackage, '/virtual/runtime/package.json')

  assert.deepEqual(result.failures, ['runtime -> @deepseek-ai/root -> @deepseek-ai/service'])
})

test('accepts required root peers and ignores optional peers', async () => {
  const result = await verifyRuntimeClosure({
    name: 'runtime',
    dependencies: {
      '@deepseek-ai/root': '1.0.0',
      '@deepseek-ai/service': '1.0.0',
    },
  }, async (name) => {
    if (name === '@deepseek-ai/root') {
      return {
        manifest: {
          ...manifests[name],
          peerDependencies: {
            ...manifests[name].peerDependencies,
            '@deepseek-ai/optional': '1.0.0',
          },
          peerDependenciesMeta: { '@deepseek-ai/optional': { optional: true } },
        },
        path: `/virtual/${name}/package.json`,
      }
    }
    return loadPackage(name)
  }, '/virtual/runtime/package.json')

  assert.deepEqual(result.failures, [])
  assert.equal(result.packageCount, 3)
})

test('requires external peers of direct deploy-root packages', async () => {
  const result = await verifyRuntimeClosure({
    name: 'runtime',
    dependencies: { '@deepseek-ai/root': '1.0.0' },
  }, async (name) => ({
    manifest: { ...manifests[name], peerDependencies: { react: '^18.2.0' } },
    path: `/virtual/${name}/package.json`,
  }), '/virtual/runtime/package.json')

  assert.deepEqual(result.failures, ['runtime -> @deepseek-ai/root -> react'])
})

test('upgrades an optional path when another package requires the same dependency', async () => {
  const result = await verifyRuntimeClosure({
    name: 'runtime',
    dependencies: {
      '@deepseek-ai/optional-owner': '1.0.0',
      '@deepseek-ai/required-owner': '1.0.0',
      '@deepseek-ai/service': '1.0.0',
    },
  }, async (name) => ({
    manifest: {
      ...(name === '@deepseek-ai/optional-owner'
        ? { optionalDependencies: { '@deepseek-ai/shared': '1.0.0' } }
        : name === '@deepseek-ai/required-owner'
          ? { dependencies: { '@deepseek-ai/shared': '1.0.0' } }
          : name === '@deepseek-ai/shared'
            ? { peerDependencies: { '@deepseek-ai/service': '1.0.0' } }
            : {}),
    },
    path: `/virtual/${name}/package.json`,
  }), '/virtual/runtime/package.json')

  assert.deepEqual(result.failures, [])
  assert.equal(result.packageCount, 4)
})
