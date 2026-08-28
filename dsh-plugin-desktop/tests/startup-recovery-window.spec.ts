import { describe, expect, it, vi } from 'vitest'
import {
  DesktopStartupRecoveryControllerError,
  type DesktopStartupRecoveryController,
} from '../src/startup-recovery-controller.ts'
import {
  desktopStartupRecoveryWindowBounds,
  parseDesktopStartupRecoveryAction,
  DesktopStartupRecoveryWindow,
  type DesktopStartupRecoveryScreenApi,
} from '../src/startup-recovery-window.ts'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  screen: {},
  shell: {},
}))

const desktopDialog = vi.hoisted(() => ({
  show: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
  showDetailed: vi.fn(async () => ({ response: 0 })),
}))

vi.mock('../src/desktop-dialog-window.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/desktop-dialog-window.ts')>(),
  showDesktopDialog: desktopDialog.showDetailed,
  showDesktopMessageBox: desktopDialog.show,
}))

describe('Desktop startup recovery confirmations', () => {
  it('executes a plugin mutation only after the Desktop dialog accepts its preview', async () => {
    desktopDialog.show.mockClear()
    const previewUninstall = vi.fn(async () => ({
      previewId: 'preview-uninstall-0001',
      bundleId: 'bundle-uninstall-0001',
      packageName: 'example-plugin',
    }))
    const executeUninstall = vi.fn(async () => ({ packageName: 'example-plugin' }))
    const controller = {
      previewUninstall,
      executeUninstall,
      snapshot: vi.fn(async () => ({ profileName: 'desktop', bundles: [] })),
    } as unknown as DesktopStartupRecoveryController
    const recovery = new DesktopStartupRecoveryWindow({
      controller,
      locale: 'en',
      failureStage: 'profile-composition',
      failureDetail: 'plugin failed',
      exportDiagnostics: async () => '/tmp/diagnostics.zip',
    })
    const parent = { isDestroyed: () => false, loadFile: vi.fn(async () => {}) }
    ;(recovery as unknown as { window: typeof parent }).window = parent

    await (recovery as unknown as {
      handleAction: (action: { readonly action: string; readonly id: string }) => Promise<void>
    }).handleAction({ action: 'preview-uninstall', id: 'bundle-uninstall-0001' })

    expect(desktopDialog.show).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      title: 'Uninstall this plugin?',
      buttons: ['Uninstall', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    }), parent)
    expect(previewUninstall).toHaveBeenCalledWith('bundle-uninstall-0001')
    expect(executeUninstall).toHaveBeenCalledWith('preview-uninstall-0001')
  })

  it('opens a detailed Desktop window when checkpoint rollback fails', async () => {
    desktopDialog.show.mockClear()
    desktopDialog.showDetailed.mockClear()
    const previewCheckpointRestore = vi.fn(async () => ({
      previewId: 'preview-checkpoint-0001',
      slotId: 'slot-1' as const,
      capturedAt: '2026-08-25T00:00:00.000Z',
      expiresAt: '2026-08-25T00:05:00.000Z',
    }))
    const executeCheckpointRestore = vi.fn(async () => {
      throw new DesktopStartupRecoveryControllerError(
        'operation-failed',
        'The checkpoint files were restored, but Profile dependencies could not be rebuilt.',
        {
          operationStage: 'dependency-materialization',
          diagnosticDetail: 'Exit code: 1\n\nstderr:\nERR_PNPM_OUTDATED_LOCKFILE',
        },
      )
    })
    const controller = {
      previewCheckpointRestore,
      executeCheckpointRestore,
      snapshot: vi.fn(async () => ({ profileName: 'desktop', bundles: [], checkpoints: [] })),
    } as unknown as DesktopStartupRecoveryController
    const recovery = new DesktopStartupRecoveryWindow({
      controller,
      locale: 'zh',
      failureStage: 'profile-composition',
      failureDetail: 'rollback failure test',
      exportDiagnostics: async () => '/tmp/diagnostics.zip',
    })
    const parent = { isDestroyed: () => false, loadFile: vi.fn(async () => {}) }
    ;(recovery as unknown as { window: typeof parent }).window = parent

    await (recovery as unknown as {
      handleAction: (action: { readonly action: string; readonly id: string }) => Promise<void>
    }).handleAction({ action: 'preview-checkpoint', id: 'slot-1' })

    expect(desktopDialog.showDetailed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: '回滚失败',
      presentation: 'diagnostic',
      buttons: ['关闭'],
      detail: expect.stringContaining('ERR_PNPM_OUTDATED_LOCKFILE'),
    }), parent)
  })

  it('opens a detailed Desktop window when dsh plugin uninstall fails', async () => {
    desktopDialog.show.mockClear()
    desktopDialog.showDetailed.mockClear()
    const controller = {
      previewUninstall: vi.fn(async () => ({
        previewId: 'preview-uninstall-failure-0001',
        packageName: 'example-plugin',
        expiresAt: '2026-08-25T00:05:00.000Z',
      })),
      executeUninstall: vi.fn(async () => {
        throw new DesktopStartupRecoveryControllerError(
          'operation-failed',
          'The plugin could not be removed from the current Profile.',
          { operationStage: 'plugin-change', diagnosticDetail: 'dsh plugin remove exited 7' },
        )
      }),
      snapshot: vi.fn(async () => ({ profileName: 'desktop', bundles: [], checkpoints: [] })),
    } as unknown as DesktopStartupRecoveryController
    const recovery = new DesktopStartupRecoveryWindow({
      controller,
      locale: 'en',
      failureStage: 'profile-composition',
      failureDetail: 'plugin uninstall failure test',
      exportDiagnostics: async () => '/tmp/diagnostics.zip',
    })
    const parent = { isDestroyed: () => false, loadFile: vi.fn(async () => {}) }
    ;(recovery as unknown as { window: typeof parent }).window = parent

    await (recovery as unknown as {
      handleAction: (action: { readonly action: string; readonly id: string }) => Promise<void>
    }).handleAction({ action: 'preview-uninstall', id: 'bundle-uninstall-0001' })

    expect(desktopDialog.showDetailed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'Plugin uninstall failed',
      presentation: 'diagnostic',
      detail: expect.stringContaining('dsh plugin remove exited 7'),
    }), parent)
  })

  it('does not open an extra window after a successful checkpoint rollback', async () => {
    desktopDialog.show.mockClear()
    desktopDialog.showDetailed.mockClear()
    const controller = {
      previewCheckpointRestore: vi.fn(async () => ({
        previewId: 'preview-checkpoint-0002',
        slotId: 'slot-2' as const,
        capturedAt: '2026-08-25T00:00:00.000Z',
        expiresAt: '2026-08-25T00:05:00.000Z',
      })),
      executeCheckpointRestore: vi.fn(async () => ({
        action: 'restore-checkpoint' as const,
        slotId: 'slot-2' as const,
        changedFiles: ['package.json'],
      })),
      snapshot: vi.fn(async () => ({ profileName: 'desktop', bundles: [], checkpoints: [] })),
    } as unknown as DesktopStartupRecoveryController
    const recovery = new DesktopStartupRecoveryWindow({
      controller,
      locale: 'en',
      failureStage: 'profile-composition',
      failureDetail: 'rollback success test',
      exportDiagnostics: async () => '/tmp/diagnostics.zip',
    })
    const parent = { isDestroyed: () => false, loadFile: vi.fn(async () => {}) }
    ;(recovery as unknown as { window: typeof parent }).window = parent

    await (recovery as unknown as {
      handleAction: (action: { readonly action: string; readonly id: string }) => Promise<void>
    }).handleAction({ action: 'preview-checkpoint', id: 'slot-2' })

    expect(desktopDialog.showDetailed).not.toHaveBeenCalled()
  })

  it('delivers a recovery notice to the renderer exactly once', async () => {
    const recovery = new DesktopStartupRecoveryWindow({
      locale: 'zh',
      failureStage: 'health-commit',
      failureDetail: 'notice test',
      exportDiagnostics: async () => '/tmp/diagnostics.zip',
    })
    const loadFile = vi.fn(async (
      _path: string,
      _options: { readonly query: { readonly state: string } },
    ) => {})
    const browser = { isDestroyed: () => false, loadFile }
    const privateRecovery = recovery as unknown as {
      window: typeof browser
      notice: { readonly tone: 'success'; readonly title: string; readonly body: string } | undefined
      render: () => Promise<void>
    }
    privateRecovery.window = browser
    privateRecovery.notice = { tone: 'success', title: 'slot-1', body: 'restored' }

    await privateRecovery.render()
    await privateRecovery.render()

    const states = browser.loadFile.mock.calls.map(([, options]) => JSON.parse(
      Buffer.from(options.query.state, 'base64url').toString('utf8'),
    ) as { readonly notice?: unknown })
    expect(states[0]!.notice).toEqual({ tone: 'success', title: 'slot-1', body: 'restored' })
    expect(states[1]!.notice).toBeUndefined()
  })
})

describe('Desktop startup recovery diagnostics export', () => {
  function recoveryWindow(exportDiagnostics: (signal: AbortSignal) => Promise<string>): DesktopStartupRecoveryWindow {
    return new DesktopStartupRecoveryWindow({
      locale: 'zh',
      failureStage: 'profile-composition',
      failureDetail: 'diagnostic export test',
      exportDiagnostics,
    })
  }

  function handleAction(window: DesktopStartupRecoveryWindow): (action: { readonly action: string }) => Promise<void> {
    return (window as unknown as {
      handleAction: (action: { readonly action: string }) => Promise<void>
    }).handleAction.bind(window)
  }

  function finish(window: DesktopStartupRecoveryWindow, result: 'restart' | 'quit'): void {
    (window as unknown as { finish: (value: 'restart' | 'quit') => void }).finish(result)
  }

  function deferred<T>(): {
    readonly promise: Promise<T>
    readonly resolve: (value: T) => void
    readonly reject: (cause: unknown) => void
  } {
    let resolve!: (value: T) => void
    let reject!: (cause: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  it('shares an in-flight export and reuses the saved result', async () => {
    const task = deferred<string>()
    const exportDiagnostics = vi.fn(() => task.promise)
    const window = recoveryWindow(exportDiagnostics)
    const runAction = handleAction(window)

    const first = runAction({ action: 'export-diagnostics' })
    await vi.waitFor(() => expect(exportDiagnostics).toHaveBeenCalledOnce())
    const second = runAction({ action: 'export-diagnostics' })

    await Promise.resolve()
    expect(exportDiagnostics).toHaveBeenCalledOnce()
    task.resolve('C:\\Temp\\diagnostics.zip')
    await Promise.all([first, second])

    await runAction({ action: 'export-diagnostics' })
    expect(exportDiagnostics).toHaveBeenCalledOnce()
  })

  it('clears a failed export task so the next attempt can retry', async () => {
    const firstTask = deferred<string>()
    const secondTask = deferred<string>()
    const exportDiagnostics = vi.fn()
      .mockImplementationOnce(() => firstTask.promise)
      .mockImplementationOnce(() => secondTask.promise)
    const window = recoveryWindow(exportDiagnostics)
    const runAction = handleAction(window)

    const first = runAction({ action: 'export-diagnostics' })
    await vi.waitFor(() => expect(exportDiagnostics).toHaveBeenCalledOnce())
    firstTask.reject(new Error('archive unavailable'))
    await first

    const retry = runAction({ action: 'export-diagnostics' })
    await vi.waitFor(() => expect(exportDiagnostics).toHaveBeenCalledTimes(2))
    secondTask.resolve('C:\\Temp\\diagnostics-retry.zip')
    await retry
  })

  it('cancels the in-flight export when the recovery window generation ends', async () => {
    let exportSignal: AbortSignal | undefined
    const exportDiagnostics = vi.fn(async (signal: AbortSignal) => {
      exportSignal = signal
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'))
        }, { once: true })
      })
      return 'unreachable.zip'
    })
    const window = recoveryWindow(exportDiagnostics)
    const pending = handleAction(window)({ action: 'export-diagnostics' })
    await vi.waitFor(() => expect(exportDiagnostics).toHaveBeenCalledOnce())

    finish(window, 'restart')

    await pending
    expect(exportSignal?.aborted).toBe(true)
  })
})

describe('Desktop startup recovery window bounds', () => {
  function screenApi(
    current: { readonly width: number; readonly height: number } | Error,
    primary: { readonly width: number; readonly height: number } = { width: 1920, height: 1040 },
  ): DesktopStartupRecoveryScreenApi & {
    readonly getCursorScreenPoint: ReturnType<typeof vi.fn>
    readonly getDisplayNearestPoint: ReturnType<typeof vi.fn>
    readonly getPrimaryDisplay: ReturnType<typeof vi.fn>
  } {
    const getCursorScreenPoint = vi.fn(() => ({ x: 120, y: 80 }))
    const getDisplayNearestPoint = vi.fn(() => {
      if (current instanceof Error) throw current
      return { workAreaSize: current }
    })
    const getPrimaryDisplay = vi.fn(() => ({ workAreaSize: primary }))
    return { getCursorScreenPoint, getDisplayNearestPoint, getPrimaryDisplay }
  }

  it('uses the 800x760 default on a spacious current display', () => {
    const electronScreen = screenApi({ width: 1440, height: 900 })

    expect(desktopStartupRecoveryWindowBounds(electronScreen)).toEqual({
      width: 800,
      height: 760,
      minWidth: 680,
      minHeight: 560,
    })
    expect(electronScreen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 120, y: 80 })
    expect(electronScreen.getPrimaryDisplay).not.toHaveBeenCalled()
  })

  it('subtracts 48px and clamps each dimension to the current work area', () => {
    const bounds = desktopStartupRecoveryWindowBounds(screenApi({ width: 760, height: 640 }))

    expect(bounds).toEqual({
      width: 712,
      height: 592,
      minWidth: 680,
      minHeight: 560,
    })
    expect(bounds.width).toBeLessThanOrEqual(760)
    expect(bounds.height).toBeLessThanOrEqual(640)
  })

  it('lowers native minimums safely for very small work areas', () => {
    const bounds = desktopStartupRecoveryWindowBounds(screenApi({ width: 480, height: 320 }))

    expect(bounds).toEqual({
      width: 432,
      height: 272,
      minWidth: 432,
      minHeight: 272,
    })
    expect(bounds.minWidth).toBeLessThanOrEqual(bounds.width)
    expect(bounds.minHeight).toBeLessThanOrEqual(bounds.height)
  })

  it('falls back to the primary display when the current display cannot be read', () => {
    const electronScreen = screenApi(new Error('screen unavailable'), { width: 700, height: 600 })

    expect(desktopStartupRecoveryWindowBounds(electronScreen)).toEqual({
      width: 652,
      height: 552,
      minWidth: 652,
      minHeight: 552,
    })
    expect(electronScreen.getPrimaryDisplay).toHaveBeenCalledOnce()
  })
})

describe('Desktop startup recovery action parser', () => {
  it('accepts only known actions with the expected id shape', () => {
    for (const action of [
      'export-diagnostics',
      'show-diagnostics',
      'open-settings-document',
      'open-profile-patch',
      'open-profile-manifest',
      'open-profile-directory',
      'open-terminal',
      'open-profile-creator',
      'restart',
      'quit',
    ]) {
      expect(parseDesktopStartupRecoveryAction(`dsh-recovery://${action}`)).toEqual({ action })
    }

    expect(parseDesktopStartupRecoveryAction(
      'dsh-recovery://preview-uninstall?id=opaque-id_0001',
    )).toEqual({ action: 'preview-uninstall', id: 'opaque-id_0001' })
    for (const action of ['preview-checkpoint', 'open-checkpoint']) {
      expect(parseDesktopStartupRecoveryAction(
        `dsh-recovery://${action}?id=slot-2`,
      )).toEqual({ action, id: 'slot-2' })
    }
  })

  it.each([
    'not a url',
    'https://restart',
    'dsh-recovery://unknown',
    'dsh-recovery://home/',
    'dsh-recovery://user:password@home',
    'dsh-recovery://home:1234',
    'dsh-recovery://home#fragment',
    'dsh-recovery://home?id=unexpected',
    'dsh-recovery://home?extra=value',
    'dsh-recovery://preview-uninstall',
    'dsh-recovery://preview-uninstall?id=short',
    'dsh-recovery://preview-uninstall?id=opaque-id_0001&id=opaque-id_0002',
    'dsh-recovery://preview-uninstall?id=opaque-id_0001&extra=value',
    `dsh-recovery://preview-uninstall?id=${'x'.repeat(161)}`,
  ])('rejects invalid or over-privileged navigation: %s', href => {
    expect(parseDesktopStartupRecoveryAction(href)).toBeUndefined()
  })
})
