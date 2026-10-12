import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MARKET_WORKSPACES, latestMarket, marketResolution, prepareMarket } from './prepare-dsh-market.mjs'

const reply = version => async () => new Response(JSON.stringify({ name: 'dshmarket', version }))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-market-prepare-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => writeFileSync(join(root, path), `${JSON.stringify(data, null, 2)}\n`)
  write('package.json', { resolutions: { 'dshmarket@npm:1.0.0': 'patch:old', other: '2.0.0' } })
  writeFileSync(join(root, 'yarn.lock'), 'original lock\n')
  for (const name of MARKET_WORKSPACES) {
    mkdirSync(join(root, name, 'node_modules/dshmarket'), { recursive: true })
    write(`${name}/package.json`, { name, dependencies: { dshmarket: '1.0.0', other: '2.0.0' } })
    write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version: '1.0.0' })
  }
  const install = () => {
    for (const name of MARKET_WORKSPACES) {
      const version = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies.dshmarket
      write(`${name}/node_modules/dshmarket/package.json`, { name: 'dshmarket', version })
    }
    writeFileSync(join(root, 'yarn.lock'), 'updated lock\n')
  }
  return { root, write, install }
}

test('refreshes all editions and rechecks the tag on every invocation', async t => {
  const { root, install } = fixture(t)
  let version = '1.59.0', queries = 0, installs = 0
  const options = { fetcher: async (...args) => { queries++; return reply(version)(...args) }, runInstall: () => { installs++; install() } }
  await prepareMarket(root, options)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).resolutions, { other: '2.0.0', 'dshmarket@npm:1.59.0': marketResolution('1.59.0') })
  for (const name of MARKET_WORKSPACES) assert.deepEqual(JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).dependencies, { dshmarket: version, other: '2.0.0' })
  await prepareMarket(root, options)
  assert.equal(installs, 1)
  version = '1.60.0'
  await prepareMarket(root, options)
  assert.equal(queries, 3)
  assert.equal(installs, 2)
  assert.equal(await prepareMarket(root, { ...options, check: true }), '1.60.0')
})

test('check is read-only and rejects stale installed copies', async t => {
  const { root, install, write } = fixture(t)
  await assert.rejects(prepareMarket(root, { check: true, fetcher: reply('1.59.0'), runInstall: () => assert.fail('must not install') }), /market:prepare/)
  assert.equal(readFileSync(join(root, 'yarn.lock'), 'utf8'), 'original lock\n')
  await prepareMarket(root, { fetcher: reply('1.59.0'), runInstall: install })
  write('dsh-desktop-next/node_modules/dshmarket/package.json', { name: 'dshmarket', version: '1.0.0' })
  await assert.rejects(prepareMarket(root, { check: true, fetcher: reply('1.59.0') }), /dsh-desktop-next/)
})

test('restores manifests and the lockfile after an interrupted installation', async t => {
  const { root } = fixture(t)
  const paths = ['package.json', 'yarn.lock', ...MARKET_WORKSPACES.map(name => `${name}/package.json`)]
  const before = paths.map(path => readFileSync(join(root, path), 'utf8'))
  await assert.rejects(prepareMarket(root, { fetcher: reply('1.59.0'), runInstall: () => {
    writeFileSync(join(root, 'yarn.lock'), 'incomplete')
    throw new Error('interrupted')
  } }), /restored/)
  assert.deepEqual(paths.map(path => readFileSync(join(root, path), 'utf8')), before)
})

test('does not accept an offline or malformed latest response', async () => {
  await assert.rejects(latestMarket(async () => { throw new Error('offline') }), /offline/)
  await assert.rejects(latestMarket(async () => new Response('', { status: 503 })), /503/)
  await assert.rejects(latestMarket(reply('latest')), /invalid/)
  await assert.rejects(latestMarket(async () => new Response(JSON.stringify({ name: 'other', version: '1.0.0' }))), /invalid/)
})

test('all root launch, build and packaging entry points prepare the market first', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const entrypoints = Object.entries(scripts).filter(([name]) => /^(build$|dev(?::|$)|start(?::|$)|package:dir|dist:)/.test(name))
  assert.ok(entrypoints.length >= 18)
  for (const [name, command] of entrypoints) assert.ok(command.startsWith('yarn market:prepare && '), name)
})
