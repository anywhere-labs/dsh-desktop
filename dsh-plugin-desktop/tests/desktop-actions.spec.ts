import { Context } from '@deepseek-ai/cordis'
import { openNativePath, revealNativePath, runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopActionsService, { type DesktopActionsBootstrap } from '../src/desktop-actions.ts'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'
import { apply, inject, name } from '../src/terminal.ts'

const fixture = vi.hoisted(() => ({ execFile: vi.fn(), error: null as Error | null }))

vi.mock('node:child_process', () => ({ execFile: fixture.execFile }))

beforeEach(() => {
  fixture.error = null
  fixture.execFile.mockReset().mockImplementation((_command, _args, _options, callback) => {
    callback(fixture.error, '', '')
  })
})

async function mount(bootstrap: DesktopActionsBootstrap): Promise<{
  readonly ctx: Context
  readonly service: DesktopActionsService
  dispose(): Promise<unknown>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(DesktopActionsService, bootstrap)
  await fiber
  return { ctx, service: ctx.desktopActions as DesktopActionsService, dispose: fiber.dispose }
}

describe('desktop actions Host service', () => {
  it('exposes only no-argument terminal and restart operations', async () => {
    const openTerminal = vi.fn<() => void>()
    const requestRestart = vi.fn<() => Promise<void>>(async () => {})
    const mounted = await mount({ openTerminal, requestRestart })

    mounted.service.openTerminal()
    await expect(mounted.service.requestRestart()).resolves.toBeUndefined()

    expect(openTerminal).toHaveBeenCalledWith()
    expect(requestRestart).toHaveBeenCalledWith()
    expect(Object.keys(mounted.service).sort()).not.toContain('runCommand')
  })

  it('coalesces a restart request and rejects retained references after disposal', async () => {
    let finishRestart!: () => void
    const requestRestart = vi.fn(() => new Promise<void>(resolve => { finishRestart = resolve }))
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart })

    const first = mounted.service.requestRestart()
    const second = mounted.service.requestRestart()
    expect(second).toBe(first)
    expect(requestRestart).toHaveBeenCalledOnce()
    await mounted.dispose()
    expect(() => mounted.service.openTerminal()).toThrow(/service disposed/u)
    await expect(mounted.service.requestRestart()).rejects.toThrow(/service disposed/u)

    finishRestart()
    await expect(first).resolves.toBeUndefined()
  })
})

describe('desktop terminal Host plugin', () => {
  it('owns an effect-scoped tray command that opens the configured terminal', () => {
    let trayItem: DesktopTrayItem | undefined
    let disposeEffect: (() => void) | undefined
    const openTerminal = vi.fn()
    const disposeRegistration = vi.fn()
    let locale: DesktopRuntime['locale'] = 'en'
    const runtime = {
      platform: 'darwin',
      get locale() { return locale },
      openTerminal,
      registerTrayItem: (item: DesktopTrayItem) => {
        trayItem = item
        return { refresh: () => {}, dispose: disposeRegistration }
      },
    } as unknown as DesktopRuntime
    const ctx = {
      desktopRuntime: runtime,
      effect: (register: () => (() => void)) => {
        disposeEffect = register()
        return disposeEffect
      },
    } as unknown as Context

    apply(ctx)

    expect(name).toBe('desktop-terminal')
    expect(inject).toEqual(['desktopRuntime'])
    expect(trayItem).toMatchObject({ group: 'tools', order: 10 })
    expect(trayItem?.label()).toBe('Open DSH Terminal')
    locale = 'zh'
    expect(trayItem?.label()).toBe('打开 DSH 终端')
    trayItem?.invoke()
    expect(openTerminal).toHaveBeenCalledOnce()

    disposeEffect?.()
    expect(disposeRegistration).toHaveBeenCalledOnce()
  })

  it('fails loud if a Linux profile activates the unsupported terminal row', () => {
    const ctx = {
      desktopRuntime: { platform: 'linux' },
    } as unknown as Context

    expect(() => apply(ctx)).toThrow('supported on macOS and Windows')
  })
})

describe('native path opener', () => {
  it('opens Windows workspace directories without hiding Explorer', async () => {
    const signal = new AbortController().signal
    await openNativePath('C:\\项目 workspace\\repo', signal, { platform: 'win32' })
    expect(fixture.execFile).toHaveBeenCalledWith('explorer.exe', ['file:///C:/项目%20workspace/repo'],
      { encoding: 'utf8', signal, windowsHide: false }, expect.any(Function))
  })

  it('reveals Windows files without hiding Explorer', async () => {
    await revealNativePath('C:\\workspace\\file.txt', new AbortController().signal, { platform: 'win32' })
    expect(fixture.execFile).toHaveBeenCalledWith('explorer.exe', ['/select,', 'file:///C:/workspace/file.txt'],
      expect.objectContaining({ windowsHide: false }), expect.any(Function))
  })

  it('keeps GUI launchers visible', async () => {
    await runNativeCommand('explorer.exe', [], new AbortController().signal, 'visible')
    expect(fixture.execFile).toHaveBeenCalledWith('explorer.exe', [],
      expect.objectContaining({ windowsHide: false }), expect.any(Function))
  })

  it.each(['powershell.exe', 'reg.exe', 'wslpath'])(
    'still hides background commands: %s', async command => {
      await runNativeCommand(command, [], new AbortController().signal, 'hidden')
      expect(fixture.execFile).toHaveBeenCalledWith(command, [],
        expect.objectContaining({ windowsHide: true }), expect.any(Function))
    },
  )

  it('accepts Explorer handoff exit 1 but preserves other launch errors', async () => {
    fixture.error = Object.assign(new Error('delegated'), { code: 1 })
    await expect(openNativePath('C:\\workspace', new AbortController().signal, { platform: 'win32' })).resolves.toBeUndefined()
    fixture.error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    await expect(openNativePath('C:\\workspace', new AbortController().signal, { platform: 'win32' })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
