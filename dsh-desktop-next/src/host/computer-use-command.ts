/** Per-session on-demand `/computer-use` command and tool/prompt gating for Desktop Next. */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { atomicJson, readPrivateFile } from '../private-files.ts'

export const COMPUTER_USE_SETTINGS_ROUTE = '/api/desktop-next/computer-use'
export const COMPUTER_USE_SETTINGS_FILE = 'desktop-next.computer-use.json'
export const COMPUTER_USE_COMMAND_NAME = 'computer-use'
export const CUA_TOOL_PREFIX = 'cua_driver_native__'
export const CUA_PROMPT_SECTION = 'computer-use:cua-driver-native'

export interface ComputerUseCommandConfig {
  commandMode: boolean
}

interface AgentGateRecord {
  toolKey: string
  disposeTools?: (() => void) | undefined
  disposePrompt?: (() => void) | undefined
}

export function readComputerUseCommandConfig(profileDir: string): ComputerUseCommandConfig {
  const raw = readPrivateFile(join(profileDir, COMPUTER_USE_SETTINGS_FILE))
  if (raw === undefined) return { commandMode: true }
  try {
    const parsed = JSON.parse(raw) as { commandMode?: unknown } | null
    if (parsed && typeof parsed === 'object' && typeof parsed.commandMode === 'boolean') {
      return { commandMode: parsed.commandMode }
    }
  } catch {
    // Fall back to the default command-gated mode when the file is unreadable or malformed.
  }
  return { commandMode: true }
}

export function writeComputerUseCommandConfig(
  profileDir: string,
  config: ComputerUseCommandConfig,
): ComputerUseCommandConfig {
  const normalized: ComputerUseCommandConfig = { commandMode: Boolean(config.commandMode) }
  atomicJson(join(profileDir, COMPUTER_USE_SETTINGS_FILE), normalized)
  return normalized
}

export function isOffCommandArg(rawInput: string): boolean {
  const normalized = rawInput.trim().toLowerCase()
  return normalized === 'off' || normalized === 'disable' || normalized === 'false' || normalized === '关闭'
}

export function isOnOnlyCommandArg(rawInput: string): boolean {
  const normalized = rawInput.trim().toLowerCase()
  return normalized === '' || normalized === 'on' || normalized === 'enable' || normalized === 'true' || normalized === '开启'
}

export function foldSessionComputerUseEnabled(session: Pick<Session, 'snapshotEvents'>): boolean {
  const commandRuns = new Map<string, string>()
  let enabled = false
  for (const event of session.snapshotEvents()) {
    if (event.type === 'command/run' && event.data.name === COMPUTER_USE_COMMAND_NAME) {
      commandRuns.set(event.data.commandId, event.data.args ?? '')
    } else if (event.type === 'command/done' && event.data.kind === 'success') {
      const args = commandRuns.get(event.data.commandId)
      if (args !== undefined) {
        enabled = !isOffCommandArg(args)
      }
    }
  }
  return enabled
}

export interface ComputerUseCommandController {
  getCommandMode(): boolean
  setCommandMode(commandMode: boolean): ComputerUseCommandConfig
  reconcile(): void
}

export function installComputerUseCommand(ctx: Context, profileDir: string): ComputerUseCommandController {
  let commandMode = readComputerUseCommandConfig(profileDir).commandMode
  let reconcileRuntime: (() => void) | undefined

  const controller: ComputerUseCommandController = {
    getCommandMode: () => commandMode,
    setCommandMode: (nextMode: boolean) => {
      const saved = writeComputerUseCommandConfig(profileDir, { commandMode: nextMode })
      commandMode = saved.commandMode
      reconcileRuntime?.()
      return saved
    },
    reconcile: () => {
      reconcileRuntime?.()
    },
  }

  ctx.inject(['connection'], (connCtx) => {
    connCtx.connection.fetch.register({
      path: COMPUTER_USE_SETTINGS_ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        if (request.method === 'GET') {
          return Response.json(
            { commandMode: controller.getCommandMode() },
            { headers: { 'cache-control': 'no-store' } },
          )
        }
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            { error: 'Invalid JSON body' },
            { status: 400, headers: { 'cache-control': 'no-store' } },
          )
        }
        if (
          typeof body !== 'object'
          || body === null
          || Array.isArray(body)
          || typeof (body as { commandMode?: unknown }).commandMode !== 'boolean'
        ) {
          return Response.json(
            { error: 'commandMode must be a boolean' },
            { status: 400, headers: { 'cache-control': 'no-store' } },
        )
        }
        const updated = controller.setCommandMode((body as { commandMode: boolean }).commandMode)
        return Response.json(updated, { headers: { 'cache-control': 'no-store' } })
      },
    })
  })

  ctx.inject(['tools', 'systemPrompt', 'agents', 'commands'], (runtimeCtx) => {
    const sessionStates = new WeakMap<Session, boolean>()
    const trackedAgents = new Set<Agent>()
    const agentGates = new Map<Agent, AgentGateRecord>()
    let disposeCommand: (() => void) | undefined
    let updatingTools = false

    const isSessionEnabled = (session: Session): boolean => {
      let current = sessionStates.get(session)
      if (current === undefined) {
        current = foldSessionComputerUseEnabled(session)
        sessionStates.set(session, current)
      }
      return current
    }

    const isAgentEnabled = (agent: Agent): boolean => {
      const visited = new Set<Session>()
      let currentAgent: Agent | undefined = agent
      while (currentAgent !== undefined) {
        const session = currentAgent.session
        if (visited.has(session)) break
        visited.add(session)
        if (isSessionEnabled(session)) return true
        const parentSessionId = session.header?.parentSession
        if (parentSessionId !== undefined) {
          const parentAgent = runtimeCtx.agents.get(parentSessionId)
          if (parentAgent !== undefined) {
            currentAgent = parentAgent
            continue
          }
        }
        const activeAgent: Agent = currentAgent
        currentAgent = runtimeCtx.agents
          .list()
          .find(candidate => runtimeCtx.agents.isOwnedBy(activeAgent.id, candidate))
      }
      return false
    }

    const getGlobalCuaToolNames = (): string[] =>
      runtimeCtx.tools
        .schemas()
        .map(schema => schema.name)
        .filter(name => name.startsWith(CUA_TOOL_PREFIX))
        .sort()

    const clearAgentGate = (agent: Agent): void => {
      const gate = agentGates.get(agent)
      if (!gate) return
      agentGates.delete(agent)
      if (gate.disposeTools) {
        try { gate.disposeTools() } catch { /* Agent scope may already be disposed */ }
      }
      if (gate.disposePrompt) {
        try { gate.disposePrompt() } catch { /* Agent scope may already be disposed */ }
      }
    }

    const reconcileAgent = (agent: Agent, cuaToolNames: readonly string[]): void => {
      const shouldGate = commandMode && cuaToolNames.length > 0 && !isAgentEnabled(agent)
      if (!shouldGate) {
        clearAgentGate(agent)
        return
      }
      let gate = agentGates.get(agent)
      if (!gate) {
        gate = { toolKey: '' }
        agentGates.set(agent, gate)
      }
      const nextToolKey = cuaToolNames.join('\0')
      if (gate.toolKey !== nextToolKey) {
        if (gate.disposeTools) {
          try { gate.disposeTools() } catch { /* Ignore stale disposer */ }
          gate.disposeTools = undefined
        }
        gate.disposeTools = agent.ctx.tools.restrict({ deny: cuaToolNames })
        gate.toolKey = nextToolKey
      }
      if (!gate.disposePrompt) {
        gate.disposePrompt = agent.ctx.systemPrompt.section({
          name: CUA_PROMPT_SECTION,
          order: agent.ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
          text: '',
        })
      }
    }

    const collectLiveAgents = (): Set<Agent> => {
      const all = new Set<Agent>(trackedAgents)
      for (const agent of runtimeCtx.agents.list()) {
        all.add(agent)
      }
      return all
    }

    const reconcileAll = (): void => {
      if (updatingTools) return
      updatingTools = true
      try {
        const cuaToolNames = getGlobalCuaToolNames()
        const shouldRegisterCommand = commandMode && cuaToolNames.length > 0
        if (shouldRegisterCommand && !disposeCommand) {
          disposeCommand = runtimeCtx.commands.register({
            name: COMPUTER_USE_COMMAND_NAME,
            description: '开启或关闭 Computer Use',
            input: {
              hint: '[off|message]',
              attachments: true,
            },
            handler: ({ agent, rawInput, attachments }): CommandResult => {
              trackedAgents.add(agent)
              const trimmed = rawInput.trim()
              const attachmentBlocks = attachments ?? []
              if (isOffCommandArg(trimmed)) {
                if (attachmentBlocks.length > 0) {
                  return {
                    kind: 'error',
                    text: '/computer-use off 不接受附件。',
                  }
                }
                sessionStates.set(agent.session, false)
                reconcileAll()
                return {
                  kind: 'success',
                  text: '已关闭 Computer Use。',
                }
              }
              sessionStates.set(agent.session, true)
              reconcileAll()
              const taskText = isOnOnlyCommandArg(trimmed) ? '' : trimmed
              if (taskText.length > 0 || attachmentBlocks.length > 0) {
                agent.steer(
                  createUserMessage({
                    content: [
                      ...attachmentBlocks,
                      ...(taskText.length > 0 ? [{ type: 'text' as const, text: taskText }] : []),
                    ],
                    source: { kind: 'user' },
                  }),
                )
              }
              return {
                kind: 'success',
                text: '已开启 Computer Use（输入 /computer-use off 关闭）。',
              }
            },
          })
        } else if (!shouldRegisterCommand && disposeCommand) {
          const dispose = disposeCommand
          disposeCommand = undefined
          dispose()
        }

        for (const agent of collectLiveAgents()) {
          reconcileAgent(agent, cuaToolNames)
        }
      } finally {
        updatingTools = false
      }
    }

    const trackAndReconcileAgent = (agent: Agent): void => {
      trackedAgents.add(agent)
      if (updatingTools) return
      updatingTools = true
      try {
        reconcileAgent(agent, getGlobalCuaToolNames())
      } finally {
        updatingTools = false
      }
    }

    runtimeCtx.on('tools/change', () => {
      if (!updatingTools) reconcileAll()
    })

    runtimeCtx.on('agent/created', ({ agent, source }) => {
      if (source === 'clear') {
        sessionStates.set(agent.session, false)
      }
      trackAndReconcileAgent(agent)
    })

    runtimeCtx.on('agent/disposed', ({ agent }) => {
      trackedAgents.delete(agent)
      updatingTools = true
      try {
        clearAgentGate(agent)
      } finally {
        updatingTools = false
      }
    })

    runtimeCtx.on('agent/pre-step', async ({ agent }, next) => {
      trackAndReconcileAgent(agent)
      return next()
    })

    runtimeCtx.on('system-prompt/assemble', async (assembly, context, next) => {
      if (context.agent !== undefined) {
        trackAndReconcileAgent(context.agent)
      }
      const resolved = await next()
      if (commandMode && (context.agent === undefined || !isAgentEnabled(context.agent))) {
        return {
          ...resolved,
          sections: resolved.sections.filter(section => section.name !== CUA_PROMPT_SECTION),
        }
      }
      return resolved
    })

    runtimeCtx.effect(() => {
      reconcileRuntime = reconcileAll
      reconcileAll()
      return () => {
        if (reconcileRuntime === reconcileAll) {
          reconcileRuntime = undefined
        }
        updatingTools = true
        try {
          if (disposeCommand) {
            const dispose = disposeCommand
            disposeCommand = undefined
            dispose()
          }
          for (const agent of [...agentGates.keys()]) {
            clearAgentGate(agent)
          }
          trackedAgents.clear()
        } finally {
          updatingTools = false
        }
      }
    }, 'desktop-next: computer-use command gating')
  })

  return controller
}
