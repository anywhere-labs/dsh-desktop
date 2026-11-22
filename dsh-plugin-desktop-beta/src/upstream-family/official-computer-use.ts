/**
 * The official Computer Use bundle (`@deepseek-ai/dsh-cua-bundle`; macOS 14 and later, and from dsh 0.2.3 Windows) beside
 * Computer Use (Next): the Agents it serves, whether this installation can run it, and the per-Agent `/computer-use` that
 * leaves those Agents. src/host/computer-use-command.ts consumes it as `officialComputerUse` from src/upstream-family.ts.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { release } from 'node:os'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-tools'
import { OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE, officialCuaWindowsHelper } from './official-cua.ts'

/** Name the official provider (`@deepseek-ai/dsh-cua`) takes in the computer-use registry of the official bundle. */
export const OFFICIAL_COMPUTER_USE_PROVIDER = 'dsh-cua'
/** Tool the official provider registers in the scope of each Agent on its configured preset, PTC by default. */
export const OFFICIAL_CUA_TOOL = 'cua'
/** Tool the official provider of dsh 0.2.3 registers in the scope of every other Agent, running CUA programs itself. */
export const OFFICIAL_CUA_PROGRAM_TOOL = 'cua_run_code'

/**
 * Whether the official helper cannot start on this system. It requires macOS 14 (Darwin 23), yet the provider
 * loads and registers its tool on an older macOS too. The Windows provider fails to load without its helper and so
 * registers no tool, and Linux has no official provider.
 * @param platform - Host platform.
 * @param osRelease - Kernel release as `os.release()` reports it.
 * @returns true on macOS 13 and earlier.
 */
export function officialHelperUnsupported(platform: NodeJS.Platform = process.platform, osRelease: string = release()): boolean {
  return platform === 'darwin' && Number.parseInt(osRelease, 10) < 23
}

/** The platforms the official bundle has a provider for, as the Computer Use (Next) page names them. */
export type OfficialComputerUsePlatform = 'macos' | 'windows'

/**
 * The platform whose provider the official bundle loads here.
 * @param platform - Host platform.
 * @returns undefined on platforms the bundle has no provider for, such as Linux.
 */
export function officialComputerUsePlatform(platform: NodeJS.Platform = process.platform): OfficialComputerUsePlatform | undefined {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : undefined
}

/**
 * Whether this installation carries the helper the official Windows provider starts for the Host's CPU. The release
 * publishes the provider without one; Desktop's Windows packages publish it from the pinned upstream source.
 * @param arch - CPU of the Host process.
 * @param resolveProvider - Finds the provider's package directory as the official bundle resolves it.
 * @returns false when the bundle, its Windows provider or the helper is missing.
 */
export function officialWindowsHelperInstalled(arch: string = process.arch, resolveProvider: () => string = installedWindowsProvider): boolean {
  let provider: string
  try {
    provider = resolveProvider()
  } catch {
    // The runtime ships no official bundle, or no Windows provider for it: no helper either.
    return false
  }
  return existsSync(officialCuaWindowsHelper(provider, arch))
}

function installedWindowsProvider(): string {
  const bundle = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-cua-bundle/package.json')
  return dirname(createRequire(bundle).resolve(`${OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE}/package.json`))
}

/**
 * Whether the official Computer Use can run here at all: on macOS 14 (Darwin 23) or later, or on Windows when the
 * installation carries the helper. The Computer Use (Next) page offers its switch only then.
 * @param platform - Host platform.
 * @param osRelease - Kernel release as `os.release()` reports it.
 * @param windowsHelper - Whether a Windows installation carries the helper.
 * @returns true where the official provider can start its helper.
 */
export function officialComputerUseSupported(platform: NodeJS.Platform = process.platform, osRelease: string = release(),
  windowsHelper: () => boolean = officialWindowsHelperInstalled): boolean {
  if (platform === 'win32') return windowsHelper()
  return platform === 'darwin' && !officialHelperUnsupported(platform, osRelease)
}

let helperStarts: boolean | undefined

/**
 * Whether the official Computer Use serves an Agent: its provider holds the registry every other plugin sees, it
 * registered one of its tools for the Agent (`cua` on its configured preset, `cua_run_code` on the others), and its
 * helper can start on this system.
 * @param ctx - context with the tools service.
 * @param agent - Agent to check.
 * @returns true where Computer Use (Next) stays out of the Agent.
 */
export function officialComputerUseServes(ctx: Context, agent: Agent): boolean {
  helperStarts ??= !officialHelperUnsupported()
  return helperStarts
    && ctx.get('computerUse')?.providerName === OFFICIAL_COMPUTER_USE_PROVIDER
    && (ctx.tools.get(OFFICIAL_CUA_TOOL, agent) !== undefined || ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, agent) !== undefined)
}

/**
 * Register one command in each Agent's own command layer, except in the Agents the official Computer Use serves.
 * Enabling or disabling the official bundle and switching a session's mode change the provider's tools; the
 * `tools/change` that follows adds or removes the command, and the client refreshes its `/` menu on
 * `commands/change`.
 * @param ctx - context with the agents, tools and computer-use services.
 * @returns a function that registers the command and returns the disposer of every Agent's registration.
 */
export function agentCommandRegistrar(ctx: Context): (definition: CommandDefinition) => () => void {
  return definition => {
    const registrations = new Map<Agent, () => void>()
    const remove = (agent: Agent): void => {
      const dispose = registrations.get(agent)
      if (!dispose) return
      registrations.delete(agent)
      try { dispose() } catch { /* Agent scope may already be disposed */ }
    }
    const sync = (agent: Agent): void => {
      if (officialComputerUseServes(ctx, agent)) {
        remove(agent)
        return
      }
      if (registrations.has(agent)) return
      // The Agent scope declares no `commands` injection; a registration through it stays local to that Agent.
      const commands = agent.ctx.get('commands')
      if (!commands) return
      try {
        registrations.set(agent, commands.register(definition))
      } catch { /* A disposed Agent scope rejects new registrations */ }
    }
    const syncAll = (): void => {
      for (const agent of ctx.agents.list()) sync(agent)
    }
    const listeners = [
      ctx.on('tools/change', syncAll),
      ctx.on('agent/created', ({ agent }) => { sync(agent) }),
      ctx.on('agent/disposed', ({ agent }) => { remove(agent) }),
    ]
    syncAll()
    return () => {
      for (const off of listeners) off()
      for (const agent of [...registrations.keys()]) remove(agent)
    }
  }
}

/** The official Computer Use as src/host/computer-use-command.ts consumes it. */
export const officialComputerUse = {
  serves: officialComputerUseServes,
  settings: (): { officialSupported: boolean; officialPlatform?: OfficialComputerUsePlatform } => {
    const platform = officialComputerUsePlatform()
    return { officialSupported: officialComputerUseSupported(), ...platform === undefined ? {} : { officialPlatform: platform } }
  },
  commandRegistrar: agentCommandRegistrar,
}
