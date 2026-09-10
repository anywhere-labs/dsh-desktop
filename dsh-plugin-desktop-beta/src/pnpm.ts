/** Desktop-owned pnpm execution capability for the active DSH Profile. */

import { delimiter, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { assertDesktopProfileName } from './profile-manager.ts'
import { withDesktopPnpmPolicy } from './pnpm-policy.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const TERMINATION_GRACE_MS = 3_000

/** Launcher-resolved values used by the active Desktop pnpm generation. */
export interface DesktopPnpmBootstrap {
  readonly activeProfileName: string
  readonly activeProfileDir: string
  readonly homeDir: string
  readonly appExecutable: string
  readonly pnpmBinPath: string
  readonly electronVersion: string
  readonly nodeBinDir: string
  readonly nodeShimPath: string
  readonly clearEnvironmentPath: string
  readonly dshBootstrapPath: string
}

export interface DesktopPnpmOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

export interface DesktopPnpmHandle {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly done: Promise<DesktopPnpmOutcome>
  cancel(): void
}

/**
 * Package-manager API plus narrow legacy plugin-manager adapters. Desktop
 * deliberately performs no install snapshot, rollback, retry, protection,
 * receipt reconciliation, or recovery bookkeeping.
 */
export interface DesktopPnpm {
  run(argv: readonly string[], signal?: AbortSignal): DesktopPnpmHandle
  runPlugin(argv: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle
  runExternalMarketPluginInstall(
    argv: readonly string[],
    invokingDir: string,
    signal?: AbortSignal,
  ): DesktopPnpmHandle
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopPnpmBootstrap: DesktopPnpmBootstrap
    desktopPnpm: DesktopPnpm
  }
}

interface ActiveOperation {
  child: SubprocessHandle
  done: Promise<DesktopPnpmOutcome>
}

function inheritedPath(): string {
  const exact = process.env.PATH
  if (exact !== undefined || process.platform !== 'win32') return exact ?? ''
  return Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
}

function assertAbsolutePath(label: string, value: string): void {
  if (value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new Error(`${BIN_NAME}: desktop pnpm ${label} must be an absolute path without NUL`)
  }
}

function validatedArgv(argv: readonly string[]): string[] {
  if (argv.length === 0) throw new Error(`${BIN_NAME}: desktop pnpm argv must not be empty`)
  if (argv.some(argument => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new Error(`${BIN_NAME}: desktop pnpm argv must contain only strings without NUL`)
  }
  return [...argv]
}

const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const NPM_EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

function validatedExternalMarketArgv(argv: readonly string[]): string[] {
  const args = validatedArgv(argv)
  if (args[0] !== 'add') {
    throw new Error(`${BIN_NAME}: external Market plugin install requires add with one exact npm package target`)
  }
  const targets = args.slice(1).filter(argument => !argument.startsWith('-'))
  const target = targets[0]
  const separator = target?.lastIndexOf('@') ?? -1
  const packageName = separator > 0 ? target?.slice(0, separator) : undefined
  const packageVersion = separator > 0 ? target?.slice(separator + 1) : undefined
  if (
    targets.length !== 1
    || packageName === undefined
    || packageVersion === undefined
    || !NPM_PACKAGE_NAME_PATTERN.test(packageName)
    || !NPM_EXACT_VERSION_PATTERN.test(packageVersion)
  ) {
    throw new Error(`${BIN_NAME}: external Market plugin install requires exactly one exact npm package target`)
  }
  return args
}

function validateBootstrap(bootstrap: DesktopPnpmBootstrap): void {
  assertDesktopProfileName(bootstrap.activeProfileName)
  for (const [label, value] of [
    ['active Profile directory', bootstrap.activeProfileDir],
    ['Harness home', bootstrap.homeDir],
    ['application executable', bootstrap.appExecutable],
    ['pnpm entry', bootstrap.pnpmBinPath],
    ['Node command directory', bootstrap.nodeBinDir],
    ['Node command', bootstrap.nodeShimPath],
    ['environment preloader', bootstrap.clearEnvironmentPath],
    ['DSH bootstrap', bootstrap.dshBootstrapPath],
  ] as const) assertAbsolutePath(label, value)
  if (bootstrap.electronVersion.length === 0 || bootstrap.electronVersion.includes('\0')) {
    throw new Error(`${BIN_NAME}: desktop pnpm Electron version must not be empty or contain NUL`)
  }
}

class DesktopPnpmService extends Service implements DesktopPnpm {
  private active: ActiveOperation | undefined
  private closed = false

  constructor(ctx: Context, private readonly bootstrap: DesktopPnpmBootstrap) {
    validateBootstrap(bootstrap)
    super(ctx, 'desktopPnpm')
    ctx.effect(
      () => async () => {
        this.closed = true
        const active = this.active
        if (active === undefined) return
        active.child.terminate()
        await active.done.catch(() => {})
      },
      'dsh-plugin-desktop: active pnpm operation teardown',
    )
  }

  run(argv: readonly string[], signal?: AbortSignal): DesktopPnpmHandle {
    const args = withDesktopPnpmPolicy(validatedArgv(argv))
    return this.start({
      argv: [
        this.bootstrap.appExecutable,
        '--import',
        pathToFileURL(this.bootstrap.clearEnvironmentPath).href,
        this.bootstrap.pnpmBinPath,
        ...args,
      ],
      cwd: this.bootstrap.activeProfileDir,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  runPlugin(argv: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle {
    return this.startPlugin(validatedArgv(argv), invokingDir, signal)
  }

  runExternalMarketPluginInstall(
    argv: readonly string[],
    invokingDir: string,
    signal?: AbortSignal,
  ): DesktopPnpmHandle {
    return this.startPlugin(validatedExternalMarketArgv(argv), invokingDir, signal)
  }

  private startPlugin(argv: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle {
    assertAbsolutePath('plugin invoking directory', invokingDir)
    return this.start({
      argv: [
        this.bootstrap.appExecutable,
        '--expose-internals',
        this.bootstrap.dshBootstrapPath,
        'plugin',
        '--profile',
        this.bootstrap.activeProfileName,
        ...argv,
      ],
      cwd: invokingDir,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  private start(command: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly signal?: AbortSignal
  }): DesktopPnpmHandle {
    if (this.closed) throw new Error(`${BIN_NAME}: desktop pnpm generation is closed`)
    if (this.active !== undefined) throw new Error(`${BIN_NAME}: another desktop pnpm operation is already running`)
    command.signal?.throwIfAborted()
    const inherited = inheritedPath()
    const spec: SubprocessSpawnSpec = {
      argv: command.argv,
      cwd: command.cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: TERMINATION_GRACE_MS,
      ...(command.signal === undefined ? {} : { signal: command.signal }),
      env: {
        PATH: inherited.length === 0
          ? this.bootstrap.nodeBinDir
          : `${this.bootstrap.nodeBinDir}${delimiter}${inherited}`,
        NODE: this.bootstrap.nodeShimPath,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: this.bootstrap.homeDir,
        CI: 'true',
        npm_config_runtime: 'electron',
        npm_config_target: this.bootstrap.electronVersion,
        npm_config_disturl: ELECTRON_HEADERS_URL,
      },
    }
    const child = this.ctx.subprocess.spawn(spec)
    if (child.stdout === undefined || child.stderr === undefined) {
      child.terminate()
      throw new Error(`${BIN_NAME}: desktop pnpm subprocess did not expose piped output`)
    }
    const active: ActiveOperation = {
      child,
      done: Promise.resolve({ exitCode: null, signal: null }),
    }
    active.done = this.settle(active)
    this.active = active
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      done: active.done,
      cancel: () => { child.terminate() },
    }
  }

  private async settle(active: ActiveOperation): Promise<DesktopPnpmOutcome> {
    let outcome: SubprocessOutcome
    try {
      outcome = await active.child.done
      return { exitCode: outcome.exitCode, signal: outcome.signal }
    } finally {
      try { await active.child.waitForExit() } finally {
        if (this.active === active) this.active = undefined
      }
    }
  }
}

export const name = 'desktop-pnpm'
export const inject = ['desktopPnpmBootstrap', 'subprocess']

export function apply(ctx: Context): void {
  new DesktopPnpmService(ctx, ctx.desktopPnpmBootstrap)
}
