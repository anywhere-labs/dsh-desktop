import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import { carriedEffort, configOptions, findModel, switchValue } from '../../src/acp/options.js'
import { launcherScript } from '../../src/launcher.js'
import { endpointProof, parseRecord, validProof } from '../../src/endpoint.js'
import { homeSocket, pipeEndpoint, RPC_SERVICE } from '../../src/paths.js'

const catalog = {
  default: { provider: 'deepseek', model: 'v4' },
  routableProviders: ['deepseek', 'gateway'],
  failures: [],
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [
      { id: 'v4', name: 'V4', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' } },
      { id: 'v4-lite', name: 'V4 Lite', reasoning: { efforts: [{ id: 'high', name: '高' }] } },
    ] },
    { id: 'gateway', name: '网关', models: [{ id: 'org/model', name: 'Org Model' }] },
    { id: 'offline', name: '离线', models: [{ id: 'm', name: 'M' }] },
  ],
} as unknown as ModelCatalog

test('model options group routable providers and keep provider/model values', () => {
  const options = configOptions({ catalog, model: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' } })
  const model = options.find(option => option.id === 'model')
  assert.equal(model?.type === 'select' && model.currentValue, 'deepseek/v4')
  assert.deepEqual(model?.type === 'select' && model.options.map(group => 'group' in group ? group.group : ''), ['deepseek', 'gateway'], 'unroutable providers are hidden')
  const effort = options.find(option => option.id === 'reasoning_effort')
  assert.equal(effort?.category, 'thought_level')
  assert.equal(effort?.type === 'select' && effort.currentValue, 'high')
  const lite = configOptions({ catalog, model: { provider: 'deepseek', model: 'v4-lite' } }).find(option => option.id === 'reasoning_effort')
  assert.deepEqual(lite?.type === 'select' && lite.options.map(item => 'value' in item ? item.value : ''), ['default', 'high'], 'no declared default adds one')
  assert.equal(lite?.type === 'select' && lite.currentValue, 'default')
  const gateway = configOptions({ catalog, model: { provider: 'gateway', model: 'org/model' } })
  assert.equal(gateway.some(option => option.id === 'reasoning_effort'), false, 'models without efforts have no effort option')
  const unknown = configOptions({ catalog, model: { provider: 'other', model: 'x' } }).find(option => option.id === 'model')
  assert.equal(unknown?.type === 'select' && JSON.stringify(unknown.options).includes('other/x'), true, 'the current model stays selectable')
})

test('permission, preset, plan and team options', () => {
  const options = configOptions({
    permission: { choices: [{ id: 'workspace-write', name: '工作区可写' }], current: 'workspace-write' },
    preset: { choices: [{ id: 'standard', name: '标准' }, { id: 'minimal', name: '极简' }], current: 'minimal' },
    plan: { active: true, booleanOptions: false },
    team: { active: false, booleanOptions: false },
  })
  assert.deepEqual(options.map(option => [option.id, option.category ?? null]),
    [['permission', 'mode'], ['agent_preset', null], ['plan_mode', null], ['agent_team', null]])
  const plan = options.find(option => option.id === 'plan_mode')
  assert.equal(plan?.type === 'select' && plan.currentValue, 'on', 'clients without boolean options get a select')
  const team = options.find(option => option.id === 'agent_team')
  assert.equal(team?.type === 'select' && team.currentValue, 'off')
  assert.match(team?.description ?? '', /缓存/u, 'the switch warns about cache reuse, as DSH Desktop asks before disabling it')
  const boolean = configOptions({ plan: { active: false, booleanOptions: true } })[0]
  assert.deepEqual(boolean && { type: boolean.type, value: boolean.currentValue }, { type: 'boolean', value: false })
  assert.equal(switchValue('on'), true)
  assert.equal(switchValue(false), false)
  assert.equal(switchValue('maybe'), undefined)
})

test('model values and effort carry-over', () => {
  assert.deepEqual(findModel(catalog, 'gateway/org/model')?.entry.id, 'org/model', 'only the first slash separates the provider')
  assert.equal(findModel(catalog, 'deepseek/missing'), undefined)
  assert.equal(findModel(catalog, '/v4'), undefined)
  const v4 = findModel(catalog, 'deepseek/v4')!.entry
  assert.equal(carriedEffort(v4, 'high'), 'high')
  assert.equal(carriedEffort(v4, 'max'), 'low', 'an unsupported effort falls back to the default')
})

test('launchers quote paths and set Electron node mode only when needed', () => {
  const posix = launcherScript({ runtime: "/Applications/DSH it's.app/Contents/MacOS/DSH", electron: true, script: '/p/lib/stdio.js' }, 'darwin')
  assert.match(posix, /^#!\/bin\/sh\n/u)
  assert.match(posix, /ELECTRON_RUN_AS_NODE=1 exec '\/Applications\/DSH it'\\''s\.app\/Contents\/MacOS\/DSH' '\/p\/lib\/stdio\.js' "\$@"/u)
  assert.doesNotMatch(launcherScript({ runtime: '/usr/bin/node', electron: false, script: '/s.js' }, 'linux'), /ELECTRON/u)
  const windows = launcherScript({ runtime: 'C:\\Program Files\\DSH\\DSH.exe', electron: true, script: 'C:\\Users\\a%b\\stdio.js' }, 'win32')
  assert.match(windows, /\r\nset ELECTRON_RUN_AS_NODE=1\r\n/u)
  assert.match(windows, /"C:\\Program Files\\DSH\\DSH\.exe" "C:\\Users\\a%%b\\stdio\.js" %\*/u)
})

test('endpoint records are validated and endpoints fit platform limits', () => {
  const record = { version: 1, protocol: 'meshcall', service: RPC_SERVICE, instanceId: 'abc', pid: 42, startedAt: '2026-11-17T00:00:00.000Z',
    endpoint: { unixPath: '/h/s.sock' }, token: 't'.repeat(43), bridgeVersion: '1.0.0' }
  assert.equal(parseRecord(JSON.stringify(record))?.instanceId, 'abc')
  assert.equal(parseRecord(JSON.stringify({ ...record, token: 'short' })), undefined)
  assert.equal(parseRecord(JSON.stringify({ ...record, service: 'other' })), undefined)
  assert.equal(parseRecord(JSON.stringify({ ...record, pid: -1 })), undefined)
  assert.equal(parseRecord('not json'), undefined)
  const launcher = { runtime: '/Applications/D.app/Contents/MacOS/D', electron: true, script: '/p/lib/stdio.js' }
  assert.deepEqual(parseRecord(JSON.stringify({ ...record, launcher }))?.launcher, launcher, 'a record says what its launcher runs')
  const malformed = parseRecord(JSON.stringify({ ...record, launcher: { runtime: '/x', electron: 'yes', script: '/p/lib/stdio.js' } }))
  assert.equal(malformed?.instanceId, 'abc', 'a malformed optional field does not cost the record')
  assert.equal(malformed !== undefined && 'launcher' in malformed, false)
  const id = '0123456789abcdef-0123-4567-89ab-cdef01234567'
  assert.equal(homeSocket('/home/me/.agents-anywhere/dsh-acp', id), '/home/me/.agents-anywhere/dsh-acp/sockets/0123456789abcdef.sock')
  assert.equal(homeSocket(`/home/${'x'.repeat(120)}`, id), undefined, 'a path past sockaddr_un moves to a fresh temporary directory')
  assert.deepEqual(pipeEndpoint(id), { pipe: '\\\\.\\pipe\\agents-anywhere-dsh-acp-0123456789abcdef' })
})

test('an endpoint proves it holds the token without seeing it sent', () => {
  const proof = endpointProof('token-a'.repeat(8), 'nonce-123456789012')
  assert.equal(validProof('token-a'.repeat(8), 'nonce-123456789012', proof), true)
  assert.equal(validProof('token-b'.repeat(8), 'nonce-123456789012', proof), false, 'another token')
  assert.equal(validProof('token-a'.repeat(8), 'nonce-other-12345678', proof), false, 'a replayed answer')
  assert.equal(validProof('token-a'.repeat(8), 'nonce-123456789012', 42), false)
})
