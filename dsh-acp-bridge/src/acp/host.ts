/**
 * The DSH services the ACP layer uses, behind one facade. Optional services are
 * read when needed, so the plugin keeps working while DSH mounts or reloads them.
 */

import type { AvailableCommand, ContentBlock as AcpContent } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import { record } from './convert.js'
import type { Choice } from './options.js'
import type { Log } from './log.js'

/** DSH's plan mode service, read structurally: older compositions have none. */
interface PlanService {
  get(agent: Agent): { active: boolean, pending?: boolean }
  set(agent: Agent, active: boolean): unknown
}

/** A DSH failure the ACP client should see with its message. */
export class HostError extends Error {
  constructor(message: string, readonly invalid = false) { super(message); this.name = 'HostError' }
}

/** DSH Remote errors carry a stable code and a human message. */
export function hostMessage(error: unknown): string {
  const value = record(error)
  if (typeof value.message === 'string' && value.message) return value.message
  return String(error)
}

export class DshHost {
  private catalogTask: Promise<ModelCatalog> | undefined
  private catalogAt = 0

  constructor(readonly ctx: Context, readonly log: Log) {
    ctx.on('llm/adapters-updated', () => { this.catalogTask = undefined }, { global: true })
  }

  get controller() { return this.ctx.sessionController }
  get workspaces() { return this.ctx.workspaceRegistry }
  get imagesSupported(): boolean { return Boolean(this.ctx.get('attachments')) }

  live(id: string): Agent | undefined {
    return this.ctx.get('agents')?.get(id as SessionId)
  }

  /** The session's Agent, resuming it when DSH has not loaded it yet. */
  async agent(id: string): Promise<Agent> {
    const found = await this.controller.resolveAgent(id as SessionId)
    if ('error' in found) throw new HostError('DSH 暂时无法打开这个会话，请稍后重试。')
    return found.agent
  }

  /** The model catalog, cached for a minute and refreshed when DSH's providers change. */
  async catalog(): Promise<ModelCatalog | undefined> {
    if (!this.catalogTask || Date.now() - this.catalogAt > 60_000) {
      this.catalogAt = Date.now()
      const task = this.controller.modelCatalog()
      this.catalogTask = task
      task.catch(() => { if (this.catalogTask === task) this.catalogTask = undefined })
    }
    try { return await this.catalogTask } catch (error) {
      this.log.warn('acp-bridge: model catalog unavailable', error)
      return undefined
    }
  }

  permissionChoices(): Choice[] {
    const presets = this.ctx.get('permissionPresets')
    if (!presets) return []
    return presets.names.map(name => {
      const option = presets.optionOf(name)
      return { id: name, name: option.name, ...(option.description ? { description: option.description } : {}) }
    })
  }

  defaultPermission(): string | undefined { return this.ctx.get('permissionPresets')?.defaultPreset }

  currentPermission(agent: Agent | undefined): string | undefined {
    return agent ? this.ctx.get('permissionPresets')?.current(agent.session) : undefined
  }

  async presetChoices(): Promise<Choice[]> {
    const presets = this.ctx.get('agentPresets')
    if (!presets) return []
    return (await presets.list()).filter(preset => !preset.broken).map(preset => ({
      id: preset.id, name: preset.name ?? preset.id, ...(preset.description ? { description: preset.description } : {}),
    }))
  }

  defaultPreset(): string | undefined { return this.ctx.get('agentPresets')?.defaultId }

  /** Plan mode as the Agent sees it: preset-isolated services come first. */
  planMode(agent: Agent): PlanService | undefined {
    const presets = this.ctx.get('agentPresets') as { serviceFor?(agent: Agent, name: string): unknown } | undefined
    let value: unknown
    try { value = presets?.serviceFor?.(agent, 'planMode') } catch { value = undefined }
    value ??= (this.ctx as unknown as { get(name: string): unknown }).get('planMode')
    const service = record(value)
    return typeof service.get === 'function' && typeof service.set === 'function' ? value as PlanService : undefined
  }

  presentCall(agent: Agent | undefined, name: string, args: unknown): ToolCallView | undefined {
    try { return this.ctx.get('tools')?.get(name, agent)?.presentCall?.(args) } catch { return undefined }
  }

  presentResult(agent: Agent | undefined, name: string, args: unknown, result: { content: unknown, isError: boolean, meta?: unknown }): ToolResultView | undefined {
    try { return this.ctx.get('tools')?.get(name, agent)?.presentResult?.(args, result as ToolResult) } catch { return undefined }
  }

  /** Registered commands, then user-invocable skills, as the ACP slash menu. */
  async commands(agent: Agent, cwd: string): Promise<AvailableCommand[]> {
    const list: AvailableCommand[] = []
    const seen = new Set<string>()
    try {
      for (const command of this.ctx.get('commands')?.list(agent) ?? []) {
        if (seen.has(command.name)) continue
        seen.add(command.name)
        list.push({ name: command.name, description: command.description, ...(command.input ? { input: { hint: command.input.hint } } : {}) })
      }
    } catch (error) { this.log.warn('acp-bridge: command catalog unavailable', error) }
    try {
      for (const skill of await this.ctx.get('skills')?.list({ scope: agent, cwd }) ?? []) {
        if (!skill.invocation.userInvocable || seen.has(skill.name)) continue
        seen.add(skill.name)
        list.push({ name: skill.name, description: skill.description || `使用技能 ${skill.name}` })
      }
    } catch (error) { this.log.warn('acp-bridge: skill catalog unavailable', error) }
    return list
  }

  /** One stored image as ACP content; a missing image becomes a short note. */
  async image(sessionId: string, block: unknown): Promise<AcpContent> {
    const attachment = record(record(block).attachment)
    if (typeof attachment.attachmentId === 'string' && typeof attachment.mediaType === 'string') {
      try {
        const value = await this.controller.attachment({ sessionId: sessionId as SessionId, attachment: attachment as never })
        return { type: 'image', data: value.data, mimeType: attachment.mediaType }
      } catch (error) { this.log.debug('acp-bridge: image unavailable', error) }
    }
    return { type: 'text', text: '[图片无法读取]' }
  }

  /** Context occupancy for usage updates: DSH's token meter when composed, else the step's own usage. */
  usage(sessionId: string, usage: unknown): { used: number, size: number } | undefined {
    const session = this.ctx.get('sessions')?.get(sessionId as SessionId)
    const size = session?.requestContext()?.contextWindow
    if (!session || !size) return undefined
    const meter = (this.ctx as unknown as { get(name: string): unknown }).get('tokenMeter') as { measure?(session: unknown): { totalTokens?: number } } | undefined
    let used: number | undefined
    try { used = meter?.measure?.(session)?.totalTokens } catch { used = undefined }
    if (used === undefined) {
      const value = record(usage)
      if (typeof value.inputTokens !== 'number' || typeof value.outputTokens !== 'number') return undefined
      used = value.inputTokens + value.outputTokens
    }
    return { used, size }
  }
}
