/**
 * Pure conversions between ACP and DSH: prompt input, tool cards, stop
 * reasons and question forms. No I/O, so every rule here is unit-tested.
 */

import type {
  ContentBlock as AcpContent, SessionUpdate, StopReason, ToolCallContent, ToolCallLocation, ToolKind, Usage,
} from '@agentclientprotocol/sdk'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Fields = Record<string, unknown>

export function record(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {}
}

/** Largest text a single tool card or chunk carries; the rest is summarized. */
export const MAX_TEXT = 200_000
/** Structured raw output is for programs, and stays small: the card content carries the full text. */
const MAX_RAW = 20_000

export function clip(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断 ${text.length - max} 个字符）`
}

/** A prompt the bridge refuses before anything reaches DSH. */
export class PromptError extends Error {
  constructor(message: string) { super(message); this.name = 'PromptError' }
}

const IMAGE_TYPES = new Map([
  ['image/png', 'image/png'], ['image/jpeg', 'image/jpeg'], ['image/jpg', 'image/jpeg'],
  ['image/webp', 'image/webp'], ['image/gif', 'image/gif'],
] as const)
type ImageMediaType = Extract<PromptContentPart, { type: 'image' }>['mediaType']

export function imageMediaType(mimeType: string | null | undefined): ImageMediaType | undefined {
  return IMAGE_TYPES.get((mimeType ?? '').toLowerCase() as never)
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function leaf(uri: string): string {
  const path = uri.split(/[?#]/u)[0] ?? uri
  const name = path.slice(path.lastIndexOf('/') + 1)
  try { return decodeURIComponent(name) || uri } catch { return name || uri }
}

/** `file://` links read as their local path; anything else keeps its URI. */
function displayUri(uri: string): string {
  if (!uri.startsWith('file:')) return uri
  try { return fileURLToPath(uri) } catch { return uri }
}

function imagePart(data: string, mimeType: string | null | undefined, uri: string | null | undefined): PromptContentPart {
  const mediaType = imageMediaType(mimeType)
  if (!mediaType) throw new PromptError(`不支持的图片类型：${mimeType ?? '未知'}，只支持 PNG、JPEG、WebP、GIF。`)
  if (!data || !BASE64.test(data)) throw new PromptError('图片数据必须是标准 base64。')
  return { type: 'image', mediaType, data, ...(uri ? { name: leaf(uri) } : {}) }
}

/**
 * ACP prompt blocks → DSH prompt parts. Adjacent text is joined, resource links
 * become markdown links, embedded text resources become tagged context; audio
 * and binary resources that are not images are refused.
 */
export function promptParts(blocks: readonly AcpContent[]): PromptContentPart[] {
  const parts: PromptContentPart[] = []
  let text = ''
  const flush = () => { if (text) { parts.push({ type: 'text', text }); text = '' } }
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        text += block.text
        break
      case 'image':
        flush()
        parts.push(imagePart(block.data, block.mimeType, block.uri))
        break
      case 'resource_link':
        text += `[${block.title || block.name}](${displayUri(block.uri)})`
        break
      case 'resource': {
        const resource = block.resource
        if ('text' in resource && typeof resource.text === 'string') {
          const type = resource.mimeType ? ` mimeType="${resource.mimeType}"` : ''
          text += `\n<context uri="${displayUri(resource.uri)}"${type}>\n${resource.text}\n</context>\n`
        } else if ('blob' in resource && imageMediaType(resource.mimeType)) {
          flush()
          parts.push(imagePart(resource.blob, resource.mimeType, resource.uri))
        } else {
          throw new PromptError('不支持嵌入二进制资源，请改为文件链接或图片。')
        }
        break
      }
      case 'audio':
        throw new PromptError('DSH 不支持音频输入。')
      default:
        throw new PromptError(`不支持的输入内容：${(block as { type?: unknown }).type as string}`)
    }
  }
  flush()
  if (!parts.some(part => part.type !== 'text' || part.text.trim())) throw new PromptError('消息不能为空。')
  return parts
}

/** The slash command a prompt starts with, when its first block is text. */
export function slashCommand(blocks: readonly AcpContent[]): { name: string, line: string } | undefined {
  const first = blocks[0]
  if (first?.type !== 'text') return undefined
  const line = blocks.filter(block => block.type === 'text').map(block => block.text).join('').trim()
  const match = /^\/([A-Za-z0-9][\w:.-]*)(?=\s|$)/u.exec(line)
  return match ? { name: match[1]!, line } : undefined
}

/** DSH turn end → ACP stop reason, or the failure the prompt must report. */
export function stopReason(reason: unknown, cancelRequested: boolean): { stopReason: StopReason } | { error: string } {
  const value = record(reason)
  switch (value.kind) {
    case 'completed': return { stopReason: cancelRequested ? 'cancelled' : 'end_turn' }
    case 'max-tokens': return { stopReason: 'max_tokens' }
    case 'interrupted': return { stopReason: 'cancelled' }
    case 'aborted': return { stopReason: record(value.reason).kind === 'hook' && !cancelRequested ? 'end_turn' : 'cancelled' }
    case 'error': {
      if (cancelRequested) return { stopReason: 'cancelled' }
      const error = record(value.error)
      const message = typeof error.message === 'string' && error.message ? error.message
        : typeof error.code === 'string' ? error.code : '模型请求失败'
      return { error: `DSH 这一轮执行失败：${message}` }
    }
    default: return { stopReason: cancelRequested ? 'cancelled' : 'end_turn' }
  }
}

/** Token counts of one turn, summed over its assistant messages. */
export function addUsage(total: Usage | undefined, usage: unknown): Usage | undefined {
  const value = record(usage)
  if (typeof value.inputTokens !== 'number' || typeof value.outputTokens !== 'number') return total
  const sum = (a: number | null | undefined, b: unknown) => (a ?? 0) + (typeof b === 'number' ? b : 0)
  return {
    inputTokens: sum(total?.inputTokens, value.inputTokens),
    outputTokens: sum(total?.outputTokens, value.outputTokens),
    totalTokens: sum(total?.totalTokens, typeof value.totalTokens === 'number' ? value.totalTokens : value.inputTokens + value.outputTokens),
    ...(value.reasoningTokens !== undefined || total?.thoughtTokens != null ? { thoughtTokens: sum(total?.thoughtTokens, value.reasoningTokens) } : {}),
    ...(value.cacheReadTokens !== undefined || total?.cachedReadTokens != null ? { cachedReadTokens: sum(total?.cachedReadTokens, value.cacheReadTokens) } : {}),
    ...(value.cacheWriteTokens !== undefined || total?.cachedWriteTokens != null ? { cachedWriteTokens: sum(total?.cachedWriteTokens, value.cacheWriteTokens) } : {}),
  }
}

/**
 * The records of a step in progress (`activeAttempt.stream` in a follow
 * snapshot) as stream chunks. DSH stores runs of deltas compactly; undefined
 * when a record has a shape this bridge does not know, so the caller can fall
 * back to the committed message instead of showing part of the step.
 */
export function expandStreamRecords(records: readonly unknown[]): Fields[] | undefined {
  const chunks: Fields[] = []
  for (const raw of records) {
    const item = record(raw)
    switch (item.type) {
      case 'text-chunks':
      case 'reasoning-chunks': {
        if (typeof item.index !== 'number' || !Array.isArray(item.texts)) return undefined
        const type = item.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta'
        for (const text of item.texts) {
          if (typeof text !== 'string') return undefined
          chunks.push({ type, index: item.index, text })
        }
        break
      }
      case 'tool-call-chunks':
        break
      case 'chunk':
        if (record(item.chunk).type === undefined) return undefined
        chunks.push(record(item.chunk))
        break
      default:
        return undefined
    }
  }
  return chunks
}

// ── tool cards ────────────────────────────────────────────────────────────

const KINDS: readonly ToolKind[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']

/** Fallback when no presenter is visible, for example while replaying a cold session. */
export function toolKind(name: string): ToolKind {
  if (['bash', 'pwsh', 'terminal_open', 'terminal_send'].includes(name)) return 'execute'
  if (['read', 'job_output', 'terminal_read'].includes(name)) return 'read'
  if (['write', 'edit', 'apply_patch', 'str_replace_editor'].includes(name)) return 'edit'
  if (['glob', 'grep', 'session_search', 'session_event_search'].includes(name)) return 'search'
  if (['web_fetch', 'web_search'].includes(name)) return 'fetch'
  if (['todo_write'].includes(name)) return 'think'
  return 'other'
}

export function parseArguments(text: unknown): unknown {
  if (typeof text !== 'string') return text
  try { return JSON.parse(text) as unknown } catch { return text }
}

/** DSH model-facing content → ACP content; images need bytes and are passed in resolved. */
export function textContent(text: string): ToolCallContent {
  return { type: 'content', content: { type: 'text', text: clip(text) } }
}

function locations(value: readonly { path: string, line?: number }[] | undefined): ToolCallLocation[] | undefined {
  return value?.length ? value.map(location => ({ path: location.path, ...(location.line ? { line: location.line } : {}) })) : undefined
}

function diffs(value: readonly { path: string, oldText: string | null, newText: string }[]): ToolCallContent[] {
  return value.map(diff => ({ type: 'diff', path: diff.path, oldText: diff.oldText, newText: diff.newText }))
}

export function blockText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map(block => {
    const value = record(block)
    if (value.type === 'text' && typeof value.text === 'string') return value.text
    if (value.type === 'image') return '[图片]'
    if (value.type === 'file') return `[文件 ${typeof record(value.attachment).name === 'string' ? record(value.attachment).name as string : ''}]`
    return ''
  }).filter(Boolean).join('\n')
}

/** The card a `tool/call` opens, from the tool's own presentation when available. */
export function toolCallUpdate(callId: string, name: string, args: unknown, view: ToolCallView | undefined): SessionUpdate {
  const base = { sessionUpdate: 'tool_call' as const, toolCallId: callId, name, status: 'in_progress' as const }
  if (!view) return { ...base, title: name, kind: toolKind(name), rawInput: args }
  switch (view.card) {
    case 'diff': {
      const where = locations(view.locations)
      return { ...base, title: view.title, kind: 'edit', rawInput: args, content: diffs(view.diffs), ...(where ? { locations: where } : {}) }
    }
    case 'terminal':
      return { ...base, title: view.title, kind: 'execute', rawInput: args,
        ...(view.description ? { content: [textContent(view.description)] } : {}) }
    default: {
      const where = locations(view.locations)
      const content = blockText(view.content)
      return { ...base, title: view.title, kind: view.kind && KINDS.includes(view.kind) ? view.kind : toolKind(name),
        rawInput: view.rawInput ?? args, ...(content ? { content: [textContent(content)] } : {}), ...(where ? { locations: where } : {}) }
    }
  }
}

function searchText(view: Extract<ToolResultView, { card: 'search' }>): string {
  const lines = view.shape === 'paths'
    ? view.paths
    : view.files.flatMap(file => file.matches.map(match => `${file.path}:${match.lineNumber}: ${match.line}`))
  return `${lines.join('\n')}${view.truncated ? `\n…（共 ${view.total} 项，只列出一部分）` : ''}`
}

function fence(text: string, language = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map(match => match[0].length))
  const ticks = '`'.repeat(longest + 1)
  return `${ticks}${language}\n${text}\n${ticks}`
}

/**
 * The update a `tool/result` closes the card with. `images` holds the result's
 * images already converted for ACP, in content order.
 */
export function toolResultUpdate(callId: string, failed: boolean, resultContent: unknown, view: ToolResultView | undefined,
  images: readonly ToolCallContent[] = []): SessionUpdate {
  const status = failed ? 'failed' as const : 'completed' as const
  const base = { sessionUpdate: 'tool_call_update' as const, toolCallId: callId, status }
  const plain = blockText(resultContent)
  if (!view || failed) return { ...base, content: [...(plain ? [textContent(plain)] : []), ...images] }
  switch (view.card) {
    case 'diff':
      return { ...base, content: diffs(view.diffs) }
    case 'terminal': {
      const output = view.output ?? plain
      const exit = view.exitCode !== undefined ? `退出码 ${view.exitCode}` : view.signal ? `信号 ${view.signal}` : ''
      return { ...base, content: [textContent(`${output ? fence(clip(output)) : ''}${output && exit ? '\n' : ''}${exit}`)],
        rawOutput: { output: clip(output, MAX_RAW), ...(view.exitCode !== undefined ? { exitCode: view.exitCode } : {}), ...(view.signal ? { signal: view.signal } : {}) } }
    }
    case 'search':
      return { ...base, content: [textContent(searchText(view))] }
    case 'read': {
      const body = view.lines.map(line => line.text).join('\n')
      return { ...base, content: [textContent(fence(clip(body), view.lang ?? '')), ...images],
        locations: [{ path: view.path, line: view.offset }] }
    }
    case 'web': {
      const text = view.kind === 'search'
        ? [view.answer ?? '', ...view.sources.map(source => `- [${source.title ?? source.url}](${source.url})${source.snippet ? `：${source.snippet}` : ''}`)].filter(Boolean).join('\n')
        : `${view.url}（HTTP ${view.statusCode}）${view.truncated ? '，内容已截断' : ''}`
      return { ...base, content: [textContent(text)] }
    }
    default: {
      const content = blockText(view.content) || plain
      return { ...base, content: [...(content ? [textContent(content)] : []), ...images] }
    }
  }
}

// ── questions ─────────────────────────────────────────────────────────────

interface QuestionOption { label: string, description?: string }
interface Question {
  id: string, question: string, header?: string, detail?: string, options: QuestionOption[], multiSelect: boolean,
  /** Approval questions accept only their offered actions. */
  fixed: boolean,
}
export interface QuestionAnswer { answers: { id: string, selected: string[], custom?: string }[] }

export interface QuestionForm {
  message: string
  schema: { type: 'object', properties: Record<string, Fields>, required: string[] }
  answer(content: Fields): QuestionAnswer | undefined
}

type ChoiceKind = 'allow_once' | 'allow_always' | 'reject_once'

/** One question offered as the options of a permission request. */
export interface ChoiceQuestion {
  id: string
  title: string
  detail?: string
  options: { optionId: string, name: string, kind: ChoiceKind, label: string }[]
}

const PLAN_REVIEW_TITLE = '批准这个计划并退出计划模式？'
/** DSH's plan review declines with this label; a review that names another keeps it. */
const KEEP_PLANNING = 'Keep planning'

function localized(text: unknown): string | undefined {
  const value = record(text)
  for (const key of ['zh-CN', 'zh', 'en']) if (typeof value[key] === 'string' && value[key]) return value[key] as string
  return undefined
}

/**
 * DSH `ask_user_question` questions as permission-request options, which every
 * ACP client shows, for clients without form elicitation. Undefined when any
 * question allows several choices or a typed answer, which only a form can
 * collect. Option kinds follow the intent: an approval grants or refuses, a
 * plan review approves; any other choice counts as a selection.
 */
export function questionChoices(raw: unknown): ChoiceQuestion[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const questions: ChoiceQuestion[] = []
  for (const item of raw) {
    const value = record(item)
    const options = Array.isArray(value.options) ? value.options.map(record) : []
    if (typeof value.id !== 'string' || !value.id || typeof value.question !== 'string' || value.multiSelect === true
      || !options.length || options.some(option => typeof option.label !== 'string' || !option.label)) return undefined
    const intent = record(value.intent)
    const review = intent.kind === 'plan-review', approval = intent.kind === 'approval'
    const header = typeof value.header === 'string' && value.header ? value.header : undefined
    const title = review ? PLAN_REVIEW_TITLE
      : (approval ? localized(record(intent.display).question) : undefined) ?? (header ? `${header}：${value.question}` : value.question)
    const detail = typeof value.detail === 'string' && value.detail ? value.detail : undefined
    questions.push({
      id: value.id, title, ...(detail ? { detail } : {}),
      options: options.map((option, index) => {
        const label = option.label as string
        const kind: ChoiceKind = approval ? (label === intent.always ? 'allow_always' : label === intent.reject ? 'reject_once' : 'allow_once')
          : review && label !== intent.approve ? 'reject_once' : 'allow_once'
        const description = typeof option.description === 'string' && option.description ? option.description : undefined
        const name = review ? (label === intent.approve ? '批准计划' : label === KEEP_PLANNING ? '继续规划' : label)
          : description ? `${label}（${description}）` : label
        return { optionId: `option-${index}`, name, kind, label }
      }),
    })
  }
  return questions
}

const CUSTOM_SUFFIX = '__custom'

/** DSH `ask_user_question` questions → an ACP form elicitation; undefined for shapes it cannot express. */
export function questionForm(raw: unknown): QuestionForm | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const questions: Question[] = []
  const ids = new Set<string>()
  for (const item of raw) {
    const value = record(item)
    if (typeof value.id !== 'string' || !value.id || ids.has(value.id) || typeof value.question !== 'string') return undefined
    ids.add(value.id)
    const options: QuestionOption[] = []
    for (const option of Array.isArray(value.options) ? value.options : []) {
      const entry = record(option)
      if (typeof entry.label !== 'string' || !entry.label) return undefined
      options.push({ label: entry.label, ...(typeof entry.description === 'string' && entry.description ? { description: entry.description } : {}) })
    }
    const intent = record(value.intent)
    questions.push({
      id: value.id, question: value.question, options, multiSelect: value.multiSelect === true,
      fixed: intent.kind === 'approval',
      ...(typeof value.header === 'string' && value.header ? { header: value.header } : {}),
      ...(typeof value.detail === 'string' && value.detail ? { detail: value.detail } : {}),
    })
  }
  const keys = new Set(questions.map(question => question.id))
  const custom = new Map<string, string>()
  const properties: Record<string, Fields> = {}
  const required: string[] = []
  questions.forEach((question, index) => {
    const title = question.header ?? `问题 ${index + 1}`
    const description = question.detail ? `${question.question}\n\n${question.detail}` : question.question
    const choices = question.options.map(option => ({ const: option.label, title: option.description ? `${option.label}（${option.description}）` : option.label }))
    if (!question.options.length) {
      properties[question.id] = { type: 'string', title, description }
      required.push(question.id)
      return
    }
    properties[question.id] = question.multiSelect
      ? { type: 'array', title, description, items: { anyOf: choices } }
      : { type: 'string', title, description, oneOf: choices }
    if (question.fixed) { required.push(question.id); return }
    let key = `${question.id}${CUSTOM_SUFFIX}`
    while (keys.has(key)) key = `${key}_`
    keys.add(key)
    custom.set(question.id, key)
    properties[key] = { type: 'string', title: `${title}：其他回答`,
      description: question.multiSelect ? '没有合适的选项时在这里填写，会和所选项一起提交。' : '没有合适的选项时在这里填写，会代替所选项。' }
  })
  const message = questions.map(question => [question.header, question.question, question.detail].filter(Boolean).join('\n\n')).join('\n\n———\n\n')
  return {
    message,
    schema: { type: 'object', properties, required },
    answer(content) {
      const answers: QuestionAnswer['answers'] = []
      for (const question of questions) {
        const value = content[question.id]
        if (!question.options.length) {
          const text = typeof value === 'string' ? value.trim() : ''
          if (!text) return undefined
          answers.push({ id: question.id, selected: [], custom: text })
          continue
        }
        const labels = new Set(question.options.map(option => option.label))
        const picked = (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value])
          .filter((label): label is string => typeof label === 'string' && labels.has(label))
        const key = custom.get(question.id)
        const extra = key && typeof content[key] === 'string' ? (content[key] as string).trim() : ''
        if (!picked.length && !extra) return undefined
        if (!question.multiSelect && extra) answers.push({ id: question.id, selected: [], custom: extra })
        else if (!question.multiSelect) answers.push({ id: question.id, selected: picked.slice(0, 1) })
        else answers.push({ id: question.id, selected: [...new Set(picked)], ...(extra ? { custom: extra } : {}) })
      }
      return { answers }
    },
  }
}
