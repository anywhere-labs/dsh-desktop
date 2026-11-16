import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retiredRuntimePaths } from './retired-runtime-versions.mjs'

const CHANNELS = ['0.2.1-rc.3', '0.2.2-rc.3', '0.2.2-rc.3']

test('keeps the runtimes and runtime patches of every channel', () => {
  assert.deepEqual(retiredRuntimePaths(CHANNELS, ['0.2.1-rc.3', '0.2.2-rc.3'], [
    'dsh@0.2.2-rc.3.patch',
    'dsh-web-app@0.2.1-rc.3.patch',
    'dsh-experimental-subagent-oar@0.2.2-rc.3.patch',
  ]), [])
})

test('lists runtimes and runtime patches that no channel uses', () => {
  assert.deepEqual(retiredRuntimePaths(CHANNELS, ['0.2.2-rc.2', '0.2.2-rc.3', '0.1.5-rc.2'], [
    'dsh@0.2.2-rc.1.patch',
    'dsh-sandbox-windows-acl@0.2.2-rc.2.patch',
    'dsh-sandbox-windows-acl@0.2.2-rc.3.patch',
  ]), [
    'patches/dsh-sandbox-windows-acl@0.2.2-rc.2.patch',
    'patches/dsh@0.2.2-rc.1.patch',
    'vendor/dsh-runtime/0.1.5-rc.2',
    'vendor/dsh-runtime/0.2.2-rc.2',
  ])
})

test('ignores third-party patches, the market patch and hidden entries', () => {
  assert.deepEqual(retiredRuntimePaths(CHANNELS, ['.DS_Store', '0.2.2-rc.3'], [
    'node-pty@1.2.0-beta.15.patch',
    'pi-ai@1.3.0.patch',
    'open@11.0.4.patch',
    'dshmarket-desktop.patch',
    '@electron__osx-sign@1.3.3.patch',
  ]), [])
})
