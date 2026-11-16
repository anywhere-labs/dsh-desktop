import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMAIN, hostsWithDrill, probeCommand, probeVerdict, routeRelease } from './local-update-drill.mjs'

const dmg = arch => ({ arch, filename: `DSH-NEXT-2.0.22-next.1-${arch}.dmg`, sha256: arch.padEnd(64, '0') })
const bridge = { arch: 'universal', filename: 'DSH-NEXT-2.0.22-next-universal.dmg', sha256: 'b'.repeat(64) }

test('a request naming its CPU gets that CPU’s DMG, or the universal one', () => {
  const config = { channels: { next: { version: '2.0.22-next.1', mac: { arm64: dmg('arm64'), universal: dmg('universal') } } } }
  assert.deepEqual(routeRelease(config, 'next', 'arm64'), { version: '2.0.22-next.1', dmg: dmg('arm64') })
  assert.deepEqual(routeRelease(config, 'next', 'x64'), { version: '2.0.22-next.1', dmg: dmg('universal') })
  assert.equal(routeRelease(config, 'next', 'ppc').status, 400)
  assert.equal(routeRelease(config, 'beta', 'arm64').status, 503)
})

test('a request naming no CPU gets the bridge version, else the universal DMG, else nothing', () => {
  const thin = { arm64: dmg('arm64'), x64: dmg('x64') }
  assert.deepEqual(routeRelease({ channels: { next: { version: '2.0.22-next.1', mac: thin, bridge: { version: '2.0.22-next', dmg: bridge } } } }, 'next', undefined),
    { version: '2.0.22-next', dmg: bridge })
  assert.deepEqual(routeRelease({ channels: { next: { version: '2.0.22-next.1', mac: { ...thin, universal: dmg('universal') } } } }, 'next', undefined),
    { version: '2.0.22-next.1', dmg: dmg('universal') })
  assert.equal(routeRelease({ channels: { next: { version: '2.0.22-next.1', mac: thin } } }, 'next', undefined).status, 503)
  assert.equal(routeRelease({ channels: { next: { version: '2.0.22-next.1', mac: { arm64: dmg('arm64') } } } }, 'next', 'x64').status, 503)
})

test('the hosts block is added once, removed exactly, and never overrides another entry for the name', () => {
  const original = '127.0.0.1 localhost\n::1 localhost\n'
  const mapped = hostsWithDrill(original, true)
  assert.match(mapped, new RegExp(`127\\.0\\.0\\.1 ${DOMAIN.replaceAll('.', '\\.')}\\n::1 ${DOMAIN.replaceAll('.', '\\.')}`, 'u'))
  assert.equal(hostsWithDrill(mapped, true), mapped)
  assert.equal(hostsWithDrill(mapped, false), original)
  assert.equal(hostsWithDrill(original, false), original)
  assert.throws(() => hostsWithDrill(`${original}10.0.0.1 ${DOMAIN}\n`, true), /已有/u)
  assert.throws(() => hostsWithDrill(`${original}# BEGIN DSH LOCAL UPDATE DRILL\n`, false), /不完整/u)
})

test('the probe runs as the invoking user, in their session, when start runs it as root', () => {
  assert.deepEqual(probeCommand('/E', ['/probe.cjs', 'next'], 501, undefined), ['/E', '/probe.cjs', 'next'])
  assert.deepEqual(probeCommand('/E', ['/probe.cjs', 'next'], 0, '501'),
    ['/bin/launchctl', 'asuser', '501', '/usr/bin/sudo', '-u', '#501', '-H', '/E', '/probe.cjs', 'next'])
  for (const sudoUid of [undefined, '0', 'xipian', '']) assert.throws(() => probeCommand('/E', [], 0, sudoUid), /sudo/u)
})

test('the probe verdict passes only a parsable version answer and names the usual failures', () => {
  assert.deepEqual(probeVerdict({ status: 200, body: '{"version":"2.0.22-next.1","channel":"next"}' }).ok, true)
  assert.match(probeVerdict({ status: 200, body: '{"version":"2.0.22-next.1","channel":"next"}' }).text, /2\.0\.22-next\.1/u)
  assert.equal(probeVerdict({ status: 200, body: 'not json' }).ok, false)
  assert.match(probeVerdict({ status: 503, body: '{}' }).text, /HTTP 503/u)
  assert.match(probeVerdict({ error: 'net::ERR_CERT_AUTHORITY_INVALID' }).text, /不信任演练证书/u)
  assert.match(probeVerdict({ error: 'net::ERR_CONNECTION_REFUSED' }).text, /连不上本机 443/u)
  assert.match(probeVerdict({ error: 'net::ERR_NAME_NOT_RESOLVED' }).text, /没有解析到本机/u)
  assert.equal(probeVerdict({}).ok, false)
  assert.equal(probeVerdict({ probeFailed: '退出码 1' }).ok, undefined)
})
