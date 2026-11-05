import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import {
  GIT_REVIEW_COMMIT_FILES_PATH, GIT_REVIEW_DIFF_PATH, GIT_REVIEW_LAST_TURN_PATH, GIT_REVIEW_STATUS_PATH, GIT_REVIEW_WORKSPACE_PATH, GIT_REVIEW_WORKTREES_PATH,
  isGitReviewCommitId, isGitReviewPath, parseGitReviewBranches, parseGitReviewCommits, parseGitReviewWorktrees,
  parseGitReviewNumstat, parseGitReviewStatus,
} from '../src/git-review-contract.ts'
import { apply, inject, name } from '../src/git-review.ts'

function child(stdout: string, exitCode: number | null = 0): SubprocessHandle {
  return {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  }
}

function request(url: string, method = 'GET'): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    method, url, headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

function response(): ServerResponse & { body: string } {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    statusCode: 200, writableEnded: false, destroyed: false, body: '',
    setHeader() {},
    writeHead(status: number) { this.statusCode = status },
    end(body = '') { this.body += String(body); this.writableEnded = true; emitter.emit('close') },
  }) as unknown as ServerResponse & { body: string }
}

async function harness(options: { children?: SubprocessHandle[]; rejection?: 401 | 403; workspaces?: readonly { id: string; path: string; title: string; sessionIds: readonly string[] }[]; authorizedRoots?: readonly string[]; session?: unknown; summary?: unknown; sessionFor?: (id: string) => unknown; summaryFor?: (id: string, seq: number) => unknown; diffFor?: (id: string, seq: number, index: number) => unknown } = {}) {
  const routes = new Map<string, WebRoute>()
  const children = options.children ?? []
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const next = children.shift()
    if (next === undefined) throw new Error(`unexpected Git spawn: ${spec.argv.join(' ')}`)
    return next
  })
  const requestRejection = vi.fn(() => options.rejection)
  const workspaceList = vi.fn(() => options.workspaces ?? [])
  const resolveAuthorizedRoot = vi.fn((workspacePath: string, sourcePath: string) => {
    if (workspacePath === sourcePath || options.authorizedRoots?.includes(sourcePath) === true) return sourcePath
    throw new Error('source root is not attached')
  })
  let cleanup: void | (() => void | Promise<void>)
  const ctx = {
    webServer: { register(route: WebRoute) { routes.set(route.path, route); return () => { routes.delete(route.path) } } },
    connection: { requestRejection },
    subprocess: { resolveExecutable: vi.fn(async () => '/fixture/bin/git'), spawn },
    workspaceRegistry: { list: workspaceList },
    desktopWorkspaceSourceRoots: { resolveAuthorizedRoot },
    sessions: { get: vi.fn((id: string) => options.sessionFor?.(id) ?? options.session) },
    workspaceChanges: { summary: vi.fn((id: string, seq: number) => options.summaryFor?.(id, seq) ?? options.summary), diff: vi.fn(async (id: string, seq: number, index: number) => options.diffFor?.(id, seq, index)) },
    effect: (register: () => void | (() => void | Promise<void>)) => { cleanup = register() },
  } as unknown as Context
  apply(ctx)
  return {
    routes, spawn, requestRejection, workspaceList, resolveAuthorizedRoot, subprocess: ctx.subprocess as SubprocessRuntime,
    teardown: async () => { if (typeof cleanup === 'function') await cleanup() },
  }
}

const workspace = { id: 'workspace-1', path: '/repo/root', title: 'project', sessionIds: ['session-1'] }
const primaryScope = `sessionId=session-1&sourceRoot=${encodeURIComponent(workspace.path)}`

describe('Desktop Git review contract', () => {
  it('separates untracked, unstaged, and staged porcelain records including renames', () => {
    const parsed = parseGitReviewStatus('workspace-1', 'project', [
      '## feature...origin/feature [ahead 2, behind 1]', ' M dirty.ts', 'A  staged.ts', '?? new.ts', 'R  renamed.ts', 'old.ts', '',
    ].join('\0'))
    expect(parsed).toMatchObject({ branch: 'feature', ahead: 2, behind: 1 })
    expect(parseGitReviewStatus('workspace-1', 'project', '## No commits yet on topic').branch).toBe('topic')
    expect(parsed.unstaged.map(file => file.path)).toEqual(['dirty.ts'])
    expect(parsed.staged.map(file => file.path)).toEqual(['staged.ts', 'renamed.ts'])
    expect(parsed.staged[1]).toMatchObject({ path: 'renamed.ts', previousPath: 'old.ts' })
    expect(parsed.untracked.map(file => file.path)).toEqual(['new.ts'])
  })

  it('parses branches, commits, and numstat rows', () => {
    expect(parseGitReviewBranches('* refs/heads/main\0  refs/remotes/origin/main\0')).toEqual([
      { name: 'main', current: true, remote: false }, { name: 'origin/main', current: false, remote: true },
    ])
    expect(parseGitReviewCommits(`${'a'.repeat(40)}\0subject\0Author\0${1_600_000_000}\0`)).toEqual([
      { id: 'a'.repeat(40), subject: 'subject', author: 'Author', time: 1_600_000_000 },
    ])
    expect(parseGitReviewNumstat('3\t1\tfile.ts\0-\t-\tbinary.png\0').get('file.ts')).toEqual({ additions: 3, deletions: 1 })
    expect(parseGitReviewNumstat('3\t1\tfile.ts\0-\t-\tbinary.png\0').get('binary.png')).toEqual({ additions: 0, deletions: 0 })
    expect(parseGitReviewWorktrees('worktree /repo/root\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/root/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n\nworktree /repo/root/.worktrees/detached\nHEAD ghi\ndetached\nlocked\n')).toEqual([
      { path: '/repo/root', branch: 'main', detached: false, locked: false },
      { path: '/repo/root/.worktrees/feature', branch: 'feature', detached: false, locked: false },
      { path: '/repo/root/.worktrees/detached', detached: true, locked: true },
    ])
  })

  it('rejects path traversal, absolute paths, and Git revision expressions', () => {
    expect(isGitReviewPath('src/file.ts')).toBe(true)
    expect(isGitReviewPath('../outside')).toBe(false)
    expect(isGitReviewPath('/etc/passwd')).toBe(false)
    expect(isGitReviewPath('C:/outside')).toBe(false)
    expect(isGitReviewPath('file\\name')).toBe(false)
    expect(isGitReviewCommitId('a'.repeat(40))).toBe(true)
    expect(isGitReviewCommitId('HEAD~1')).toBe(false)
  })
})

describe('Desktop Git review Host plugin', () => {
  it('registers only authenticated read-only review routes', async () => {
    const h = await harness()
    expect(name).toBe('desktop-git-review')
    expect(inject).toEqual(['webServer', 'connection', 'subprocess', 'workspaceRegistry', 'sessions', 'workspaceChanges', 'desktopWorkspaceSourceRoots'])
    expect([...h.routes.keys()]).toEqual([GIT_REVIEW_WORKSPACE_PATH, GIT_REVIEW_WORKTREES_PATH, GIT_REVIEW_STATUS_PATH, GIT_REVIEW_COMMIT_FILES_PATH, GIT_REVIEW_DIFF_PATH, GIT_REVIEW_LAST_TURN_PATH])
    await h.teardown()
  })

  it('rejects unauthenticated requests before resolving a Workspace or spawning Git', async () => {
    const h = await harness({ rejection: 401 })
    const req = request(`${GIT_REVIEW_STATUS_PATH}?${primaryScope}`)
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(req, res)
    expect(h.requestRejection).toHaveBeenCalledWith(req)
    expect(h.workspaceList).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    await h.teardown()
  })

  it('returns only the Workspace registered for the page owner Session', async () => {
    const nested = { id: 'workspace-2', path: '/repo/root/sub', title: 'nested', sessionIds: ['session-2'] }
    const h = await harness({ workspaces: [workspace, nested] })
    const res = response()
    await h.routes.get(GIT_REVIEW_WORKSPACE_PATH)!.handler(request(`${GIT_REVIEW_WORKSPACE_PATH}?sessionId=session-1`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ workspaceId: 'workspace-1', workspaceTitle: 'project', path: '/repo/root' })
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('lists the primary repository Worktree tree for the review directory menu', async () => {
    const h = await harness({ workspaces: [workspace], children: [child('worktree /repo/root\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/root/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n')] })
    const res = response()
    await h.routes.get(GIT_REVIEW_WORKTREES_PATH)!.handler(request(`${GIT_REVIEW_WORKTREES_PATH}?${primaryScope}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ root: '/repo/root', worktrees: [
      { path: '/repo/root', branch: 'main', detached: false, locked: false },
      { path: '/repo/root/.worktrees/feature', branch: 'feature', detached: false, locked: false },
    ] })
    expect(h.spawn.mock.calls[0]?.[0].cwd).toBe('/repo/root')
    await h.teardown()
  })

  it('rejects Sessions outside every registered Workspace before spawning Git', async () => {
    const h = await harness()
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?sessionId=other&sourceRoot=%2Frepo%2Froot`), res)
    expect(res.statusCode).toBe(404)
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('rejects a renderer-selected root that the Host has not authorized', async () => {
    const h = await harness({ workspaces: [workspace] })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?sessionId=session-1&sourceRoot=%2Ftmp%2Fother`), res)
    expect(res.statusCode).toBe(403)
    expect(h.resolveAuthorizedRoot).toHaveBeenCalledWith(workspace.path, '/tmp/other')
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('derives the Git cwd from the registered Workspace, not query input', async () => {
    const h = await harness({ workspaces: [workspace], children: [
      child('/repo/root\n'), child('## main\0'), child(''), child(''), child('* refs/heads/main\0'), child(''),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?${primaryScope}&cwd=/tmp/other`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ workspaceId: 'workspace-1', workspaceTitle: 'project', branch: 'main', repository: true, worktreePath: '/repo/root' })
    expect(h.spawn).toHaveBeenCalledTimes(6)
    for (const [spec] of h.spawn.mock.calls) {
      expect(spec.cwd).toBe('/repo/root')
      expect(spec.argv[0]).toBe('/fixture/bin/git')
      expect(spec.argv).toContain('core.fsmonitor=false')
      expect(spec.argv).not.toContain('/tmp/other')
      expect(spec.env).toMatchObject({
        GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      })
      expect(spec.env).toMatchObject({ GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined })
    }
    await h.teardown()
  })

  it('limits every file category to an Host-authorized attached directory', async () => {
    const attachedRoot = '/repo/root/src'
    const h = await harness({ workspaces: [workspace], authorizedRoots: [attachedRoot], children: [
      child('/repo/root\n'),
      child('## main\0 M src/a.ts\0 M other/b.ts\0'),
      child('1\t0\tsrc/a.ts\0' + '0\t1\tother/b.ts\0'), child(''),
      child('* refs/heads/main\0'), child(''),
    ] })
    const query = new URLSearchParams({ sessionId: 'session-1', sourceRoot: attachedRoot })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?${query}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ unstaged: [{ path: 'src/a.ts', display: 'a.ts' }] })
    expect(JSON.parse(res.body).unstaged).toHaveLength(1)
    for (const [spec] of h.spawn.mock.calls.slice(1)) {
      if (spec.argv.includes('--')) expect(spec.argv.slice(-2)).toEqual(['--', 'src'])
    }
    await h.teardown()
  })

  it('computes line counts for untracked files rather than reporting zero', async () => {
    const h = await harness({ workspaces: [workspace], children: [
      child('/repo/root\n'), child('## main\0?? new.txt\0'), child(''), child(''),
      child('* refs/heads/main\0'), child(''), child('2\t0\tnew.txt\0', 1),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?${primaryScope}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ untracked: [{ path: 'new.txt', additions: 2, deletions: 0 }] })
    await h.teardown()
  })

  it('finds the latest turn in event-heavy Sessions and reports omitted files', async () => {
    const events = Array.from({ length: 100_001 }, (_, seq) => ({ type: 'message', seq, time: seq, data: {} }))
    events.push({ type: 'workspace/changes', seq: 100_001, time: 200_000, data: { turn: 7 } })
    const files = Array.from({ length: 501 }, (_, index) => ({
      path: `src/${index}.ts`, display: `src/${index}.ts`, added: 1, deleted: 0,
    }))
    const h = await harness({
      workspaces: [{ ...workspace, sessionIds: ['session-1'] }],
      children: [child('/repo/root\n')],
      session: { header: { cwd: workspace.path }, snapshotEvents: () => events },
      summary: { cwd: workspace.path, files },
    })
    const res = response()
    await h.routes.get(GIT_REVIEW_LAST_TURN_PATH)!.handler(
      request(`${GIT_REVIEW_LAST_TURN_PATH}?${primaryScope}`), res,
    )
    const parsed = JSON.parse(res.body) as { available: boolean; turn: number; filesTotal: number; omittedFiles: number; files: unknown[] }
    expect(res.statusCode).toBe(200)
    expect(parsed).toMatchObject({ available: true, turn: 7, filesTotal: 501, omittedFiles: 1 })
    expect(parsed.files).toHaveLength(500)
    await h.teardown()
  })

  it('combines additions and deletions for a staged rename', async () => {
    const h = await harness({ workspaces: [workspace], children: [
      child('/repo/root\n'),
      child('## main\0R  renamed.ts\0old.ts\0'),
      child(''),
      child('2\t0\trenamed.ts\0' + '0\t3\told.ts\0'),
      child('* refs/heads/main\0'),
      child(''),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(`${GIT_REVIEW_STATUS_PATH}?${primaryScope}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).staged).toEqual([{
      path: 'renamed.ts', previousPath: 'old.ts', status: 'R ', additions: 2, deletions: 3,
    }])
    await h.teardown()
  })

  it('finds the latest turn among Sessions in the current Workspace and rebases nested paths', async () => {
    const nestedCwd = '/repo/root/sub'
    const events = [{ type: 'workspace/changes', seq: 5, time: 500, data: { turn: 3 } }]
    const h = await harness({
      workspaces: [{ ...workspace, sessionIds: ['session-1', 'session-2'] }],
      sessionFor: id => id === 'session-2'
        ? { header: { cwd: nestedCwd }, snapshotEvents: () => events }
        : { header: { cwd: workspace.path }, snapshotEvents: () => [] },
      summaryFor: id => id === 'session-2' ? { cwd: nestedCwd, files: [
        { path: 'src/nested.ts', display: 'src/nested.ts', added: 2, deleted: 1 },
      ] } : undefined,
    })
    const res = response()
    await h.routes.get(GIT_REVIEW_LAST_TURN_PATH)!.handler(request(`${GIT_REVIEW_LAST_TURN_PATH}?${primaryScope}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ available: true, sessionId: 'session-2', turn: 3, files: [{ path: 'sub/src/nested.ts', display: 'sub/src/nested.ts', sourceIndex: 0 }] })
    await h.teardown()
  })

  it('does not leak primary-root last-turn files into an attached-directory review', async () => {
    const attachedRoot = '/attached/project'
    const events = [{ type: 'workspace/changes', seq: 5, time: 500, data: { turn: 3 } }]
    const h = await harness({
      workspaces: [workspace], authorizedRoots: [attachedRoot],
      session: { header: { cwd: workspace.path }, snapshotEvents: () => events },
      summary: { cwd: workspace.path, files: [{ path: 'src/main.ts', display: 'src/main.ts', added: 1, deleted: 0 }] },
    })
    const query = new URLSearchParams({ sessionId: 'session-1', sourceRoot: attachedRoot })
    const res = response()
    await h.routes.get(GIT_REVIEW_LAST_TURN_PATH)!.handler(request(`${GIT_REVIEW_LAST_TURN_PATH}?${query}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ available: false, files: [] })
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('rejects non-GET methods before any Git access', async () => {
    const h = await harness({ workspaces: [workspace] })
    const res = response()
    await h.routes.get(GIT_REVIEW_STATUS_PATH)!.handler(request(GIT_REVIEW_STATUS_PATH, 'POST'), res)
    expect(res.statusCode).toBe(405)
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('rejects a traversal diff path before spawning Git', async () => {
    const h = await harness({ workspaces: [workspace] })
    const res = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=unstaged&path=..%2Fsecret`), res)
    expect(res.statusCode).toBe(400)
    expect(h.spawn).not.toHaveBeenCalled()
    await h.teardown()
  })

  it('lists and serves only the selected commit files for per-file review', async () => {
    const commitId = 'a'.repeat(40)
    const statusCommands = () => [
      child('/repo/root\n'), child('## main\0'), child(''), child(''), child('* refs/heads/main\0'),
      child(`${commitId}\0subject\0author\0${1_600_000_000}\0`),
    ]
    const numstat = '2\t0\tnew.ts\0' + '0\t3\told.ts\0'
    const h = await harness({ workspaces: [workspace], children: [
      ...statusCommands(), child(numstat),
      ...statusCommands(), child(numstat), child('diff --git a/new.ts b/new.ts\n+added\n'),
    ] })
    const filesResponse = response()
    await h.routes.get(GIT_REVIEW_COMMIT_FILES_PATH)!.handler(
      request(`${GIT_REVIEW_COMMIT_FILES_PATH}?${primaryScope}&commitId=${commitId}`), filesResponse)
    expect(filesResponse.statusCode).toBe(200)
    expect(JSON.parse(filesResponse.body)).toMatchObject({ commitId, filesTotal: 2, omittedFiles: 0, files: [
      { path: 'new.ts', status: 'A', additions: 2, deletions: 0 },
      { path: 'old.ts', status: 'D', additions: 0, deletions: 3 },
    ] })
    const diffResponse = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(
      request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=committed&commitId=${commitId}&path=new.ts`), diffResponse)
    expect(diffResponse.statusCode).toBe(200)
    expect(JSON.parse(diffResponse.body)).toEqual({ diff: 'diff --git a/new.ts b/new.ts\n+added\n' })
    expect(h.spawn.mock.calls.at(-1)?.[0].argv.slice(-2)).toEqual(['--', 'new.ts'])
    await h.teardown()
  })

  it('returns bounded per-file diffs for the complete uncommitted category', async () => {
    const h = await harness({ workspaces: [workspace], children: [
      child('/repo/root\n'), child('## main\0 M a.ts\0 M b.ts\0'), child('1\t0\ta.ts\0' + '0\t1\tb.ts\0'),
      child(''), child('* refs/heads/main\0'), child(''),
      child('diff --git a/a.ts b/a.ts\n+first\n'), child('diff --git a/b.ts b/b.ts\n-second\n'),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=unstaged`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ diff: '', files: [
      { path: 'a.ts', diff: 'diff --git a/a.ts b/a.ts\n+first\n' },
      { path: 'b.ts', diff: 'diff --git a/b.ts b/b.ts\n-second\n' },
    ], omittedFiles: 0 })
    await h.teardown()
  })

  it('returns split per-file diffs for a full commit review', async () => {
    const commitId = 'b'.repeat(40)
    const statusChildren = [
      child('/repo/root\n'), child('## main\0'), child(''), child(''), child('* refs/heads/main\0'),
      child(`${commitId}\0subject\0author\0${1_600_000_000}\0`),
    ]
    const combined = 'diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new\n'
      + 'diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'
    const h = await harness({ workspaces: [workspace], children: [
      ...statusChildren, child('1\t0\tnew.ts\0' + '0\t1\told.ts\0'), child(combined),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=committed&commitId=${commitId}`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ files: [
      { path: 'new.ts', diff: expect.stringContaining('+new') },
      { path: 'old.ts', diff: expect.stringContaining('-old') },
    ], omittedFiles: 0 })
    await h.teardown()
  })

  it('returns every Last-turn file diff with before/after lifecycle metadata', async () => {
    const events = [{ type: 'workspace/changes', seq: 7, time: 700, data: { turn: 2 } }]
    const sessionWorkspace = { ...workspace, sessionIds: ['session-1'] }
    const summary = { cwd: workspace.path, files: [
      { path: 'added.ts', display: 'added.ts', added: 1, deleted: 0 },
      { path: 'deleted.ts', display: 'deleted.ts', added: 0, deleted: 1 },
    ] }
    const h = await harness({
      workspaces: [sessionWorkspace], children: [child('/repo/root\n')],
      sessionFor: () => ({ header: { cwd: workspace.path }, snapshotEvents: () => events }),
      summaryFor: () => summary,
      diffFor: (_id, _seq, index) => index === 0
        ? { kind: 'text', path: 'added.ts', display: 'added.ts', before: false, after: true, coarse: false, hunks: [] }
        : { kind: 'text', path: 'deleted.ts', display: 'deleted.ts', before: true, after: false, coarse: false, hunks: [] },
    })
    const res = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=last-turn`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ files: [
      { path: 'added.ts', turnDiff: { before: false, after: true } },
      { path: 'deleted.ts', turnDiff: { before: true, after: false } },
    ], omittedFiles: 0 })
    await h.teardown()
  })

  it('reads file diffs from the canonical worktree and keeps path after the option separator', async () => {
    const h = await harness({ workspaces: [workspace], children: [
      child('/repo/root\n'), child('## main\0 M changed.ts\0'), child('1\t0\tchanged.ts\0'), child(''), child('* refs/heads/main\0'), child(''), child('diff --git a/changed.ts b/changed.ts\n+line\n'),
    ] })
    const res = response()
    await h.routes.get(GIT_REVIEW_DIFF_PATH)!.handler(request(`${GIT_REVIEW_DIFF_PATH}?${primaryScope}&category=unstaged&path=changed.ts`), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ diff: 'diff --git a/changed.ts b/changed.ts\n+line\n' })
    const [diffSpec] = h.spawn.mock.calls.at(-1) ?? []
    expect(diffSpec?.cwd).toBe('/repo/root')
    expect(diffSpec?.argv.slice(-2)).toEqual(['--', 'changed.ts'])
    await h.teardown()
  })
})
