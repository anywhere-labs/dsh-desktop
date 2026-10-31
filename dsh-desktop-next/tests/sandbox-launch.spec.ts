/** Native explanation of Windows sandbox launch failures. */
import { describe, expect, it, vi } from 'vitest'
import { createSandboxLaunchReporter, gpuLaunchFailure, rendererLaunchFailure, sandboxLaunchDialog, type SandboxLaunchContext } from '../src/sandbox-launch.ts'

const EXECUTABLE = 'E:\\Program Files\\DSH NEXT\\DSH NEXT.exe'
const GPU = { process: 'gpu', code: 18 } as const

function dialog(overrides: Partial<SandboxLaunchContext> = {}) {
  return sandboxLaunchDialog({ failure: GPU, elevation: { elevated: true, type: 'full' }, startup: {}, argv: [EXECUTABLE], executable: EXECUTABLE, language: 'zh', ...overrides })
}

describe('sandbox launch failures', () => {
  it('recognizes only Windows launch failures', () => {
    const gpu = { type: 'GPU', reason: 'launch-failed', exitCode: 18 }
    expect(gpuLaunchFailure('win32', gpu)).toEqual(GPU)
    expect(gpuLaunchFailure('darwin', gpu)).toBeUndefined()
    expect(gpuLaunchFailure('win32', { ...gpu, reason: 'crashed', exitCode: -2147483645 })).toBeUndefined()
    expect(gpuLaunchFailure('win32', { ...gpu, type: 'Utility' })).toBeUndefined()
    expect(rendererLaunchFailure('win32', { reason: 'launch-failed', exitCode: 18 })).toEqual({ process: 'renderer', code: 18 })
    expect(rendererLaunchFailure('linux', { reason: 'launch-failed', exitCode: 18 })).toBeUndefined()
    expect(rendererLaunchFailure('win32', { reason: 'oom', exitCode: 0 })).toBeUndefined()
  })
})

describe('sandboxLaunchDialog', () => {
  it('tells an elevated user how to stop running as administrator, the code, and what --no-sandbox costs', () => {
    const text = dialog()
    expect(text.title).toBe('DSH NEXT 无法启动')
    expect(text.message).toContain('GPU 进程')
    expect(text.detail).toContain('当前以管理员身份运行')
    expect(text.detail).toContain('右键 DSH NEXT.exe 或它的快捷方式')
    expect(text.detail).toContain('「以管理员身份运行此程序」')
    expect(text.detail).toContain('「用管理员身份运行」')
    expect(text.detail).toContain(`程序位置：${EXECUTABLE}`)
    expect(text.detail).toContain('错误码：18（SBOX_ERROR_CREATE_PROCESS')
    expect(text.detail).toContain('--no-sandbox')
    expect(text.detail).toContain('侧边栏浏览器打开的网页')
    expect(text.detail).not.toContain('自动重新启动')
    expect(text.button).toBe('退出')
  })

  it('explains why the automatic restart did not help', () => {
    expect(dialog({ argv: [EXECUTABLE, '--next-keep-elevated'] }).detail).toContain('去掉启动参数 --next-keep-elevated')
    expect(dialog({ startup: { elevation: { elevated: true, type: 'full' }, error: 'Win32CallError', win32Code: 740 } }).detail)
      .toContain('错误 740')
    expect(dialog({ startup: { elevation: { elevated: true, type: 'full' }, kept: 'no-shell' } }).detail).toContain('以普通权限自动重新启动没有成功')
    expect(dialog({ startup: { elevation: { elevated: true, type: 'full' }, kept: 'development' } }).detail).not.toContain('自动重新启动')
  })

  it('matches the cause to the elevation state', () => {
    expect(dialog({ elevation: { elevated: true, type: 'default' } }).detail).toContain('UAC 已关闭')
    const standard = dialog({ elevation: { elevated: false, type: 'limited' } }).detail
    expect(standard).toContain('没有以管理员身份运行')
    expect(standard).toContain('AppLocker')
    expect(standard).not.toContain('右键')
    expect(dialog({ elevation: undefined }).detail).toContain('无法确认')
  })

  it('writes English copy and covers renderer failures and other sandbox codes', () => {
    const text = dialog({ language: 'en', failure: { process: 'renderer', code: 20 } })
    expect(text.title).toBe('DSH NEXT cannot start')
    expect(text.message).toContain('renderer process')
    expect(text.detail).toContain('Run this program as an administrator')
    expect(text.detail).toContain('Error code: 20 (Chromium sandbox launch result)')
    expect(text.detail).toContain('add --no-sandbox')
    expect(text.button).toBe('Quit')
  })
})

describe('createSandboxLaunchReporter', () => {
  it('records and explains the first failure, then exits even if the dialog fails', () => {
    const calls: string[] = []
    const report = createSandboxLaunchReporter({
      elevation: () => { throw new Error('no token') },
      context: () => ({ startup: {}, argv: [EXECUTABLE], executable: EXECUTABLE, language: 'en' }),
      record: (failure, elevation) => { calls.push(`record ${failure.process} ${failure.code} ${String(elevation)}`) },
      show: text => { calls.push(`show ${text.title}`); throw new Error('dialog failed') },
      exit: () => { calls.push('exit') },
    })
    expect(() => report(GPU)).toThrow('dialog failed')
    report({ process: 'renderer', code: 18 })
    expect(calls).toEqual(['record gpu 18 undefined', 'show DSH NEXT cannot start', 'exit'])
  })

  it('passes the elevation it read to the record and the dialog', () => {
    const show = vi.fn()
    const record = vi.fn()
    createSandboxLaunchReporter({
      elevation: () => ({ elevated: false, type: 'limited' }),
      context: () => ({ startup: {}, argv: [EXECUTABLE], executable: EXECUTABLE, language: 'zh' }),
      record, show, exit: vi.fn(),
    })(GPU)
    expect(record).toHaveBeenCalledWith(GPU, { elevated: false, type: 'limited' })
    expect(show.mock.calls[0]![0].detail).toContain('没有以管理员身份运行')
  })
})
