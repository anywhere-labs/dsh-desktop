// TinTin 影片聊天的持久化(desktop:chat:* 的后端):官方 src/chat-store.mjs 的存储语义
// (每影片一份 .film/chat.json:sessions/last/turns)+ 官方 file-changes.mjs 的 turn 快照
// 与变更 hunks。存档格式只需被本模块与聊天端经 IPC 往返, 不与官方磁盘格式互通。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { structuredPatch } from 'diff'

type Json = Record<string, unknown>
interface SavedTurn { turn: Json; items: unknown[] }
interface ProjectChat { sessions: unknown[]; last: string | null; turns: SavedTurn[] }

const chatPath = (project: string): string => join(project, '.film', 'chat.json')
const EMPTY = (): ProjectChat => ({ sessions: [], last: null, turns: [] })

function readChat(project: string): ProjectChat {
  try {
    const parsed = JSON.parse(readFileSync(chatPath(project), 'utf8')) as Partial<ProjectChat>
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      last: typeof parsed.last === 'string' ? parsed.last : null,
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
    }
  } catch { return EMPTY() }
}

function writeChat(project: string, chat: ProjectChat): void {
  mkdirSync(join(project, '.film'), { recursive: true })
  const temp = `${chatPath(project)}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(chat, null, 2)}\n`, 'utf8')
  renameSync(temp, chatPath(project))
}

export const filmChat = {
  load(project: string): ProjectChat {
    return readChat(project)
  },
  saveSessions(project: string, sessions: unknown[], last: string | null): void {
    const chat = readChat(project)
    writeChat(project, { ...chat, sessions, last })
  },
  saveTurn(project: string, turn: Json, items: unknown[]): void {
    const chat = readChat(project)
    const id = typeof (turn as { id?: unknown }).id === 'string' ? (turn as { id: string }).id : ''
    const turns = id ? [...chat.turns.filter((t) => (t.turn as { id?: unknown }).id !== id), { turn, items }] : [...chat.turns, { turn, items }]
    writeChat(project, { ...chat, turns })
  },
  /** 一轮的事件日志(.film/logs/<turnId>.jsonl, 由影片智能体桥按 ACP 事件写入; 模型请求明细暂无, calls 恒空). */
  log(project: string, turnId: string): { file: string; cut: boolean; size: number; events: Array<Record<string, unknown>>; calls: unknown[] } | null {
    const file = join(project, '.film', 'logs', `${turnId}.jsonl`)
    if (!existsSync(file)) return null
    const raw = readFileSync(file, 'utf8')
    const lines = raw.split('\n').filter((line) => line.trim() !== '')
    const events: Array<Record<string, unknown>> = []
    for (const line of lines.slice(-200)) {
      try { events.push(JSON.parse(line) as Record<string, unknown>) } catch { events.push({ kind: 'raw', line }) }
    }
    return { file, cut: lines.length > 200, size: raw.length, events, calls: [] }
  },
  /** 有日志而聊天记录里尚无对应存档轮的 turnId(官方 unsavedTurns 语义; except 的跳过). */
  unsavedTurns(project: string, except: string[]): Array<{ turnId: string; events: Array<Record<string, unknown>> }> {
    const logsDir = join(project, '.film', 'logs')
    if (!existsSync(logsDir)) return []
    const saved = new Set(readChat(project).turns.map((t) => String((t.turn as { id?: unknown }).id ?? '')))
    const out: Array<{ turnId: string; events: Array<Record<string, unknown>> }> = []
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const turnId = entry.name.slice(0, -'.jsonl'.length)
      if (except.includes(turnId) || saved.has(turnId)) continue
      const events: Array<Record<string, unknown>> = []
      for (const line of readFileSync(join(logsDir, entry.name), 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { events.push(JSON.parse(line) as Record<string, unknown>) } catch { events.push({ kind: 'raw', line }) }
      }
      out.push({ turnId, events: events.slice(-400) })
    }
    return out
  },
  saveRefImage(project: string, turnId: string, n: number, bytes: ArrayBuffer): { path: string } {
    const dir = join(project, '.film', 'refs')
    mkdirSync(dir, { recursive: true })
    const rel = `.film/refs/${turnId}-${n}.jpg`
    writeFileSync(join(project, rel), Buffer.from(bytes))
    return { path: rel }
  },
  saveAttachment(project: string, name: string, bytes: ArrayBuffer): { path: string } {
    const safe = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 160)
    const dir = join(project, '.film', 'attachments')
    mkdirSync(dir, { recursive: true })
    const rel = `.film/attachments/${safe}`
    writeFileSync(join(project, rel), Buffer.from(bytes))
    return { path: rel }
  },
  describePaths(paths: string[]): Array<{ path: string; folder: boolean; size?: number } | { path: string; error: string }> {
    return paths.map((path) => {
      try {
        const stats = statSync(path)
        return stats.isDirectory() ? { path, folder: true } : { path, folder: false, size: stats.size }
      } catch (error) {
        return { path, error: error instanceof Error ? error.message : String(error) }
      }
    })
  },
}

// ── turn 的文件快照与变更(官方 file-changes.mjs 的存储语义, diff 产 hunks)──────

const SKIP_DIRS = new Set(['.film', 'node_modules', '.git'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

interface Snapshot { dir: string; taken: Map<string, string> }
const snapshots = new Map<string, Snapshot>()
const SNAPSHOTS_MAX = 8

function isText(bytes: Buffer): boolean {
  const probe = bytes.subarray(0, 8000)
  return !probe.includes(0)
}

function walkContents(dir: string, root: string, taken: Map<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkContents(full, root, taken)
    else if (entry.isFile()) {
      try {
        const stats = statSync(full)
        if (stats.size > MAX_FILE_BYTES) continue
        const bytes = readFileSync(full)
        if (!isText(bytes)) continue
        taken.set(relative(root, full).replace(/\\/g, '/'), bytes.toString('utf8'))
      } catch { /* 不可读的文件不进快照 */ }
    }
  }
}

/** 影片目录此刻的文本文件内容表(一轮开工时取, 结算时比对). */
export function takeSnapshot(dir: string): Map<string, string> {
  const taken = new Map<string, string>()
  try { walkContents(dir, dir, taken) } catch { /* 不可读: 空快照 */ }
  return taken
}

export interface FilmFileChange { path: string; change: 'added' | 'removed' | 'changed'; added?: number; removed?: number; hunks?: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>; cut?: boolean }

/** 此刻与快照的差异: 新增/删除/修改(带 hunks, 每处上下文 3 行, 超出截断). */
export function diffSnapshot(snapshot: Snapshot): FilmFileChange[] {
  const now = new Map<string, string>()
  try { walkContents(snapshot.dir, snapshot.dir, now) } catch { /* 同上 */ }
  const changes: FilmFileChange[] = []
  for (const [path] of snapshot.taken) {
    if (now.has(path)) continue
    changes.push({ path, change: 'removed' })
  }
  for (const [path, after] of now) {
    const before = snapshot.taken.get(path)
    if (before === undefined) {
      changes.push({ path, change: 'added', added: after.split('\n').length })
      continue
    }
    if (before === after) continue
    const patch = structuredPatch(path, path, before, after, '', '', { context: 3 })
    const hunks = patch.hunks.map((h) => ({
      oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines,
      lines: h.lines.slice(0, 400),
    }))
    changes.push({ path, change: 'changed', hunks, ...(hunks.some((h) => h.lines.length >= 400) ? { cut: true } : {}) })
  }
  return changes
}

/** 一轮的快照登记(运行中的每轮一份, 超出上限淘汰最旧的). */
export function keepSnapshot(turnId: string, dir: string): Snapshot {
  const taken = takeSnapshot(dir)
  const snapshot: Snapshot = { dir, taken }
  snapshots.delete(turnId)
  snapshots.set(turnId, snapshot)
  while (snapshots.size > SNAPSHOTS_MAX) snapshots.delete(snapshots.keys().next().value as string)
  return snapshot
}

/** 结算: 与该轮快照比对; 快照的目录与影片不符(项目被换)时不给结论. */
export function settleSnapshot(turnId: string, dir: string): FilmFileChange[] | null {
  const kept = snapshots.get(turnId)
  snapshots.delete(turnId)
  return kept && kept.dir === dir ? diffSnapshot(kept) : null
}

/** 越界守卫: 影片目录内的相对路径(附件/引用图落盘用). */
export function insideProject(project: string, relativePath: string): string {
  const target = join(project, relativePath)
  if (!target.startsWith(project)) throw new Error('路径越出影片目录')
  return target
}
