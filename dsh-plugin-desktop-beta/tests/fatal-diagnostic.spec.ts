import { inspect } from 'node:util'
import { StartupError } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'
import { formatFatalDiagnostic, MAX_FATAL_DIAGNOSTIC_CHARS } from '../src/host/fatal-diagnostic.ts'
import { startupCompositionDiagnostic } from '../src/upstream-family.ts'

function startupError(message = 'dsh-plugin-desktop-beta: startup failed: 1 required plugin did not activate'): StartupError {
  const error = new StartupError(message, [
    { id: 'agent', module: '@deepseek-ai/dsh-agent', required: true, fiberState: undefined, outcome: { kind: 'pending', missing: ['llm'] } },
  ])
  error.startup = { configurationPath: '/profiles/desktop/cordis.yml', messages: [{ ts: 1, name: 'loader', type: 'error', args: ['apiKey: sk-from-plugin-config'] }] }
  return error
}

it('renders the startup metadata that inspect omits, but not the startup log arguments', () => {
  const error = startupError()
  expect(inspect(error)).not.toContain('cordis.yml')
  const text = formatFatalDiagnostic(error, () => [])
  expect(text.startsWith(inspect(error, { depth: 4, maxArrayLength: 50 }))).toBe(true)
  expect(text).toContain('Configuration file: /profiles/desktop/cordis.yml')
  expect(text).toContain('--- startup entries ---')
  expect(text).toContain("missing: [ 'llm' ]")
  expect(text).not.toContain('sk-from-plugin-config')
})

it.runIf(startupCompositionDiagnostic)('lists a recorded composition with its plugin sources indexed', () => {
  // What dsh 0.2.2 records before it disposes a failed startup.
  const composition = {
    plugins: [
      { id: 'agent', module: '@deepseek-ai/dsh-agent', version: '0.2.2', state: 'pending', source: 'file:///profile/', missing: ['llm'] },
      { id: 'llm', module: '@deepseek-ai/dsh-llm', version: '0.2.2', state: 'failed', source: 'file:///profile/', missing: [] },
      { id: 'web', module: '@deepseek-ai/dsh-web', version: '0.2.2', state: 'active', source: 'file:///app/', missing: [] },
    ],
    services: [{ consumer: 'agent', service: 'llm', providers: [{ entry: 'llm', state: 'failed', visibility: 'same-scope' }] }],
    omittedPlugins: 0,
    omittedServices: 0,
  }
  const text = formatFatalDiagnostic(Object.assign(startupError(), { composition }))
  expect(text).toContain('--- startup composition ---')
  expect(text).toContain('{"consumer":"agent","service":"llm","providers":[{"entry":"llm","state":"failed","visibility":"same-scope"}]}')
  expect(text).toContain('{"index":1,"source":"file:///app/"}')
  expect(text).toContain('{"id":"web","module":"@deepseek-ai/dsh-web","version":"0.2.2","state":"active","missing":[],"sourceIndex":1}')
  expect(text).not.toContain('Startup composition diagnostic unavailable.')
  expect(formatFatalDiagnostic(startupError())).toContain('Startup composition diagnostic unavailable.')
})

it.skipIf(startupCompositionDiagnostic)('adds no composition section where the followed DSH release records none', () => {
  const error = startupError()
  expect(formatFatalDiagnostic(error)).toBe(formatFatalDiagnostic(error, () => []))
})

it('finds a startup failure behind a failed cleanup and leaves other errors inspected', () => {
  const plain = new Error('Next Host requires runtime, profile, home and IPC')
  expect(formatFatalDiagnostic(plain)).toBe(inspect(plain, { depth: 4, maxArrayLength: 50 }))
  const text = formatFatalDiagnostic(new AggregateError([startupError(), new Error('cleanup failed')], 'dsh: profile startup and cleanup failed'), () => [])
  expect(text).toContain('Configuration file: /profiles/desktop/cordis.yml')
})

it('bounds the original error, the startup entries and the whole diagnostic with explicit notices', () => {
  const error = new StartupError('m'.repeat(10_000), Array.from({ length: 200 }, (_, index) => (
    { id: `plugin-${String(index)}`, module: `module-${String(index)}`, required: false, fiberState: undefined, outcome: { kind: 'pending' as const, missing: ['service'] } })))
  const sections = formatFatalDiagnostic(error, () => [])
  expect(sections).toContain('… (original error truncated at 8192 characters)')
  expect(sections).toContain('… (startup entries truncated at 8192 characters)')
  const text = formatFatalDiagnostic(error, () => Array.from({ length: 256 }, (_, index) => `plugin-${String(index)} ${'m'.repeat(300)}`))
  expect(text.length).toBeLessThanOrEqual(MAX_FATAL_DIAGNOSTIC_CHARS)
  expect(text.endsWith('… (Host diagnostic truncated at 65536 characters)')).toBe(true)
})
