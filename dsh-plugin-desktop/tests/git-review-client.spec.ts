import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  GIT_REVIEW_COMMIT_FILES_PATH, GIT_REVIEW_DIFF_PATH, GIT_REVIEW_LAST_TURN_PATH,
  GIT_REVIEW_STATUS_PATH, GIT_REVIEW_WORKSPACE_PATH,
} from '../src/git-review-contract.ts'
import { createGitReviewClient } from '../src/client/git-review-api.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('Desktop Git review client', () => {
  it('queries the owner Session and selected root for every review view', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ available: true, files: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitReviewClient()
    const signal = new AbortController().signal
    const sessionId = 'session / one' as SessionId
    const sourceRoot = '/workspace/root with spaces'

    await client.workspace(sessionId, signal)
    await client.status(sessionId, sourceRoot, signal)
    await client.commitFiles(sessionId, sourceRoot, 'a'.repeat(40), signal)
    await client.lastTurn(sessionId, sourceRoot, signal)
    await client.diff({ sessionId, sourceRoot, category: 'unstaged', path: 'src/file with space.ts', signal })

    expect(fetchMock).toHaveBeenNthCalledWith(1, `${GIT_REVIEW_WORKSPACE_PATH}?sessionId=session+%2F+one`, {
      method: 'GET', signal, headers: { accept: 'application/json' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      `${GIT_REVIEW_STATUS_PATH}?sessionId=session+%2F+one&sourceRoot=%2Fworkspace%2Froot+with+spaces`, {
        method: 'GET', signal, headers: { accept: 'application/json' },
      })
    expect(fetchMock).toHaveBeenNthCalledWith(3,
      `${GIT_REVIEW_COMMIT_FILES_PATH}?sessionId=session+%2F+one&sourceRoot=%2Fworkspace%2Froot+with+spaces&commitId=${'a'.repeat(40)}`, {
        method: 'GET', signal, headers: { accept: 'application/json' },
      })
    expect(fetchMock).toHaveBeenNthCalledWith(4,
      `${GIT_REVIEW_LAST_TURN_PATH}?sessionId=session+%2F+one&sourceRoot=%2Fworkspace%2Froot+with+spaces`, {
        method: 'GET', signal, headers: { accept: 'application/json' },
      })
    expect(fetchMock).toHaveBeenNthCalledWith(5,
      `${GIT_REVIEW_DIFF_PATH}?sessionId=session+%2F+one&sourceRoot=%2Fworkspace%2Froot+with+spaces&category=unstaged&path=src%2Ffile+with+space.ts`, {
        method: 'GET', signal, headers: { accept: 'application/json' },
      })
  })

  it('surfaces safe Host errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Git was not found on PATH.', code: 'git-not-found' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    })))
    await expect(createGitReviewClient().status('session-1' as SessionId, '/workspace', new AbortController().signal))
      .rejects.toThrow('Git was not found on PATH.')
  })
})
