/** Readable process exit codes and signals for recovery details and incident diagnostics. */

/**
 * Chromium's out-of-memory exception code (PartitionAlloc `kOomExceptionCode`). Electron renderers and
 * Node-mode children raise it when a native allocation fails, including while they are being stopped.
 */
export const OOM_EXCEPTION_CODE = 0xE0000008

interface KnownExit {
  readonly name: string
  readonly zh: string
  readonly en: string
}

const WINDOWS_CODES: ReadonlyMap<number, KnownExit> = new Map([
  [0xC0000005, { name: 'STATUS_ACCESS_VIOLATION', zh: '原生代码访问冲突（崩溃）', en: 'native access violation (crash)' }],
  [OOM_EXCEPTION_CODE, { name: 'OUT_OF_MEMORY', zh: '内存不足（原生内存分配失败）', en: 'out of memory (a native allocation failed)' }],
  [0xC0000017, { name: 'STATUS_NO_MEMORY', zh: '内存不足', en: 'out of memory' }],
  [0xC00000FD, { name: 'STATUS_STACK_OVERFLOW', zh: '栈溢出', en: 'stack overflow' }],
  [0xC0000409, { name: 'STATUS_STACK_BUFFER_OVERRUN', zh: '快速失败（abort 或安全检查）', en: 'fail-fast (abort or a security check)' }],
  [0xC0000374, { name: 'STATUS_HEAP_CORRUPTION', zh: '堆损坏', en: 'heap corruption' }],
  [0xC000001D, { name: 'STATUS_ILLEGAL_INSTRUCTION', zh: '非法指令', en: 'illegal instruction' }],
  [0xC0000135, { name: 'STATUS_DLL_NOT_FOUND', zh: '缺少 DLL', en: 'a DLL was not found' }],
  [0xC0000142, { name: 'STATUS_DLL_INIT_FAILED', zh: 'DLL 初始化失败', en: 'DLL initialization failed' }],
  [0xC000013A, { name: 'STATUS_CONTROL_C_EXIT', zh: '被 Ctrl+C 或关闭控制台终止', en: 'ended by Ctrl+C or a closed console' }],
  [0x80000003, { name: 'STATUS_BREAKPOINT', zh: '致命错误（V8 或原生检查失败）', en: 'fatal error (a V8 or native check failed)' }],
])

/** Node aborts with this code on Windows, for example when the V8 heap runs out. */
const NODE_ABORT: KnownExit = { name: 'ABORT', zh: '进程中止（例如 V8 堆内存耗尽）', en: 'aborted (for example, the V8 heap ran out)' }

const SIGNALS: ReadonlyMap<string, Omit<KnownExit, 'name'>> = new Map([
  ['SIGSEGV', { zh: '段错误（原生崩溃）', en: 'segmentation fault (native crash)' }],
  ['SIGBUS', { zh: '总线错误（原生崩溃）', en: 'bus error (native crash)' }],
  ['SIGILL', { zh: '非法指令', en: 'illegal instruction' }],
  ['SIGABRT', { zh: NODE_ABORT.zh, en: NODE_ABORT.en }],
  ['SIGTRAP', { zh: '致命错误断点', en: 'fatal breakpoint' }],
  ['SIGKILL', { zh: '被强制结束（可能是系统内存不足）', en: 'killed (possibly by the system for low memory)' }],
  ['SIGTERM', { zh: '被请求终止', en: 'terminated on request' }],
])

/** How a child process ended: an exit code, or the signal that terminated it. */
export interface DesktopProcessExit {
  readonly code: number | null
  readonly signal: string | null
}

/** Host exit facts shown by the recovery assistant; `output` is the last stderr text before the exit. */
export interface DesktopHostExit extends DesktopProcessExit {
  readonly output: string
}

/**
 * @param code - An exit code; Windows reports exception codes such as 3221225477 as unsigned values.
 * @returns The 32-bit hexadecimal form used by Windows tools and Crashpad, such as `0xC0000005`.
 */
export function exitCodeHex(code: number): string {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

function knownExit(code: number): KnownExit | undefined {
  return code === 134 ? NODE_ABORT : WINDOWS_CODES.get(code >>> 0)
}

/** Small codes stay decimal; exception codes show hexadecimal, the raw value older logs carry, and a known name. */
function codeText(code: number, locale: 'zh' | 'en'): string {
  const name = knownExit(code)?.name
  const [open, separator, close] = locale === 'zh' ? ['（', '，', '）'] : [' (', ', ', ')']
  if (code > 0 && code <= 255) return name === undefined ? String(code) : `${String(code)}${open}${name}${close}`
  return `${exitCodeHex(code)}${open}${String(code >>> 0)}${name === undefined ? '' : `${separator}${name}`}${close}`
}

/**
 * @param exit - How the process ended.
 * @returns A technical English summary for logs, such as `exited with 0xC0000005 (3221225477, STATUS_ACCESS_VIOLATION)`.
 */
export function exitSummary(exit: DesktopProcessExit): string {
  if (exit.signal !== null) return `was terminated by ${exit.signal}`
  if (exit.code === null || exit.code === 0) return 'stopped'
  return `exited with ${exit.code > 0 && exit.code <= 255 ? 'code ' : ''}${codeText(exit.code, 'en')}`
}

/**
 * @param exit - How the process ended.
 * @param locale - Display language.
 * @returns What a known exit code or signal usually means, or `undefined` when it carries no known meaning.
 */
export function exitMeaning(exit: DesktopProcessExit, locale: 'zh' | 'en'): string | undefined {
  const known = exit.signal !== null ? SIGNALS.get(exit.signal) : exit.code === null ? undefined : knownExit(exit.code)
  return known?.[locale]
}

/**
 * Recovery detail for a Host that ended: the exit and its usual meaning, then the last stderr text
 * labelled as possibly unrelated, because plugins print freely and the final lines rarely name a crash.
 * @param exit - How the Host ended and its last stderr text.
 * @param locale - Display language.
 * @returns Plain text for the recovery assistant's failure detail.
 */
export function hostExitDetail(exit: DesktopHostExit, locale: 'zh' | 'en'): string {
  const zh = locale === 'zh'
  const ended = exit.signal !== null
    ? zh ? `插件服务进程被 ${exit.signal} 终止` : `The Plugin Host process was terminated by ${exit.signal}`
    : exit.code === null
      ? zh ? '插件服务进程已退出' : 'The Plugin Host process exited'
      : zh ? `插件服务进程已退出，退出码 ${codeText(exit.code, locale)}` : `The Plugin Host process exited with code ${codeText(exit.code, locale)}`
  const meaning = exitMeaning(exit, locale)
  const summary = meaning === undefined ? ended : `${ended}${zh ? '：' : ': '}${meaning}`
  if (exit.output === '') return summary
  return `${summary}\n\n${zh ? '退出前最后的 stderr 输出（可能与退出原因无关）：' : 'Last stderr output before the exit (may be unrelated to the cause):'}\n${exit.output}`
}
