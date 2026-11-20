/** ACP session configuration options built from DSH's catalogs. Pure. */

import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption } from '@agentclientprotocol/sdk'
import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller'

export const OPTION = {
  model: 'model',
  effort: 'reasoning_effort',
  permission: 'permission',
  preset: 'agent_preset',
  plan: 'plan_mode',
  team: 'agent_team',
} as const

/** The effort value that means "the model's own default". */
export const DEFAULT_EFFORT = 'default'

export interface Choice { id: string, name: string, description?: string }

/** An on/off option: a boolean for clients that render them, an `on`/`off` select otherwise. */
export interface Switch { active: boolean, booleanOptions: boolean }

export interface ConfigState {
  catalog?: ModelCatalog | undefined
  model?: ModelSelection | undefined
  permission?: { choices: readonly Choice[], current: string } | undefined
  /** Only before DSH creates the session: the preset composes the Agent. */
  preset?: { choices: readonly Choice[], current: string } | undefined
  plan?: Switch | undefined
  /** DSH's Team mode, the 「启用智能体团队协作」 switch of its model menu. */
  team?: Switch | undefined
}

/**
 * `JSON.stringify([provider, model])`, the value the official dsh-acp sends: model IDs may contain
 * slashes, and clients that know DSH read the same value from either agent.
 */
export function modelValue(selection: Pick<ModelSelection, 'provider' | 'model'>): string {
  return JSON.stringify([selection.provider, selection.model])
}

/** A model value, or the `provider/model` form earlier releases sent (the provider ends at the first slash). */
export function parseModelValue(value: string): Pick<ModelSelection, 'provider' | 'model'> | undefined {
  if (value.startsWith('[')) {
    try {
      const pair: unknown = JSON.parse(value)
      if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[0] && typeof pair[1] === 'string' && pair[1]) {
        return { provider: pair[0], model: pair[1] }
      }
    } catch { /* not a pair */ }
    return undefined
  }
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

export function findModel(catalog: ModelCatalog | undefined, value: string): { provider: string, entry: ModelCatalogModel } | undefined {
  const parsed = parseModelValue(value)
  if (!parsed) return undefined
  const entry = catalog?.groups.find(group => group.id === parsed.provider)?.models.find(item => item.id === parsed.model)
  return entry ? { provider: parsed.provider, entry } : undefined
}

export function catalogEntry(catalog: ModelCatalog | undefined, selection: ModelSelection | undefined): ModelCatalogModel | undefined {
  if (!selection) return undefined
  return catalog?.groups.find(group => group.id === selection.provider)?.models.find(item => item.id === selection.model)
}

/** The effort to keep when switching to `entry`: the current one if offered, else the model's default. */
export function carriedEffort(entry: ModelCatalogModel, current: string | undefined): string | undefined {
  const efforts = entry.reasoning?.efforts ?? []
  if (current && efforts.some(effort => effort.id === current)) return current
  return entry.reasoning?.defaultEffort
}

function choice(item: Choice): SessionConfigSelectOption {
  return { value: item.id, name: item.name, ...(item.description ? { description: item.description } : {}) }
}

function modelOptions(catalog: ModelCatalog | undefined, current: ModelSelection | undefined): SessionConfigSelectGroup[] | SessionConfigSelectOption[] {
  const routable = new Set(catalog?.routableProviders ?? [])
  const groups = (catalog?.groups ?? []).filter(group => !routable.size || routable.has(group.id))
    .map(group => ({ group: group.id, name: group.name, options: group.models.map(model => ({
      value: modelValue({ provider: group.id, model: model.id }), name: model.name,
      ...(model.description ? { description: model.description } : {}),
    })) }))
    .filter(group => group.options.length)
  if (current && !groups.some(group => group.options.some(option => option.value === modelValue(current)))) {
    groups.push({ group: current.provider, name: current.provider, options: [{ value: modelValue(current), name: current.model }] })
  }
  return groups.length === 1 ? groups[0]!.options : groups
}

export function configOptions(state: ConfigState): SessionConfigOption[] {
  const options: SessionConfigOption[] = []
  const model = state.model ?? state.catalog?.default
  if (model) {
    options.push({ id: OPTION.model, name: '模型', category: 'model', type: 'select',
      currentValue: modelValue(model), options: modelOptions(state.catalog, model) })
    const reasoning = catalogEntry(state.catalog, model)?.reasoning
    if (reasoning?.efforts.length) {
      const efforts = reasoning.efforts.map(effort => choice({ id: effort.id, name: effort.name, ...(effort.description ? { description: effort.description } : {}) }))
      const current = model.reasoningEffort ?? reasoning.defaultEffort ?? DEFAULT_EFFORT
      const list = reasoning.defaultEffort ? efforts : [{ value: DEFAULT_EFFORT, name: '默认' }, ...efforts]
      if (!list.some(option => option.value === current)) list.push({ value: current, name: current })
      options.push({ id: OPTION.effort, name: '推理强度', category: 'thought_level', type: 'select', currentValue: current, options: list })
    }
  }
  if (state.permission?.choices.length) {
    const list = state.permission.choices.map(choice)
    if (!list.some(option => option.value === state.permission!.current)) list.push({ value: state.permission.current, name: state.permission.current })
    options.push({ id: OPTION.permission, name: '权限', category: 'mode', type: 'select', currentValue: state.permission.current, options: list })
  }
  if (state.preset?.choices.length) {
    options.push({ id: OPTION.preset, name: 'Agent 模式', description: '只能在发送第一条消息前选择。', type: 'select',
      currentValue: state.preset.current, options: state.preset.choices.map(choice) })
  }
  if (state.plan) options.push(switchOption(OPTION.plan, '计划模式', undefined, state.plan))
  if (state.team) {
    options.push(switchOption(OPTION.team, '智能体团队协作',
      '开启后 Agent 可以组建子 Agent 团队，用共享任务板分工协作；会话开始后关闭可能影响缓存复用，增加后续 token 用量。', state.team))
  }
  return options
}

function switchOption(id: string, name: string, description: string | undefined, state: Switch): SessionConfigOption {
  return state.booleanOptions
    ? { id, name, ...(description ? { description } : {}), type: 'boolean', currentValue: state.active }
    : { id, name, ...(description ? { description } : {}), type: 'select', currentValue: state.active ? 'on' : 'off',
      options: [{ value: 'off', name: '关闭' }, { value: 'on', name: '开启' }] }
}

/** An on/off value from either the boolean or the select form. */
export function switchValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'on' || value === 'true') return true
  if (value === 'off' || value === 'false') return false
  return undefined
}
