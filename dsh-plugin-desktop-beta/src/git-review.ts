/** Authenticated, read-only Git review endpoints scoped to registered Workspaces. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SubprocessExecutableNotFoundError, type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import type {} from './workspace-source-roots.ts'
import {
  GIT_REVIEW_COMMIT_FILES_PATH,
  GIT_REVIEW_DIFF_PATH,
  GIT_REVIEW_LAST_TURN_PATH,
  GIT_REVIEW_MAX_DIFF_BYTES,
  GIT_REVIEW_MAX_FILES,
  GIT_REVIEW_MAX_COMMITS,
  GIT_REVIEW_STATUS_PATH,
  GIT_REVIEW_WORKSPACE_PATH,
  GIT_REVIEW_WORKTREES_PATH,
  isGitReviewPath,
  isGitReviewCommitId,
  parseGitReviewBranches,
  parseGitReviewCommits,
  parseGitReviewNumstat,
  parseGitReviewStatus,
  parseGitReviewWorktrees,
  type GitReviewDiffCategory,
  type GitReviewDiffFile,
  type GitReviewFile,
  type GitReviewStatus,
  type GitReviewTurnDiff,
  type GitReviewWorkspace,
} from './git-review-contract.ts'

export const name = 'desktop-git-review'
export const inject = ['webServer', 'connection', 'subprocess', 'workspaceRegistry', 'sessions', 'workspaceChanges', 'desktopWorkspaceSourceRoots']

const GIT_TIMEOUT_MS = 12_000
const GIT_GRACE_MS = 1_000
const STDERR_MAX_BYTES = 16_000
const STATUS_MAX_BYTES = 1_000_000
const GIT_ENV_TOMBSTONES = Object.freeze([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_GRAFT_FILE',
  'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_SYSTEM',
])

class GitReviewError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'GitReviewError'
  }
}

interface RequestLifetime {
  readonly signal: AbortSignal
  dispose(): void
}

interface GitOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
}

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function rejectRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

function requestLifetime(req: IncomingMessage, res: ServerResponse, lifetimes: Set<AbortController>): RequestLifetime {
  const controller = new AbortController()
  const abort = (): void => { if (!res.writableEnded) controller.abort() }
  lifetimes.add(controller)
  req.once('aborted', abort)
  res.once('close', abort)
  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort)
      res.off('close', abort)
      lifetimes.delete(controller)
    },
  }
}

function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  res.setHeader('allow', 'GET')
  json(res, 405, { error: 'method not allowed', code: 'method-not-allowed' })
  return false
}

function parseUrl(req: IncomingMessage): URL { return new URL(req.url ?? '/', 'http://127.0.0.1') }

function workspaceForSession(ctx: Context, value: string | null) {
  if (value === null || value.length === 0 || value.length > 128) throw new GitReviewError('Choose a valid Session.', 400, 'invalid-session')
  const sessionId = value as SessionId
  const workspace = ctx.workspaceRegistry.list().find(candidate => candidate.sessionIds.includes(sessionId))
  if (workspace === undefined) throw new GitReviewError('The current Session has no registered Workspace.', 404, 'workspace-not-found')
  return workspace
}

function authorizedRoot(ctx: Context, workspace: ReturnType<typeof workspaceForSession>, value: string | null): string {
  if (value !== null && (value.length === 0 || value.length > 4_096 || !isAbsolute(value))) {
    throw new GitReviewError('Choose a valid review directory.', 400, 'invalid-source-root')
  }
  try {
    return ctx.desktopWorkspaceSourceRoots.resolveAuthorizedRoot(workspace.path, value ?? workspace.path)
  } catch {
    throw new GitReviewError('The review directory is not authorized for the current Workspace.', 403, 'source-root-not-authorized')
  }
}

async function requestScope(ctx: Context, query: URLSearchParams, signal: AbortSignal, handles: Set<SubprocessHandle>) {
  const workspace = workspaceForSession(ctx, query.get('sessionId'))
  const requested = query.get('sourceRoot') ?? workspace.path
  try {
    return { workspace, sourceRoot: authorizedRoot(ctx, workspace, requested) }
  } catch (cause) {
    if (!(cause instanceof GitReviewError) || cause.code !== 'source-root-not-authorized') throw cause
    const canonical = (() => { try { return realpathSync.native(requested) } catch { return undefined } })()
    if (canonical === undefined) throw cause
    const candidates = [workspace.path, ...ctx.desktopWorkspaceSourceRoots.list(workspace.path)]
    for (const candidate of candidates) {
      try {
        const worktrees = await listGitWorktrees(ctx, candidate, signal, handles)
        if (worktrees.some(worktree => worktree.path === canonical)) return { workspace, sourceRoot: canonical }
      } catch {
        // A non-repository source root has no worktrees; continue checking other roots.
      }
    }
    throw cause
  }
}

function rootPrefix(worktreePath: string, sourceRoot: string): string {
  const path = relative(worktreePath, sourceRoot)
  if (path === '') return ''
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new GitReviewError('The review directory is outside its Git repository.', 409, 'source-root-outside-repository')
  }
  return path.split(sep).join('/')
}

function inRoot(path: string, prefix: string): boolean {
  return prefix.length === 0 || path.startsWith(`${prefix}/`)
}

function displayPath(path: string, prefix: string): string { return prefix.length === 0 ? path : path.slice(prefix.length + 1) }

function scopeFiles(files: readonly GitReviewFile[], prefix: string): GitReviewFile[] {
  return files.flatMap(file => {
    if (!inRoot(file.path, prefix)) return []
    const previousPath = file.previousPath !== undefined && inRoot(file.previousPath, prefix) ? file.previousPath : undefined
    return [{ ...file, ...(prefix.length === 0 ? {} : { display: displayPath(file.path, prefix) }), ...(previousPath === undefined ? {} : { previousPath }) }]
  })
}

async function runGit(
  ctx: Context,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
  maxBytes = STATUS_MAX_BYTES,
  allowExitOne = false,
): Promise<GitOutput> {
  const timeout = AbortSignal.timeout(GIT_TIMEOUT_MS)
  const commandSignal = AbortSignal.any([signal, timeout])
  let handle: SubprocessHandle | undefined
  try {
    const executable = await ctx.subprocess.resolveExecutable('git', undefined, commandSignal)
    const spec: SubprocessSpawnSpec = {
      argv: [executable, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes },
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: GIT_GRACE_MS,
      signal: commandSignal,
      env: {
        ...Object.fromEntries(GIT_ENV_TOMBSTONES.map(key => [key, undefined])),
        GIT_CONFIG_COUNT: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat', PAGER: 'cat', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C',
      },
    }
    handle = ctx.subprocess.spawn(spec)
    handles.add(handle)
    const outcome = await handle.done
    await handle.waitForExit()
    if (timeout.aborted) throw new GitReviewError('Git review timed out. Try again.', 504, 'git-timeout')
    if (signal.aborted) throw new GitReviewError('The Git review request was cancelled.', 499, 'request-cancelled')
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (stdout.lossy) throw new GitReviewError('Git output exceeded the review limit.', 413, 'output-too-large')
    if (outcome.exitCode !== 0 && !(allowExitOne && outcome.exitCode === 1)) {
      throw new GitReviewError('Git could not read this workspace. Check that it is a valid repository.', 409, 'git-failed')
    }
    return { stdout: stdout.text, stderr, exitCode: outcome.exitCode }
  } finally {
    if (handle !== undefined) handles.delete(handle)
  }
}

async function listGitWorktrees(
  ctx: Context,
  rootPath: string,
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
): Promise<ReturnType<typeof parseGitReviewWorktrees>> {
  const result = await runGit(ctx, rootPath, ['worktree', 'list', '--porcelain'], signal, handles, STATUS_MAX_BYTES)
  return parseGitReviewWorktrees(result.stdout).map(worktree => ({
    ...worktree,
    path: (() => { try { return realpathSync.native(worktree.path) } catch { return worktree.path } })(),
  }))
}

function withNumstat(files: readonly GitReviewFile[], output: string): GitReviewFile[] {
  const counts = parseGitReviewNumstat(output)
  return files.map(file => {
    const current = counts.get(file.path) ?? { additions: 0, deletions: 0 }
    const previous = file.previousPath === undefined ? undefined : counts.get(file.previousPath)
    return {
      ...file,
      additions: current.additions + (previous?.additions ?? 0),
      deletions: current.deletions + (previous?.deletions ?? 0),
    }
  })
}

async function untrackedNumstat(
  ctx: Context,
  worktreePath: string,
  files: readonly GitReviewFile[],
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
): Promise<GitReviewFile[]> {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const output: GitReviewFile[] = []
  for (let offset = 0; offset < files.length; offset += 8) {
    const batch = files.slice(offset, offset + 8)
    const counted = await Promise.all(batch.map(async file => {
      try {
        const result = await runGit(ctx, worktreePath,
          ['diff', '--no-index', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--', nullDevice, file.path],
          signal, handles, 64_000, true)
        return { ...file, ...(parseGitReviewNumstat(result.stdout).get(file.path) ?? { additions: 0, deletions: 0 }) }
      } catch (cause) {
        if (signal.aborted) throw cause
        return file
      }
    }))
    output.push(...counted)
  }
  return output
}

async function worktreePathFor(ctx: Context, rootPath: string, signal: AbortSignal, handles: Set<SubprocessHandle>): Promise<string> {
  const root = await runGit(ctx, rootPath, ['rev-parse', '--show-toplevel'], signal, handles)
  const worktreePath = root.stdout.trim()
  if (worktreePath.length === 0) throw new GitReviewError('The selected directory is not inside a Git repository.', 409, 'not-a-repository')
  return worktreePath
}

async function readStatus(ctx: Context, workspace: ReturnType<typeof workspaceForSession>, sourceRoot: string, signal: AbortSignal, handles: Set<SubprocessHandle>): Promise<GitReviewStatus> {
  let worktreePath: string
  try {
    worktreePath = await worktreePathFor(ctx, sourceRoot, signal, handles)
  } catch (cause) {
    if (!(cause instanceof GitReviewError) || (cause.code !== 'git-failed' && cause.code !== 'not-a-repository')) throw cause
    return {
      workspaceId: workspace.id, workspaceTitle: workspace.title, repository: false, ahead: 0, behind: 0,
      unstaged: [], untracked: [], staged: [], omittedFiles: { unstaged: 0, untracked: 0, staged: 0 }, branches: [], commits: [],
    }
  }
  const prefix = rootPrefix(worktreePath, sourceRoot)
  const pathspec = prefix || '.'
  const [porcelain, unstagedCounts, stagedCounts, branches, commits] = await Promise.all([
    runGit(ctx, worktreePath, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--no-renames', '--', pathspec], signal, handles),
    runGit(ctx, worktreePath, ['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--', pathspec], signal, handles),
    runGit(ctx, worktreePath, ['diff', '--cached', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--', pathspec], signal, handles),
    runGit(ctx, worktreePath, ['branch', '--no-color', '--all', '--format=%(HEAD) %(refname)%00'], signal, handles),
    runGit(ctx, worktreePath, ['log', `-${GIT_REVIEW_MAX_COMMITS}`, '--no-color', '--format=%H%x00%s%x00%an%x00%at%x00', '--', pathspec], signal, handles),
  ])
  const parsed = parseGitReviewStatus(workspace.id, workspace.title, porcelain.stdout)
  const scopedUnstaged = scopeFiles(parsed.unstaged, prefix)
  const scopedStaged = scopeFiles(parsed.staged, prefix)
  const scopedUntracked = scopeFiles(parsed.untracked, prefix)
  const [unstagedAll, stagedAll, untracked] = await Promise.all([
    Promise.resolve(withNumstat(scopedUnstaged, unstagedCounts.stdout)),
    Promise.resolve(withNumstat(scopedStaged, stagedCounts.stdout)),
    untrackedNumstat(ctx, worktreePath, scopedUntracked.slice(0, GIT_REVIEW_MAX_FILES), signal, handles),
  ])
  const unstaged = unstagedAll.slice(0, GIT_REVIEW_MAX_FILES)
  const staged = stagedAll.slice(0, GIT_REVIEW_MAX_FILES)
  const omittedFiles = {
    unstaged: Math.max(0, scopedUnstaged.length - unstaged.length),
    staged: Math.max(0, scopedStaged.length - staged.length),
    untracked: Math.max(0, scopedUntracked.length - untracked.length),
  }
  return {
    ...parsed, unstaged, staged, untracked, omittedFiles, repository: true, worktreePath,
    branches: parseGitReviewBranches(branches.stdout),
    commits: parseGitReviewCommits(commits.stdout),
  }
}

async function readCommitFiles(ctx: Context, worktreePath: string, commitId: string, prefix: string, signal: AbortSignal, handles: Set<SubprocessHandle>) {
  const pathspec = prefix || '.'
  const result = await runGit(ctx, worktreePath,
    ['show', '--format=', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', commitId, '--', pathspec],
    signal, handles, STATUS_MAX_BYTES)
  const repositoryFiles = [...parseGitReviewNumstat(result.stdout)].flatMap(([path, counts]) => isGitReviewPath(path) ? [{
    path,
    status: counts.additions === 0 && counts.deletions > 0 ? 'D' : counts.deletions === 0 && counts.additions > 0 ? 'A' : 'M',
    ...counts,
  }] : [])
  const allFiles = scopeFiles(repositoryFiles, prefix)
  return {
    commitId,
    filesTotal: allFiles.length,
    omittedFiles: Math.max(0, allFiles.length - GIT_REVIEW_MAX_FILES),
    files: allFiles.slice(0, GIT_REVIEW_MAX_FILES),
  }
}

function splitGitDiffFiles(output: string, sourceFiles: readonly Pick<GitReviewFile, 'path'>[]): { files: GitReviewDiffFile[]; omittedFiles: number } {
  const starts = [...output.matchAll(/^diff --git /gmu)].flatMap(match => match.index === undefined ? [] : [match.index])
  const files = sourceFiles.flatMap((file, index) => {
    const start = starts[index]
    if (start === undefined) return []
    const end = starts[index + 1] ?? output.length
    return [{ path: file.path, diff: output.slice(start, end) }]
  })
  return { files, omittedFiles: Math.max(0, sourceFiles.length - files.length) + Math.max(0, starts.length - sourceFiles.length) }
}

function jsonByteLength(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }

function latestTurn(ctx: Context, sessionIds: readonly SessionId[]) {
  let latest: { sessionId: SessionId; seq: number; turn: number; time: number; summary: NonNullable<ReturnType<typeof ctx.workspaceChanges.summary>> } | undefined
  for (const id of sessionIds) {
    const session = ctx.sessions.get(id)
    const sessionCwd = session?.header.cwd
    if (session === undefined || typeof sessionCwd !== 'string' || sessionCwd.length === 0) continue
    const events = session.snapshotEvents()
    for (let at = events.length - 1; at >= 0; at--) {
      const event = events[at]
      if (event?.type !== 'workspace/changes') continue
      const summary = ctx.workspaceChanges.summary(id, event.seq)
      if (summary === undefined || summary.cwd !== sessionCwd) continue
      if (latest === undefined || event.time > latest.time) {
        latest = { sessionId: id, seq: event.seq, turn: event.data.turn, time: event.time, summary }
      }
      break
    }
  }
  return latest
}

function selectedTurn(ctx: Context, workspace: ReturnType<typeof workspaceForSession>, sourceRoot: string) {
  const latest = latestTurn(ctx, workspace.sessionIds)
  if (latest === undefined) return undefined
  const files = latest.summary.files.flatMap((file, sourceIndex) => {
    if (!isGitReviewPath(file.path)) return []
    const absolutePath = resolve(latest.summary.cwd, file.path)
    const selectedPath = relative(sourceRoot, absolutePath)
    if (selectedPath.length === 0 || isAbsolute(selectedPath) || selectedPath === '..' || selectedPath.startsWith(`..${sep}`)) return []
    const path = selectedPath.split(sep).join('/')
    if (!isGitReviewPath(path)) return []
    return [{ path, display: path, sourceIndex, status: 'last-turn', additions: file.added, deletions: file.deleted }]
  })
  return { latest, files }
}

function parseLastTurn(ctx: Context, workspace: ReturnType<typeof workspaceForSession>, sourceRoot: string) {
  const turn = selectedTurn(ctx, workspace, sourceRoot)
  if (turn === undefined || turn.files.length === 0) return { available: false as const, files: [] }
  const filesTotal = turn.files.length
  return {
    available: true as const,
    sessionId: turn.latest.sessionId,
    cwd: turn.latest.summary.cwd,
    seq: turn.latest.seq,
    turn: turn.latest.turn,
    time: turn.latest.time,
    filesTotal,
    omittedFiles: Math.max(0, filesTotal - GIT_REVIEW_MAX_FILES),
    files: turn.files.slice(0, GIT_REVIEW_MAX_FILES),
  }
}

function safeError(res: ServerResponse, cause: unknown): void {
  if (res.destroyed || res.writableEnded) return
  if (cause instanceof SubprocessExecutableNotFoundError) {
    json(res, 503, { error: 'Git was not found on PATH.', code: 'git-not-found' })
  } else if (cause instanceof GitReviewError) {
    json(res, cause.status, { error: cause.message, code: cause.code })
  } else {
    json(res, 502, { error: 'The Git review request failed.', code: 'git-review-failed' })
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const lifetimes = new Set<AbortController>()
    const handles = new Set<SubprocessHandle>()
    const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): (() => void) => ctx.webServer.register({
      kind: 'exact', path,
      handler: (req, res) => {
        if (rejectRequest(ctx, req, res) || !requireGet(req, res)) return
        return handler(req, res)
      },
    })
    const withRequest = (handler: (req: IncomingMessage, res: ServerResponse, signal: AbortSignal) => Promise<void>) =>
      async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const lifetime = requestLifetime(req, res, lifetimes)
        try { await handler(req, res, lifetime.signal) }
        catch (cause) { safeError(res, cause) }
        finally { lifetime.dispose() }
      }
    const unregisterWorkspace = register(GIT_REVIEW_WORKSPACE_PATH, withRequest(async (req, res) => {
      const workspace = workspaceForSession(ctx, parseUrl(req).searchParams.get('sessionId'))
      const result: GitReviewWorkspace = { workspaceId: workspace.id, workspaceTitle: workspace.title, path: workspace.path }
      json(res, 200, result)
    }))
    const unregisterWorktrees = register(GIT_REVIEW_WORKTREES_PATH, withRequest(async (req, res, signal) => {
      const { sourceRoot } = await requestScope(ctx, parseUrl(req).searchParams, signal, handles)
      json(res, 200, { root: sourceRoot, worktrees: await listGitWorktrees(ctx, sourceRoot, signal, handles) })
    }))
    const unregisterStatus = register(GIT_REVIEW_STATUS_PATH, withRequest(async (req, res, signal) => {
      const { workspace, sourceRoot } = await requestScope(ctx, parseUrl(req).searchParams, signal, handles)
      json(res, 200, await readStatus(ctx, workspace, sourceRoot, signal, handles))
    }))
    const unregisterCommitFiles = register(GIT_REVIEW_COMMIT_FILES_PATH, withRequest(async (req, res, signal) => {
      const query = parseUrl(req).searchParams
      const { workspace, sourceRoot } = await requestScope(ctx, query, signal, handles)
      const commitId = query.get('commitId')
      if (commitId === null || !isGitReviewCommitId(commitId)) throw new GitReviewError('Choose a valid commit.', 400, 'invalid-commit')
      const status = await readStatus(ctx, workspace, sourceRoot, signal, handles)
      if (!status.repository || status.worktreePath === undefined || !status.commits.some(commit => commit.id === commitId)) {
        throw new GitReviewError('This commit is no longer available in the selected directory.', 404, 'commit-not-found')
      }
      const prefix = rootPrefix(status.worktreePath, sourceRoot)
      json(res, 200, await readCommitFiles(ctx, status.worktreePath, commitId, prefix, signal, handles))
    }))
    const unregisterDiff = register(GIT_REVIEW_DIFF_PATH, withRequest(async (req, res, signal) => {
      const query = parseUrl(req).searchParams
      const { workspace, sourceRoot } = await requestScope(ctx, query, signal, handles)
      const category = query.get('category')
      if (category !== 'last-turn' && category !== 'unstaged' && category !== 'untracked' && category !== 'staged' && category !== 'committed') {
        throw new GitReviewError('Choose a supported Git review category.', 400, 'invalid-category')
      }
      if (category === 'last-turn') {
        const indexText = query.get('index')
        const turn = selectedTurn(ctx, workspace, sourceRoot)
        if (turn === undefined || turn.files.length === 0) throw new GitReviewError('No last-turn changes are available in the selected directory.', 404, 'last-turn-unavailable')
        if (indexText !== null && !/^\d+$/u.test(indexText)) throw new GitReviewError('Choose a valid last-turn file.', 400, 'invalid-index')
        if (indexText !== null) {
          const index = Number(indexText)
          const file = turn.files.find(item => item.sourceIndex === index)
          if (!Number.isInteger(index) || index < 0 || index >= GIT_REVIEW_MAX_FILES || file === undefined) {
            throw new GitReviewError('Choose a valid last-turn file.', 400, 'invalid-index')
          }
          const sourceDiff = await ctx.workspaceChanges.diff(turn.latest.sessionId, turn.latest.seq, file.sourceIndex, signal) as GitReviewTurnDiff | undefined
          if (sourceDiff === undefined) throw new GitReviewError('The last-turn comparison is no longer available.', 404, 'last-turn-unavailable')
          const turnDiff: GitReviewTurnDiff = { ...sourceDiff, path: file.path, display: file.display }
          json(res, 200, { diff: '', turnDiff })
          return
        }
        const files: GitReviewDiffFile[] = []
        let usedBytes = 96
        let omittedFiles = Math.max(0, turn.files.length - GIT_REVIEW_MAX_FILES)
        for (const file of turn.files.slice(0, GIT_REVIEW_MAX_FILES)) {
          const sourceDiff = await ctx.workspaceChanges.diff(turn.latest.sessionId, turn.latest.seq, file.sourceIndex, signal) as GitReviewTurnDiff | undefined
          if (sourceDiff === undefined) { omittedFiles++; continue }
          const turnDiff: GitReviewTurnDiff = { ...sourceDiff, path: file.path, display: file.display }
          const item: GitReviewDiffFile = { path: file.path, turnDiff }
          const itemBytes = jsonByteLength(item) + 1
          if (usedBytes + itemBytes > GIT_REVIEW_MAX_DIFF_BYTES) { omittedFiles++; continue }
          files.push(item)
          usedBytes += itemBytes
        }
        json(res, 200, { diff: '', files, omittedFiles })
        return
      }
      if (category === 'committed') {
        const commitId = query.get('commitId')
        if (commitId === null || !isGitReviewCommitId(commitId)) throw new GitReviewError('Choose a valid commit.', 400, 'invalid-commit')
        const status = await readStatus(ctx, workspace, sourceRoot, signal, handles)
        if (!status.repository || status.worktreePath === undefined || !status.commits.some(commit => commit.id === commitId)) {
          throw new GitReviewError('This commit is no longer available in the selected directory.', 404, 'commit-not-found')
        }
        const prefix = rootPrefix(status.worktreePath, sourceRoot)
        const pathspec = prefix || '.'
        const commitFiles = await readCommitFiles(ctx, status.worktreePath, commitId, prefix, signal, handles)
        const path = query.get('path')
        if (path !== null) {
          if (!isGitReviewPath(path)) throw new GitReviewError('Choose a valid workspace-relative file.', 400, 'invalid-path')
          if (!commitFiles.files.some(file => file.path === path)) throw new GitReviewError('This file is not part of the selected commit.', 404, 'file-not-found')
          const fileResult = await runGit(ctx, status.worktreePath,
            ['show', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--format=', commitId, '--', path],
            signal, handles, GIT_REVIEW_MAX_DIFF_BYTES)
          json(res, 200, { diff: fileResult.stdout })
          return
        }
        const result = await runGit(ctx, status.worktreePath,
          ['show', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--format=', commitId, '--', pathspec],
          signal, handles, GIT_REVIEW_MAX_DIFF_BYTES)
        const split = splitGitDiffFiles(result.stdout, commitFiles.files)
        const boundedFiles: GitReviewDiffFile[] = []
        let usedBytes = 96
        let omittedFiles = commitFiles.omittedFiles + split.omittedFiles
        for (const item of split.files) {
          const itemBytes = jsonByteLength(item) + 1
          if (usedBytes + itemBytes > GIT_REVIEW_MAX_DIFF_BYTES) { omittedFiles++; continue }
          boundedFiles.push(item)
          usedBytes += itemBytes
        }
        json(res, 200, { diff: '', files: boundedFiles, omittedFiles })
        return
      }
      const path = query.get('path')
      if (path !== null && !isGitReviewPath(path)) throw new GitReviewError('Choose a valid workspace-relative file.', 400, 'invalid-path')
      const status = await readStatus(ctx, workspace, sourceRoot, signal, handles)
      if (!status.repository || status.worktreePath === undefined) throw new GitReviewError('The selected directory is not a Git repository.', 409, 'not-a-repository')
      const categoryFiles = category === 'unstaged' ? status.unstaged : category === 'staged' ? status.staged : status.untracked
      if (path !== null) {
        const file = categoryFiles.find(item => item.path === path)
        if (file === undefined) throw new GitReviewError('This file is no longer in the selected change category.', 404, 'file-not-found')
        const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
        const paths = category === 'untracked' ? [] : [file.previousPath, file.path].filter((item): item is string => item !== undefined && isGitReviewPath(item))
        const args = category === 'untracked'
          ? ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--', nullDevice, path]
          : ['diff', ...(category === 'staged' ? ['--cached'] : []), '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--', ...paths]
        const result = await runGit(ctx, status.worktreePath, args, signal, handles, GIT_REVIEW_MAX_DIFF_BYTES, category === 'untracked')
        json(res, 200, { diff: result.stdout })
        return
      }
      const files: GitReviewDiffFile[] = []
      let usedBytes = 96
      let omittedFiles = status.omittedFiles?.[category] ?? Math.max(0, categoryFiles.length - GIT_REVIEW_MAX_FILES)
      for (const file of categoryFiles.slice(0, GIT_REVIEW_MAX_FILES)) {
        if (!isGitReviewPath(file.path)) { omittedFiles++; continue }
        const pathArgs = category === 'untracked' ? [] : [file.previousPath, file.path].filter((item): item is string => item !== undefined && isGitReviewPath(item))
        const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
        const args = category === 'untracked'
          ? ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--', nullDevice, file.path]
          : ['diff', ...(category === 'staged' ? ['--cached'] : []), '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--', ...pathArgs]
        const budget = GIT_REVIEW_MAX_DIFF_BYTES - usedBytes - jsonByteLength({ path: file.path, diff: '' }) - 64
        if (budget <= 0) { omittedFiles++; continue }
        let fileDiff: string
        try {
          fileDiff = (await runGit(ctx, status.worktreePath, args, signal, handles, budget, category === 'untracked')).stdout
        } catch (cause) {
          if (cause instanceof GitReviewError && cause.code === 'output-too-large') { omittedFiles++; continue }
          throw cause
        }
        const item: GitReviewDiffFile = { path: file.path, diff: fileDiff }
        const itemBytes = jsonByteLength(item) + 1
        if (usedBytes + itemBytes > GIT_REVIEW_MAX_DIFF_BYTES) { omittedFiles++; continue }
        files.push(item)
        usedBytes += itemBytes
      }
      json(res, 200, { diff: '', files, omittedFiles })
    }))
    const unregisterLastTurn = register(GIT_REVIEW_LAST_TURN_PATH, withRequest(async (req, res, signal) => {
      const { workspace, sourceRoot } = await requestScope(ctx, parseUrl(req).searchParams, signal, handles)
      json(res, 200, parseLastTurn(ctx, workspace, sourceRoot))
    }))
    return async () => {
      unregisterWorkspace()
      unregisterWorktrees()
      unregisterStatus()
      unregisterCommitFiles()
      unregisterDiff()
      unregisterLastTurn()
      for (const lifetime of lifetimes) lifetime.abort()
      for (const handle of handles) handle.terminate()
      await Promise.allSettled([...handles].map(async handle => { await handle.done; await handle.waitForExit() }))
      lifetimes.clear()
      handles.clear()
    }
  }, 'desktop-git-review: authenticated read-only Git routes')
}

export type { GitReviewDiffCategory }
