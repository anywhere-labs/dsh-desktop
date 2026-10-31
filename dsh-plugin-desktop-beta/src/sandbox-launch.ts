/**
 * Native explanation for Chromium sandbox launch failures on Windows.
 *
 * When the sandbox cannot create the GPU process, Chromium retries in every GPU mode and then ends the
 * browser process on purpose ("GPU process isn't usable. Goodbye."), so the user only sees that nothing
 * opens (#1487). Electron reports each failed launch before that point, and a native dialog needs neither a
 * renderer nor the GPU process, so it can still explain the cause.
 */
import { win32 } from 'node:path'
import { ERROR_ELEVATION_REQUIRED, KEEP_ELEVATED_ARGUMENT, type StartupElevation, type WindowsElevation } from './windows-elevation.ts'

/** A sandboxed child that Windows never created. */
export interface SandboxLaunchFailure {
  readonly process: 'gpu' | 'renderer'
  /** Chromium sandbox result code, reported as the `launch-failed` exit code. */
  readonly code: number
}

/** Chromium's `SBOX_ERROR_CREATE_PROCESS`: the broker's `CreateProcessAsUserW` failed. */
export const SBOX_ERROR_CREATE_PROCESS = 18
/** Startup outcomes in which a restart without administrator rights was attempted and the launch stayed elevated. */
const RESTART_FAILURES = new Set<string>(['no-shell', 'shell-elevated', 'shell-other-user', 'restarted'])

/**
 * Recognize a failed GPU process launch in Electron's `child-process-gone` details.
 * @param platform - Node platform.
 * @param details - Electron child process details.
 * @returns the failure on Windows, where it ends in Chromium's fatal exit.
 */
export function gpuLaunchFailure(platform: NodeJS.Platform, details: { type: string; reason: string; exitCode: number }): SandboxLaunchFailure | undefined {
  return platform === 'win32' && details.type === 'GPU' && details.reason === 'launch-failed' ? { process: 'gpu', code: details.exitCode } : undefined
}

/**
 * Recognize a failed renderer launch in Electron's `render-process-gone` details.
 * @param platform - Node platform.
 * @param details - Electron render process details.
 * @returns the failure on Windows, where the window it belongs to can never paint.
 */
export function rendererLaunchFailure(platform: NodeJS.Platform, details: { reason: string; exitCode: number }): SandboxLaunchFailure | undefined {
  return platform === 'win32' && details.reason === 'launch-failed' ? { process: 'renderer', code: details.exitCode } : undefined
}

/** Facts the explanation is written from. */
export interface SandboxLaunchContext {
  readonly failure: SandboxLaunchFailure
  /** Elevation read at the failure; undefined when it could not be read. */
  readonly elevation: WindowsElevation | undefined
  /** What the startup elevation check recorded. */
  readonly startup: StartupElevation
  readonly argv: readonly string[]
  readonly executable: string
  readonly language: 'zh' | 'en'
}

/** Text of the native message box. */
export interface SandboxLaunchDialog {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly button: string
}

/**
 * Write the explanation: the likely cause for this elevation state, the error code, and the temporary
 * `--no-sandbox` workaround with its security cost.
 * @param context - failure, elevation and launch facts.
 * @returns message box text in the requested language.
 */
export function sandboxLaunchDialog(context: SandboxLaunchContext): SandboxLaunchDialog {
  const zh = context.language === 'zh'
  const t = (chinese: string, english: string): string => zh ? chinese : english
  // Windows-only copy: name the executable with Windows path rules whatever the test host.
  const program = win32.basename(context.executable)
  const { elevation, startup, failure } = context
  const keptByArgument = context.argv.includes(KEEP_ELEVATED_ARGUMENT)
  const cause: string[] = []
  if (elevation?.elevated && elevation.type === 'full') {
    cause.push(t('DSH Desktop Beta 当前以管理员身份运行。以管理员身份运行时，Chromium 沙箱在部分 Windows 环境下无法创建子进程。',
      'DSH Desktop Beta is running as administrator. On some Windows systems the Chromium sandbox cannot create child processes from an administrator process.'))
    if (keptByArgument) {
      cause.push(t(`启动参数中有 ${KEEP_ELEVATED_ARGUMENT}，因此没有自动以普通权限重新启动。`,
        `The ${KEEP_ELEVATED_ARGUMENT} argument turned off the automatic restart without administrator rights.`))
    } else if (startup.win32Code === ERROR_ELEVATION_REQUIRED) {
      cause.push(t('Windows 拒绝了以普通权限自动重新启动（错误 740）：这个程序被设置为始终以管理员身份运行。',
        'Windows refused the automatic restart without administrator rights (error 740): this program is set to always run as administrator.'))
    } else if (startup.elevation?.type === 'full' && (startup.error !== undefined || RESTART_FAILURES.has(startup.kept ?? ''))) {
      cause.push(t('以普通权限自动重新启动没有成功。', 'The automatic restart without administrator rights did not succeed.'))
    }
    cause.push(t('请以普通权限启动：', 'Start it without administrator rights:'),
      t(`• 右键 ${program} 或它的快捷方式 →「属性」→「兼容性」，取消勾选「以管理员身份运行此程序」；如果用过「更改所有用户的设置」，那里也要取消。`,
        `• Right-click ${program} or its shortcut → Properties → Compatibility, and clear “Run this program as an administrator”. If you used “Change settings for all users”, clear it there too.`),
      t('• 快捷方式「属性」→「快捷方式」→「高级」，取消勾选「用管理员身份运行」。',
        '• In the shortcut’s Properties → Shortcut → Advanced, clear “Run as administrator”.'),
      t('• 不要从管理员终端，或设置了「使用最高权限运行」的计划任务启动。',
        '• Do not start it from an administrator terminal or from a scheduled task set to “Run with highest privileges”.'))
    if (keptByArgument) cause.push(t(`• 去掉启动参数 ${KEEP_ELEVATED_ARGUMENT}。`, `• Remove the ${KEEP_ELEVATED_ARGUMENT} argument.`))
  } else if (elevation?.elevated) {
    cause.push(t('DSH Desktop Beta 当前带管理员权限运行：这个账户启动的所有程序都带管理员权限（UAC 已关闭，或正在使用内置 Administrator 账户），因此无法自动以普通权限重新启动。以管理员身份运行时，Chromium 沙箱在部分 Windows 环境下无法创建子进程。请开启 UAC，或用普通账户登录后再启动。',
      'DSH Desktop Beta is running with administrator rights because every program this account starts has them (UAC is off, or this is the built-in Administrator account), so it cannot restart itself without them. On some Windows systems the Chromium sandbox cannot create child processes from an administrator process. Turn UAC on, or sign in with a standard account, and start it again.'))
  } else if (elevation) {
    cause.push(t('DSH Desktop Beta 没有以管理员身份运行。其他已知原因：AppLocker 或软件限制策略、安全软件拦截、程序位于网络共享或重定向的文件夹中。',
      'DSH Desktop Beta is not running as administrator. Other known causes are AppLocker or Software Restriction Policies, security software blocking the launch, and a program folder on a network share or in a redirected folder.'))
  } else {
    cause.push(t('无法确认 DSH Desktop Beta 是否以管理员身份运行。已知原因：以管理员身份运行（包括兼容性设置里的「以管理员身份运行此程序」）、AppLocker 或软件限制策略、安全软件拦截、程序位于网络共享或重定向的文件夹中。',
      'Could not check whether DSH Desktop Beta runs as administrator. Known causes are running as administrator (including the compatibility setting “Run this program as an administrator”), AppLocker or Software Restriction Policies, security software blocking the launch, and a program folder on a network share or in a redirected folder.'))
  }
  const code = failure.code === SBOX_ERROR_CREATE_PROCESS
    ? t(`错误码：${failure.code}（SBOX_ERROR_CREATE_PROCESS，Windows 拒绝创建沙箱进程）`,
      `Error code: ${failure.code} (SBOX_ERROR_CREATE_PROCESS: Windows refused to create the sandboxed process)`)
    : t(`错误码：${failure.code}（Chromium 沙箱启动结果）`, `Error code: ${failure.code} (Chromium sandbox launch result)`)
  const workaround = t('临时绕过：在快捷方式「目标」末尾加上 --no-sandbox 后启动。代价：这会关闭 Chromium 对所有页面的沙箱隔离，包括侧边栏浏览器打开的网页，任何网页里的漏洞都可以直接以你的身份读写文件、运行程序。只在排查期间使用，问题解决后请去掉。',
    'Temporary workaround: add --no-sandbox to the end of the shortcut’s Target and start again. This turns off the Chromium sandbox for every page, including web pages opened in the sidebar browser, so a flaw in any page can read and write your files and run programs as you. Use it only while troubleshooting and remove it afterwards.')
  return {
    title: t('DSH Desktop Beta 无法启动', 'DSH Desktop Beta cannot start'),
    message: failure.process === 'gpu'
      ? t('Chromium 沙箱未能启动 GPU 进程，DSH Desktop Beta 无法显示窗口，即将退出。', 'The Chromium sandbox could not start the GPU process, so DSH Desktop Beta cannot show a window and will quit.')
      : t('Chromium 沙箱未能启动渲染进程，DSH Desktop Beta 无法显示窗口，即将退出。', 'The Chromium sandbox could not start the renderer process, so DSH Desktop Beta cannot show a window and will quit.'),
    detail: [cause.join('\n'), t(`程序位置：${context.executable}`, `Program: ${context.executable}`), code, workaround].join('\n\n'),
    button: t('退出', 'Quit'),
  }
}

/** Operations the reporter needs from Electron and the Desktop runtime. */
export interface SandboxLaunchReporterOptions {
  readonly elevation: () => WindowsElevation | undefined
  readonly context: () => Pick<SandboxLaunchContext, 'startup' | 'argv' | 'executable' | 'language'>
  readonly record: (failure: SandboxLaunchFailure, elevation: WindowsElevation | undefined) => void
  readonly show: (dialog: SandboxLaunchDialog) => void
  readonly exit: () => void
}

/**
 * Explain the first sandbox launch failure of this process, then exit. The message box blocks the UI thread,
 * so Chromium cannot reach its fatal exit while the user reads it.
 * @param options - Electron and Desktop operations.
 * @returns report function; later failures are ignored.
 */
export function createSandboxLaunchReporter(options: SandboxLaunchReporterOptions): (failure: SandboxLaunchFailure) => void {
  let reported = false
  return failure => {
    if (reported) return
    reported = true
    let elevation: WindowsElevation | undefined
    try { elevation = options.elevation() } catch { elevation = undefined }
    options.record(failure, elevation)
    try { options.show(sandboxLaunchDialog({ failure, elevation, ...options.context() })) } finally { options.exit() }
  }
}
