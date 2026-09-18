import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopRendererActionDispatcher,
  type DesktopRendererActionHandlers,
} from '../src/renderer-actions-dispatch.ts'

function fixture(overrides: Partial<DesktopRendererActionHandlers> = {}) {
  const logError = vi.fn()
  const actions: DesktopRendererActionHandlers = {
    openTerminal: vi.fn(),
    restart: vi.fn(async () => {}),
    restartToRecovery: vi.fn(async () => {}),
    reload: vi.fn(),
    developerTools: vi.fn(),
    checkForUpdates: vi.fn(async () => {}),
    exportDiagnostics: vi.fn(async () => {}),
    ...overrides,
  }
  return { actions, logError, dispatch: createDesktopRendererActionDispatcher(actions, logError) }
}

/** Let one setImmediate-deferred action run. */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => { setImmediate(resolve) })
  await Promise.resolve()
}

describe('desktop renderer action dispatch', () => {
  it.each([
    ['terminal', 'openTerminal'],
    ['developer', 'developerTools'],
  ] as const)('runs %s before acknowledging the renderer', async (action, method) => {
    const { actions, dispatch } = fixture()
    await expect(dispatch(action)).resolves.toBeUndefined()
    expect(actions[method]).toHaveBeenCalledOnce()
  })

  it.each([
    ['diagnostics', 'exportDiagnostics'],
    ['check-for-updates', 'checkForUpdates'],
  ] as const)('awaits %s so the renderer can report its outcome', async (action, method) => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const { actions, dispatch } = fixture({ [method]: vi.fn(() => pending) })
    let settled = false
    const operation = dispatch(action).then(() => { settled = true })
    await settle()
    expect(actions[method]).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    release()
    await expect(operation).resolves.toBeUndefined()
  })

  it.each([
    ['restart', 'restart'],
    ['restart-recovery', 'restartToRecovery'],
    ['reload', 'reload'],
  ] as const)('acknowledges %s before the renderer loses its document', async (action, method) => {
    const { actions, dispatch } = fixture()
    await expect(dispatch(action)).resolves.toBeUndefined()
    expect(actions[method]).not.toHaveBeenCalled()
    await settle()
    expect(actions[method]).toHaveBeenCalledOnce()
  })

  it('logs a deferred failure instead of rejecting the acknowledged action', async () => {
    const { dispatch, logError } = fixture({
      restart: vi.fn(async () => { throw new Error('relaunch refused') }),
    })
    await expect(dispatch('restart')).resolves.toBeUndefined()
    await settle()
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      'dsh-plugin-desktop: failed to restart Desktop: relaunch refused',
    )
  })

  it('rejects an awaited action failure for the renderer to surface', async () => {
    const { dispatch, logError } = fixture({
      exportDiagnostics: vi.fn(async () => { throw new Error('export refused') }),
    })
    await expect(dispatch('diagnostics')).rejects.toThrow('export refused')
    expect(logError).not.toHaveBeenCalled()
  })

  it('rejects a synchronous action failure for the renderer to surface', async () => {
    const { dispatch } = fixture({
      openTerminal: vi.fn(() => { throw new Error('terminal profile is not configured') }),
    })
    await expect(dispatch('terminal')).rejects.toThrow('terminal profile is not configured')
  })

  it.each([undefined, null, '', 'quit', 'state', 42, { action: 'restart' }])(
    'rejects the unsupported action %o',
    async (action) => {
      const { actions, dispatch } = fixture()
      await expect(dispatch(action)).rejects.toThrow('unsupported Desktop renderer action')
      await settle()
      expect(actions.restart).not.toHaveBeenCalled()
      expect(actions.openTerminal).not.toHaveBeenCalled()
    },
  )
})
