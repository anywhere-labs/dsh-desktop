/** ACP session configuration options built from DSH's catalogs. Pure. */

import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption } from '@agentclientprotocol/sdk'
import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller'

export const OPTION = {
  model: 'model',
  effort: 'reasoning_effort',
  permission: 'permission',
  preset: 'agent_preset',
  plan: 'plan_mode',
} as const

/** The effort value that means "the model's own default". */
export const DEFAULT_EFFORT = 'default'

export interface Choice { id: string, name: string, description?: string }

export interface ConfigState {
  catalog?: ModelCatalog | undefined
  model?: ModelSelection | undefined
  permission?: { choices: readonly Choice[], current: string } | undefined
  /** Only before DSH creates the session: the preset composes the Agent. */
  preset?: { choices: readonly Choice[], current: string } | undefined
  plan?: { active: boolean, booleanOptions: boolean } | undefined
}

/** `provider/model`; the provider is everything before the first slash. */
export function modelValue(selection: Pick<ModelSelection, 'provider' | 'model'>): string {
  return `${selection.provider}/${selection.model}`
}

export function findModel(catalog: ModelCatalog | undefined, value: string): { provider: string, entry: ModelCatalogModel } | undefined {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  const provider = value.slice(0, slash), model = value.slice(slash + 1)
  const entry = catalog?.groups.find(group => group.id === provider)?.models.find(item => item.id === model)
  return entry ? { provider, entry } : undefined
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
  if (state.plan) {
    options.push(state.plan.booleanOptions
      ? { id: OPTION.plan, name: '计划模式', type: 'boolean', currentValue: state.plan.active }
      : { id: OPTION.plan, name: '计划模式', type: 'select', currentValue: state.plan.active ? 'on' : 'off',
        options: [{ value: 'off', name: '关闭' }, { value: 'on', name: '开启' }] })
  }
  return options
}

/** A plan-mode value from either the boolean or the select form. */
export function planValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'on' || value === 'true') return true
  if (value === 'off' || value === 'false') return false
  return undefined
}
