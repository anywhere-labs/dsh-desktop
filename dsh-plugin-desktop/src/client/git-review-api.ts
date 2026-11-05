import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  GIT_REVIEW_COMMIT_FILES_PATH,
  GIT_REVIEW_DIFF_PATH,
  GIT_REVIEW_LAST_TURN_PATH,
  GIT_REVIEW_STATUS_PATH,
  GIT_REVIEW_WORKSPACE_PATH,
  GIT_REVIEW_WORKTREES_PATH,
  type GitReviewCommitFiles,
  type GitReviewWorktrees,
  type GitReviewDiff,
  type GitReviewDiffCategory,
  type GitReviewStatus,
  type GitReviewWorkspace,
} from '../git-review-contract.ts'

export interface GitReviewLastTurnView {
  readonly available: boolean
  readonly sessionId?: SessionId
  /** Working directory against which the selected turn's file paths are relative. */
  readonly cwd?: string
  readonly seq?: number
  readonly turn?: number
  readonly time?: number
  readonly filesTotal?: number
  readonly omittedFiles?: number
  readonly files: readonly import('../git-review-contract.ts').GitReviewLastTurnFile[]
}

export interface GitReviewClient {
  workspace(sessionId: SessionId, signal: AbortSignal): Promise<GitReviewWorkspace>
  worktrees(sessionId: SessionId, sourceRoot: string, signal: AbortSignal): Promise<GitReviewWorktrees>
  status(sessionId: SessionId, sourceRoot: string, signal: AbortSignal): Promise<GitReviewStatus>
  commitFiles(sessionId: SessionId, sourceRoot: string, commitId: string, signal: AbortSignal): Promise<GitReviewCommitFiles>
  lastTurn(sessionId: SessionId, sourceRoot: string, signal: AbortSignal): Promise<GitReviewLastTurnView>
  diff(input: {
    sessionId: SessionId
    sourceRoot: string
    category: GitReviewDiffCategory
    path?: string
    index?: number
    commitId?: string
    signal: AbortSignal
  }): Promise<GitReviewDiff>
}

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: 'GET', signal, headers: { accept: 'application/json' } })
  const body = await response.json() as T | { error?: string }
  if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
  return body as T
}

function scopeQuery(sessionId: SessionId, sourceRoot: string): URLSearchParams {
  return new URLSearchParams({ sessionId, sourceRoot })
}

export function createGitReviewClient(): GitReviewClient {
  return {
    workspace: (sessionId, signal) => request<GitReviewWorkspace>(
      `${GIT_REVIEW_WORKSPACE_PATH}?${new URLSearchParams({ sessionId })}`, signal),
    worktrees: (sessionId, sourceRoot, signal) => request<GitReviewWorktrees>(
      `${GIT_REVIEW_WORKTREES_PATH}?${scopeQuery(sessionId, sourceRoot)}`, signal),
    status: (sessionId, sourceRoot, signal) => request<GitReviewStatus>(
      `${GIT_REVIEW_STATUS_PATH}?${scopeQuery(sessionId, sourceRoot)}`, signal),
    commitFiles: (sessionId, sourceRoot, commitId, signal) => request<GitReviewCommitFiles>(
      `${GIT_REVIEW_COMMIT_FILES_PATH}?${scopeQuery(sessionId, sourceRoot)}&commitId=${encodeURIComponent(commitId)}`, signal),
    lastTurn: (sessionId, sourceRoot, signal) => request<GitReviewLastTurnView>(
      `${GIT_REVIEW_LAST_TURN_PATH}?${scopeQuery(sessionId, sourceRoot)}`, signal),
    diff: ({ sessionId, sourceRoot, category, path, index, commitId, signal }) => {
      const query = scopeQuery(sessionId, sourceRoot)
      query.set('category', category)
      if (path !== undefined) query.set('path', path)
      if (index !== undefined) query.set('index', String(index))
      if (commitId !== undefined) query.set('commitId', commitId)
      return request<GitReviewDiff>(`${GIT_REVIEW_DIFF_PATH}?${query}`, signal)
    },
  }
}
