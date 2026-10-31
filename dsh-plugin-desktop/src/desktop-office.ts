/** Office skills and bundled authoring dependencies; ported from upstream Desktop's Host composition. */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'

/** Loader identity for the application-owned Office composition. */
export const name = 'desktop-office'

/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled payload directory; the sibling `office-skills` directory holds the skill resources. Missing resources fail Host startup. */
  readonly source: string
  /** Directory under the DSH home receiving the installed payload. */
  readonly root: string
}

/**
 * Installation name under `<home>/dsh-runtimes`. Stable shares `~/.dsh` with the official Desktop,
 * and the tool replaces an installation whose manifest differs, so each edition keeps its own directory.
 */
export const PRIMARY_RUNTIME_INSTALL_NAME = `${DESKTOP_PACKAGE_NAME}-primary-runtime`

/** The bundled interpreter payload of this CPU as the shell located it. */
export interface DesktopPrimaryRuntime {
  /** Payload directory; `office-skills` lies beside it. */
  readonly source: string
  /** Whether the Host must fail without the payload: a packaged shell always carries one. */
  readonly required: boolean
}

/** Where one shell looks for its payload. */
export interface DesktopPrimaryRuntimeLocation {
  /** Whether Electron runs the packaged application. */
  readonly packaged: boolean
  /** Electron's resources directory; the payloads ride beside the application as extra resources. */
  readonly resourcesPath: string
  /** Desktop package root; a development tree prepares the payload under `.desktop-build/runtime`. */
  readonly packageRoot: string
  /** CPU of this shell; defaults to the current process. */
  readonly arch?: string
  /** Environment; `DSH_DESKTOP_PRIMARY_RUNTIME_DIR` overrides the payload directory as it does upstream. */
  readonly environment?: NodeJS.ProcessEnv
}

/**
 * Locate the payload of this CPU: beside the packaged application, or the tree `prepare:runtime`
 * assembled for a development launch.
 * @param location - Shell facts.
 * @returns The payload directory and whether the Host requires it.
 */
export function desktopPrimaryRuntime(location: DesktopPrimaryRuntimeLocation): DesktopPrimaryRuntime {
  const override = (location.environment ?? process.env).DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  const arch = location.arch ?? process.arch
  const source = override !== undefined && override !== ''
    ? resolve(override)
    : join(location.packaged ? join(location.resourcesPath, 'runtime') : join(location.packageRoot, '.desktop-build', 'runtime'), arch, 'primary-runtime')
  return { source, required: location.packaged }
}

/**
 * Resolve the Office composition for one Host start.
 * @param runtime - Payload the shell located, or undefined when the shell passed none.
 * @param home - DSH home receiving the installation.
 * @returns The configuration, or undefined for a development tree whose payload was not prepared.
 * @throws For a packaged Host whose payload is missing.
 */
export function resolveDesktopOfficeConfig(runtime: DesktopPrimaryRuntime | undefined, home: string): Config | undefined {
  if (runtime === undefined) return undefined
  if (!existsSync(join(runtime.source, 'runtime.json'))) {
    if (runtime.required) throw new Error(`${DESKTOP_PACKAGE_NAME}: the bundled primary runtime is missing: ${runtime.source}`)
    return undefined
  }
  return { source: runtime.source, root: join(home, 'dsh-runtimes', PRIMARY_RUNTIME_INSTALL_NAME) }
}

/**
 * Enable offline Office authoring and structural checks in the Desktop profile.
 * @param ctx - Profile scope; child plugins declare their own service requirements.
 * @param config - Bundled payload source and installation root.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config)
  // Stable and Beta ship no archive, so the CLI runs from its installed package under the bundled standalone Node.
  const packageRoot = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json')))
  await ctx.plugin(officeSkills, {
    assetRoot: join(dirname(config.source), 'office-skills'),
    node: join(config.source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    cli: join(packageRoot, 'lib', 'cli.js'),
  })
}
