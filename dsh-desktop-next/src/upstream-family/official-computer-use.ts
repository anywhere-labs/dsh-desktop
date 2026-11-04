/**
 * The official Computer Use bundle of dsh 0.2.2 (`@deepseek-ai/dsh-cua-bundle`, macOS 14 and later) beside Computer Use
 * (Next): the Agents it serves, whether this system can run it, and the per-Agent `/computer-use` that leaves those
 * Agents. src/host/computer-use-command.ts consumes it as `officialComputerUse` from src/upstream-family.ts.
 */
import { release } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-tools'

/** Name the official provider (`@deepseek-ai/dsh-cua`) takes in the computer-use registry of the official bundle. */
export const OFFICIAL_COMPUTER_USE_PROVIDER = 'dsh-cua'
/** Tool the official provider registers in the scope of each Agent it serves, PTC sessions by default. */
export const OFFICIAL_CUA_TOOL = 'cua'

/**
 * Whether the official helper cannot start on this system. It requires macOS 14 (Darwin 23), yet the provider
 * loads and registers its tool on an older macOS too; other platforms never load the official provider.
 * @param platform - Host platform.
 * @param osRelease - Kernel release as `os.release()` reports it.
 * @returns true on macOS 13 and earlier.
 */
export function officialHelperUnsupported(platform: NodeJS.Platform = process.platform, osRelease: string = release()): boolean {
  return platform === 'darwin' && Number.parseInt(osRelease, 10) < 23
}

/**
 * Whether the official Computer Use can run here at all: macOS 14 (Darwin 23) or later. The Plugins page
 * offers its switch only then.
 * @param platform - Host platform.
 * @param osRelease - Kernel release as `os.release()` reports it.
 * @returns true on macOS 14 and later.
 */
export function officialComputerUseSupported(platform: NodeJS.Platform = process.platform, osRelease: string = release()): boolean {
  return platform === 'darwin' && !officialHelperUnsupported(platform, osRelease)
}

let helperStarts: boolean | undefined

/**
 * Whether the official Computer Use serves an Agent: its provider holds the registry every other plugin sees, it
 * registered its tool for the Agent (PTC sessions by default), and its helper can start on this system.
 * @param ctx - context with the tools service.
 * @param agent - Agent to check.
 * @returns true where Computer Use (Next) stays out of the Agent.
 */
export function officialComputerUseServes(ctx: Context, agent: Agent): boolean {
  helperStarts ??= !officialHelperUnsupported()
  return helperStarts
    && ctx.get('computerUse')?.providerName === OFFICIAL_COMPUTER_USE_PROVIDER
    && ctx.tools.get(OFFICIAL_CUA_TOOL, agent) !== undefined
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
  settings: (): { officialSupported: boolean } => ({ officialSupported: officialComputerUseSupported() }),
  commandRegistrar: agentCommandRegistrar,
}
