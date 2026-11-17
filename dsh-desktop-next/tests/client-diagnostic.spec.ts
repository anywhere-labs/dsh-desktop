import { expect, it } from 'vitest'
import { clientDiagnosticRecord, MAX_CLIENT_NAME_CHARS, MAX_CLIENT_TEXT_CHARS, parseClientDiagnostic } from '../src/client-diagnostic.ts'

const error = { name: 'TypeError', message: 'render failed', stack: 'TypeError: render failed\n    at Panel' }

it('accepts the report kinds within their limits and maps them to Desktop log records', () => {
  const crash = { kind: 'slot-crash', slot: 'sidebar.footer.action', plugin: 'dsh-wallpaper-engine', abdicated: true, error }
  expect(clientDiagnosticRecord(parseClientDiagnostic(crash)!)).toEqual({ source: 'renderer.client', event: 'slot.crashed', level: 'error',
    message: 'TypeError: render failed', fields: { slot: 'sidebar.footer.action', plugin: 'dsh-wallpaper-engine', abdicated: true }, error })
  const log = { kind: 'log', level: 'warn', logger: 'loader', entry: null, message: 'entry failed', sn: 7 }
  expect(clientDiagnosticRecord(parseClientDiagnostic(log)!)).toEqual({ source: 'renderer.client', event: 'log', level: 'warn', message: 'entry failed', fields: { logger: 'loader', entry: null } })
  expect(clientDiagnosticRecord(parseClientDiagnostic({ kind: 'uncaught', rejection: true, error })!)).toMatchObject({ event: 'unhandled-rejection', level: 'error', message: 'TypeError: render failed' })
  expect(clientDiagnosticRecord(parseClientDiagnostic({ kind: 'uncaught', rejection: false, error })!)).toMatchObject({ event: 'uncaught-error' })
  expect(clientDiagnosticRecord(parseClientDiagnostic({ kind: 'dropped', count: 4 })!)).toEqual({ source: 'renderer.client', event: 'reports.dropped', level: 'warn', fields: { count: 4 } })
  expect(clientDiagnosticRecord(parseClientDiagnostic({ kind: 'ready' })!)).toBeUndefined()
})

it('refuses unknown kinds, wrong types and oversized text', () => {
  for (const value of [
    null, 'ready', { kind: 'secret' }, { kind: 'dropped', count: -1 },
    { kind: 'log', level: 'info', logger: 'loader', entry: null, message: 'x', sn: 1 },
    { kind: 'log', level: 'warn', logger: 'loader', entry: null, message: 'x'.repeat(MAX_CLIENT_TEXT_CHARS + 1), sn: 1 },
    { kind: 'slot-crash', slot: 'x'.repeat(MAX_CLIENT_NAME_CHARS + 1), plugin: null, abdicated: false, error },
    { kind: 'slot-crash', slot: 'slot', plugin: 7, abdicated: false, error },
    { kind: 'uncaught', rejection: 'yes', error },
    { kind: 'uncaught', rejection: false, error: { name: 'Error', message: 'no stack' } },
  ]) expect(parseClientDiagnostic(value)).toBeUndefined()
})
