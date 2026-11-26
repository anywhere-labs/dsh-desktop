/**
 * Layered context compression and durable long-term memory for DSH Desktop.
 *
 * Upstream `compaction-basic` already folds long spans of the session surface
 * into L1 segment-summary checkpoints (`<compacted-summary>` user messages).
 * This plugin adds the two layers above it, so the context pyramid becomes
 * L0 original -> L1 segment summary -> L2 session summary -> L3 long-term
 * memory, with each layer a condensation of the one below:
 *
 * - L2 (session summary): when one session accumulates `foldEvery` L1
 *   checkpoints, this plugin condenses them into a single session-level
 *   summary through one `ctx.llm.stream()` call.
 * - L3 (long-term memory): that session summary is stored durably in the
 *   `desktop_memory` KV domain (per-record, on the shipped json backend), so
 *   it survives the session and can be recalled on resume.
 *
 * The short-term/long-term boundary is the recall step: L0–L2 live in the live
 * context, while L3 lives on disk and re-enters context as a `user/message`
 * (source kind `desktop-memory`) at the first step of a turn — once per memory
 * version — when `recall` is enabled. Fold input, fold output at recall, file
 * recall, and the durable record itself are all bounded; identical fold output
 * refreshes metadata without bumping the recall version, and `memoryTtlDays`
 * (0 = forever) can expire records so stale summaries stop re-entering context.
 *
 * The optional `fileIndex`/`fileRecall` pair adds a second durable surface: the
 * `index_file` tool stores a marked file's path, reason, and bounded head
 * content into the `files` table of the same domain (the domain is single-open,
 * so the tool lives here rather than in a separate plugin), and `fileRecall`
 * re-provides the remembered-file list (source kind `desktop-files`) at the
 * first step of a turn. Both default off.
 *
 * @module dsh-plugin-desktop-beta/context
 *
 * NOTE (2026-10-23): the shipped profile enables this plugin with
 * `fileIndex`/`fileRecall` off. The L2 fold is deliberately additive; upstream
 * `compaction-basic` still owns L1/L2 compaction. Recall injects only a newly
 * folded memory version once per turn, never the raw history.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { BlockAssembler, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
// Type-only: activates the `compaction/summary` SessionEventMap augmentation so
// the `session/event` listener below can match it.
import type {} from '@deepseek-ai/dsh-compaction'

/** Durable source for a long-term memory message injected at turn start. */
interface DesktopMemorySource {
  kind: 'desktop-memory'
  form: 'recall'
  version: 1
  sessionId: string
  foldedSummaries: number
}

/** Durable source for the indexed-file list injected at turn start. */
interface DesktopFilesSource {
  kind: 'desktop-files'
  form: 'recall'
  version: 1
  sessionId: string
  fileCount: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface LlmRequestPurposeMap {
    compaction: true
  }

  interface MessageSourceMap {
    'desktop-memory': DesktopMemorySource
    'desktop-files': DesktopFilesSource
  }
}

const memoryRecord = zod.object({
  /** Condensation level; `session` is the folded L2 summary stored as L3 memory. */
  level: zod.enum(['session', 'longterm']),
  /** The folded summary text. */
  content: zod.string(),
  /** How many L1 checkpoints were folded into this record. */
  foldedSummaries: zod.number().int().nonnegative(),
  /** Creation time in Unix epoch milliseconds; also the recall version key. */
  createdAt: zod.number().int().nonnegative(),
  /** Last write time in Unix epoch milliseconds (dedup refreshes without re-injecting). */
  updatedAt: zod.number().int().nonnegative().optional(),
  /** Expiry time in Unix epoch milliseconds; absent means the record never expires. */
  expiresAt: zod.number().int().nonnegative().optional(),
  /** Where the record came from; `fold` for plugin-condensed summaries. */
  source: zod.enum(['fold']).optional(),
})

/** One indexed "important file": its path, why it matters, and bounded head content. */
const fileRecord = zod.object({
  /** Absolute path of the indexed file. */
  path: zod.string(),
  /** Why the file matters; empty when the model gave no reason. */
  note: zod.string(),
  /** Bounded head of the file's text content, cached as future RAG seed material. */
  content: zod.string(),
  /** Whether `content` was truncated to the size bound. */
  truncated: zod.boolean(),
  /** Creation time in Unix epoch milliseconds. */
  createdAt: zod.number().int().nonnegative(),
})

const memorySpec = defineDomain({
  name: 'desktop_memory',
  version: 1,
  // One document per session: a write rewrites only that session's record, and
  // a corrupt record can be moved aside without discarding the whole unit.
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    memories: domainTable(memoryRecord),
    files: domainTable(fileRecord),
  },
})

/** Stable Cordis plugin name. */
export const name = 'desktop-context'

/** Durable KV domain facility required to open the long-term memory store. */
export const inject = ['storageDomain']

/** Layered-compression and recall policy. */
export interface Config {
  /** Number of L1 checkpoints to fold into one durable L2 session summary. */
  foldEvery: number
  /** Token cap for the L2 summarization call. */
  maxTokens: number
  /** Provider for the L2 call; empty inherits the L1 checkpoint's route. */
  l2Provider: string
  /** Model for the L2 call; empty inherits the L1 checkpoint's route. */
  l2Model: string
  /** Inject the durable session summary at the first step of a turn. */
  recall: boolean
  /** Days a folded memory stays recallable; 0 keeps it forever. */
  memoryTtlDays: number
  /** Register the `index_file` tool and persist marked files into the `files` table. */
  fileIndex: boolean
  /** Inject the indexed-file list (paths and notes) at the first step of a turn. */
  fileRecall: boolean
}

/** Validated layered-compression and recall policy. */
export const Config: z<Config> = z.object({
  foldEvery: z.number().step(1).min(1).max(64).default(4),
  maxTokens: z.number().step(1).min(128).max(16_384).default(1024),
  l2Provider: z.string().default(''),
  l2Model: z.string().default(''),
  recall: z.boolean().default(true),
  memoryTtlDays: z.number().step(1).min(0).max(3650).default(0),
  fileIndex: z.boolean().default(false),
  fileRecall: z.boolean().default(false),
})

/** Frames the recalled memory as established context for the model. */
const RECALL_PREAMBLE =
  'This is your durable long-term memory for this session, saved from earlier conversation. Treat it as established context and build on it without restating it.'

/** Frames the recalled indexed-file list as established context for the model. */
const FILES_RECALL_PREAMBLE =
  'These are the files you previously marked as important, remembered across sessions. Treat the list as established context; use the read tool to inspect a file when its contents matter.'

/** Model-facing guidance for the `index_file` tool. */
const INDEX_FILE_DESCRIPTION =
  'Mark a file as important so it is remembered across sessions. '
  + 'Reads the file and stores its path, your reason for marking it, and a bounded head of its text content in durable memory; '
  + 'on later sessions the remembered file list is re-provided. Use it for files the user will likely need again, not for every file you read.'

/** Hard read bound for a file the model marks important (guards memory use). */
const MAX_INDEX_FILE_BYTES = 1_048_576
/** Hard character bound for the cached head content (guards context bloat on recall). */
const MAX_INDEX_CONTENT_CHARS = 16_000
/** Hard character bound for one L1 checkpoint sent to the L2 fold. */
const MAX_FOLD_CHECKPOINT_CHARS = 8_000
/** Hard character bound for all L1 checkpoints in one L2 fold request. */
const MAX_FOLD_INPUT_CHARS = 24_000
/** Hard character bound for recalled durable memory (a fold output is model-authored). */
const MAX_RECALL_CHARS = 12_000
/** Hard character bound for the recalled file list. */
const MAX_FILES_RECALL_CHARS = 12_000
const DAY_MS = 86_400_000

/** Canonical output of `index_file`: what was indexed and how it was bounded. */
const INDEX_FILE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    indexed: { type: 'boolean', required: true },
    truncated: { type: 'boolean', required: true },
    bytes: { type: 'integer', required: true },
  },
} as const

/** Instruction appended after the accumulated L1 checkpoints for the L2 fold. */
const FOLD_INSTRUCTION = [
  'Condense the conversation checkpoints below into a single session-level summary.',
  'Merge all checkpoints: preserve still-relevant facts and decisions, and drop anything a later checkpoint supersedes.',
  '',
  'Output a concise Markdown summary covering: the primary goal, key decisions and constraints, the current state, and the next step.',
  'Do not mention that the context was compacted or that this is a summarization request.',
].join('\n')

/** Concatenate the text blocks of a model output. */
function textOf(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/**
 * Bound the checkpoint batch before it enters one L2 fold request. Each
 * checkpoint is capped, then the newest whole checkpoints are kept within the
 * total budget; later checkpoints supersede earlier ones, so dropping the
 * oldest loses the least information.
 * @param summaries - chronological L1 checkpoint texts.
 * @returns checkpoint markdown plus an omission note when any were dropped.
 */
function boundCheckpoints(summaries: readonly string[]): string {
  const bounded = summaries.map(summary => summary.length > MAX_FOLD_CHECKPOINT_CHARS
    ? `${summary.slice(0, MAX_FOLD_CHECKPOINT_CHARS)}\n[checkpoint truncated]`
    : summary)
  const kept: { index: number; text: string }[] = []
  let total = 0
  for (let index = bounded.length - 1; index >= 0; index--) {
    const text = `### Checkpoint ${index + 1}\n${bounded[index]}`
    if (kept.length > 0 && total + text.length > MAX_FOLD_INPUT_CHARS) break
    kept.unshift({ index, text })
    total += text.length + 2
  }
  const omitted = summaries.length - kept.length
  const note = omitted === 0 ? '' : `[${omitted} earlier checkpoint(s) omitted to fit the fold budget]\n\n`
  return note + kept.map(entry => entry.text).join('\n\n')
}

/**
 * Bound model-authored memory before it re-enters context. The fold output is
 * conditioned on bounded input, but a provider can still return more than the
 * recall budget, so recall enforces its own hard cap.
 * @param text - durable memory content.
 * @returns content within the recall budget, with an explicit truncation mark.
 */
function boundRecallText(text: string): string {
  if (text.length <= MAX_RECALL_CHARS) return text
  return `${text.slice(0, MAX_RECALL_CHARS)}\n\n[durable memory truncated at ${MAX_RECALL_CHARS} characters]`
}

/**
 * Register the durable memory store, the L1->L2 fold observer, the optional
 * `index_file` tool, and the recall injection at turn start.
 * @param ctx - Host context carrying the storage domain facility.
 * @param config - validated fold, recall, and file-index values.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(memorySpec)
  ctx.effect(
    () => () => { void domain.close() },
    'dsh-plugin-desktop: desktop-context memory domain',
  )
  const memories = domain.table('memories')
  const files = domain.table('files')

  // L1 checkpoints accumulated but not yet folded, per session id.
  const pending = new Map<string, string[]>()
  // Last folded-memory `createdAt` injected per session; prevents re-injecting
  // an unchanged memory on every turn while still recalling a new version.
  const injectedAt = new Map<string, number>()
  // Last injected files-table signature per session; prevents re-injecting an
  // unchanged file list while still recalling a newly marked file.
  const injectedFilesAt = new Map<string, string>()

  /** Stable signature of the files table: sorted `key:createdAt` pairs. */
  function filesSignature(): string {
    const parts: string[] = []
    for (const [key, record] of files.entries()) parts.push(`${key}:${record.createdAt}`)
    parts.sort()
    return parts.join(',')
  }

  /** Render the remembered-file list as a stable, bounded Markdown block for recall. */
  function renderFilesList(): string {
    const records = [...files.entries()].sort((a, b) => a[1].path.localeCompare(b[1].path))
    const lines = [FILES_RECALL_PREAMBLE, '']
    let total = lines.join('\n').length
    let rendered = 0
    for (const [, record] of records) {
      const block = [`## ${record.path}`, ...(record.note.length > 0 ? [`> ${record.note}`] : [])].join('\n')
      if (rendered > 0 && total + block.length + 2 > MAX_FILES_RECALL_CHARS) break
      lines.push(block, '')
      total += block.length + 2
      rendered++
    }
    if (rendered < records.length) {
      lines.push(`(${records.length - rendered} more file(s) omitted to fit the recall budget)`)
    }
    return lines.join('\n').trimEnd()
  }

  /** Read, bound, and persist one important file into the `files` table. */
  async function indexFile(path: string, note: string): Promise<{ path: string; indexed: boolean; truncated: boolean; bytes: number }> {
    const absolute = resolve(path)
    const info = await stat(absolute)
    if (info.size > MAX_INDEX_FILE_BYTES) {
      throw new HarnessError(
        `file is too large to index (${info.size} bytes exceeds the ${MAX_INDEX_FILE_BYTES} byte bound)`,
        'INDEX_FILE_TOO_LARGE',
      )
    }
    const buffer = await readFile(absolute)
    if (buffer.includes(0)) {
      throw new HarnessError('file is not text (contains a null byte)', 'INDEX_FILE_BINARY')
    }
    let content = buffer.toString('utf8')
    const truncated = content.length > MAX_INDEX_CONTENT_CHARS
    if (truncated) content = content.slice(0, MAX_INDEX_CONTENT_CHARS)
    const key = createHash('sha256').update(absolute).digest('hex')
    await files.put(key, {
      path: absolute,
      note,
      content,
      truncated,
      createdAt: Date.now(),
    })
    return { path: absolute, indexed: true, truncated, bytes: buffer.length }
  }

  /** Fold accumulated L1 checkpoints into one durable session summary. */
  async function foldToMemory(session: Session, provider: string, model: string, summaries: string[]): Promise<void> {
    const llm = ctx.get('llm')
    if (llm === undefined) {
      ctx.logger.warn('desktop-context: no llm service mounted; skipping session-summary fold')
      return
    }
    const targetProvider = config.l2Provider.length > 0 ? config.l2Provider : provider
    const targetModel = config.l2Model.length > 0 ? config.l2Model : model
    if (targetProvider.length === 0 || targetModel.length === 0) {
      ctx.logger.warn('desktop-context: no provider/model for the session-summary fold; skipping')
      return
    }
    const checkpoints = boundCheckpoints(summaries)
    const messages: RequestMessage[] = [{
      role: 'user',
      content: [{ type: 'text', text: `${FOLD_INSTRUCTION}\n\n${checkpoints}` }],
    }]
    const options: GenerateOptions = {
      provider: targetProvider,
      model: targetModel,
      messages,
      maxTokens: config.maxTokens,
      sessionId: session.id,
      purpose: 'compaction',
    }
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of llm.stream(options)) assembler.push(chunk)
      if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
        ctx.logger.warn(`desktop-context: session-summary fold failed: ${assembler.finish.failure.message}`)
        return
      }
      const content = textOf(assembler.blocks()).trim()
      if (content.length === 0) {
        ctx.logger.warn('desktop-context: session-summary fold produced no text; skipping')
        return
      }
      const key = String(session.id)
      const now = Date.now()
      const expiresAt = config.memoryTtlDays > 0 ? now + config.memoryTtlDays * DAY_MS : undefined
      const existing = memories.get(key)
      // Identical output means the fold added no information: refresh metadata
      // without changing `createdAt`, so the stable version is not re-injected.
      if (existing !== undefined && existing.content === content) {
        await memories.put(key, {
          ...existing,
          updatedAt: now,
          ...(expiresAt === undefined ? {} : { expiresAt }),
        })
        return
      }
      await memories.put(key, {
        level: 'session',
        content,
        foldedSummaries: summaries.length,
        createdAt: now,
        updatedAt: now,
        source: 'fold',
        ...(expiresAt === undefined ? {} : { expiresAt }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`desktop-context: session-summary fold failed: ${message}`)
    }
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'compaction/summary') return
    const summary = textOf(event.data.summary).trim()
    if (summary.length === 0) return
    const sessionId = String(session.id)
    const batch = pending.get(sessionId) ?? []
    batch.push(summary)
    if (batch.length < config.foldEvery) {
      pending.set(sessionId, batch)
      return
    }
    pending.delete(sessionId)
    void foldToMemory(session, event.data.provider, event.data.model, batch)
  })

  // The `index_file` tool writes into the already-open `files` table; a separate
  // plugin cannot open `desktop_memory` again (the domain is single-open), so it
  // lives here, gated behind `fileIndex` (default off).
  if (config.fileIndex) {
    const tools = ctx.get('tools')
    if (tools === undefined) {
      ctx.logger.warn('desktop-context: no tools service mounted; index_file tool unavailable')
    } else {
      ctx.effect(
        () => tools.register(defineTool({
          name: 'index_file',
          description: INDEX_FILE_DESCRIPTION,
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Path of the file to remember; relative paths resolve from the working directory.',
            },
            note: {
              type: 'string',
              description: 'Short reason this file matters and what it is for.',
            },
          },
          output: {
            schema: INDEX_FILE_OUTPUT_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          execute: (args) => indexFile(args.path, args.note ?? ''),
          presentCall: (args): ToolCallView => ({
            card: 'generic',
            title: 'Index file',
            kind: 'other',
            rawInput: args.path,
          }),
        })),
        'dsh-plugin-desktop: desktop-context index_file tool',
      )
    }
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const sessionId = String(agent.session.id)
    const injected: UserMessage[] = []

    if (config.recall) {
      const record = memories.get(sessionId)
      const ttlMs = config.memoryTtlDays * DAY_MS
      // Records written before TTL was enabled have no `expiresAt`; fall back to
      // their creation time so enabling TTL also ages out legacy memory.
      const expiresAt = record === undefined
        ? undefined
        : record.expiresAt ?? (ttlMs > 0 ? record.createdAt + ttlMs : undefined)
      const expired = expiresAt !== undefined && expiresAt <= Date.now()
      if (record !== undefined && !expired && injectedAt.get(sessionId) !== record.createdAt) {
        injectedAt.set(sessionId, record.createdAt)
        const source: DesktopMemorySource = {
          kind: 'desktop-memory',
          form: 'recall',
          version: 1,
          sessionId,
          foldedSummaries: record.foldedSummaries,
        }
        injected.push(createUserMessage({
          source,
          content: [{ type: 'text', text: `${RECALL_PREAMBLE}\n\n${boundRecallText(record.content)}` }],
        }))
      }
    }

    if (config.fileRecall) {
      const signature = filesSignature()
      if (signature.length > 0 && injectedFilesAt.get(sessionId) !== signature) {
        injectedFilesAt.set(sessionId, signature)
        const source: DesktopFilesSource = {
          kind: 'desktop-files',
          form: 'recall',
          version: 1,
          sessionId,
          fileCount: files.size,
        }
        injected.push(createUserMessage({
          source,
          content: [{ type: 'text', text: renderFilesList() }],
        }))
      }
    }

    if (injected.length === 0) return decision
    return { ...decision, messages: [...injected, ...decision.messages] }
  }, { prepend: true })
}
