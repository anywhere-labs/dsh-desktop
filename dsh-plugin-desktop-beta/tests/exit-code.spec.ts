import { expect, it } from 'vitest'
import { OOM_EXCEPTION_CODE, exitCodeHex, exitMeaning, exitSummary, hostExitDetail } from '../src/exit-code.ts'

it('prints exit codes as unsigned 32-bit hexadecimal, as Windows tools and Crashpad do', () => {
  expect(exitCodeHex(3221225477)).toBe('0xC0000005')
  expect(exitCodeHex(-1073741819)).toBe('0xC0000005')
  expect(exitCodeHex(3758096392)).toBe('0xE0000008')
  expect(exitCodeHex(OOM_EXCEPTION_CODE)).toBe('0xE0000008')
  expect(exitCodeHex(7)).toBe('0x00000007')
})

it('summarizes exits for logs with the raw value and a known name', () => {
  expect(exitSummary({ code: 3221225477, signal: null })).toBe('exited with 0xC0000005 (3221225477, STATUS_ACCESS_VIOLATION)')
  expect(exitSummary({ code: 3758096392, signal: null })).toBe('exited with 0xE0000008 (3758096392, OUT_OF_MEMORY)')
  expect(exitSummary({ code: 3221230132, signal: null })).toBe('exited with 0xC0001234 (3221230132)')
  expect(exitSummary({ code: 7, signal: null })).toBe('exited with code 7')
  expect(exitSummary({ code: 134, signal: null })).toBe('exited with code 134 (ABORT)')
  expect(exitSummary({ code: 0, signal: null })).toBe('stopped')
  expect(exitSummary({ code: null, signal: 'SIGKILL' })).toBe('was terminated by SIGKILL')
})

it('explains known codes and signals in both languages', () => {
  expect(exitMeaning({ code: 3758096392, signal: null }, 'zh')).toBe('内存不足（原生内存分配失败）')
  expect(exitMeaning({ code: -1073741819, signal: null }, 'en')).toBe('native access violation (crash)')
  expect(exitMeaning({ code: null, signal: 'SIGSEGV' }, 'zh')).toBe('段错误（原生崩溃）')
  expect(exitMeaning({ code: 7, signal: null }, 'en')).toBeUndefined()
})

it('labels the last Host stderr as possibly unrelated instead of presenting it as the cause (#1511)', () => {
  const output = 'dsh-plugin-desktop-beta: outbound proxy = none\n(node:355644) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.'
  expect(hostExitDetail({ code: 3221225477, signal: null, output }, 'zh')).toBe(
    '插件服务进程已退出，退出码 0xC0000005（3221225477，STATUS_ACCESS_VIOLATION）：原生代码访问冲突（崩溃）\n\n'
    + `退出前最后的 stderr 输出（可能与退出原因无关）：\n${output}`)
  expect(hostExitDetail({ code: 3221225477, signal: null, output }, 'en')).toBe(
    'The Plugin Host process exited with code 0xC0000005 (3221225477, STATUS_ACCESS_VIOLATION): native access violation (crash)\n\n'
    + `Last stderr output before the exit (may be unrelated to the cause):\n${output}`)
  expect(hostExitDetail({ code: null, signal: 'SIGKILL', output: '' }, 'zh')).toBe('插件服务进程被 SIGKILL 终止：被强制结束（可能是系统内存不足）')
  expect(hostExitDetail({ code: 7, signal: null, output: '' }, 'en')).toBe('The Plugin Host process exited with code 7')
})
