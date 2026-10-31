/**
 * dsh-ide-git — API integration test.
 *
 * Drives the real host-half route against a throwaway git repository created in
 * the OS temp dir: parses (porcelain -z / numstat -z / log record format),
 * mutations (stage / unstage / commit / branch / tag), and every guard
 * (confirm, ref injection, path escape, method lookup, trust fence).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, symlinkSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { apply, repoScanCache, REPOS_CACHE_TTL_MS } from '../src/index.js'

let repo = ''
let route = null
const workspaces = new Set()
const attachments = new Map()
let desktopRootsEnabled = false
let rejection = undefined
const securityServices = {
  connection: { requestRejection: () => rejection },
  workspaceRegistry: { list: () => [...workspaces].map((path, index) => ({ id: String(index), path })) },
  reflect: { get: (name) => name === 'desktopGitSourceRoots' && desktopRootsEnabled
    ? { attachedRoots: (primary) => attachments.get(primary) ?? [] }
    : undefined },
}

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

function call(method, payload, headers) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/dsh-ide-git/api/' + method
    req.headers = Object.assign({ host: '127.0.0.1:3080', 'content-type': 'application/json' }, headers)
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status },
      end(text) {
        try { resolve({ status: this.statusCode, body: text && text.startsWith('{') ? JSON.parse(text) : text }) } catch (error) { reject(error) }
      },
    }
    void route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(payload === undefined ? {} : payload)))
    req.emit('end')
  })
}

before(() => {
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (spec) => { route = spec; return () => {} } },
    ...securityServices,
  }
  apply(ctx)
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/dsh-ide-git/api')

  repo = mkdtempSync(join(tmpdir(), 'dsh-ide-git-api-'))
  workspaces.add(repo)
  git('init', '-q', '-b', 'main')
  // Fixture isolation: Windows Git for Windows ships a system-level
  // core.autocrlf=true that rewrites LF to CRLF on every checkout/restore,
  // which breaks byte-exact assertions on files written back by the
  // discard/undo round-trip. The throwaway repo must not inherit any host
  // line-ending policy.
  git('config', 'core.autocrlf', 'false')
  git('config', 'core.eol', 'lf')
  git('config', 'user.name', 'Check')
  git('config', 'user.email', 'check@example.com')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  mkdirSync(join(repo, 'sub'))
  writeFileSync(join(repo, 'sub', 'b.txt'), 'bee\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'second\n\nbody line')
  git('tag', 'v1')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'c.txt'), 'see\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'third on feature')
  git('checkout', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repo, 'untracked.txt'), 'new\n')
  writeFileSync(join(repo, 'staged.txt'), 'staged\n')
  git('add', 'staged.txt')
})

after(() => {
  if (repo !== '') rmSync(repo, { recursive: true, force: true })
})

test('summary classifies staged / unstaged / untracked with diffstats', async () => {
  const { status, body } = await call('summary', { cwd: repo })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.branch, 'main')
  assert.equal(body.data.detached, false)
  assert.deepEqual(body.data.changes.staged.map((file) => file.path), ['staged.txt'])
  const unstaged = body.data.changes.unstaged.map((file) => file.path)
  assert.deepEqual(unstaged, ['a.txt'])
  assert.equal(body.data.changes.unstaged[0].additions, 1)
  assert.deepEqual(body.data.changes.untracked.map((file) => file.path), ['untracked.txt'])
  assert.ok(Array.isArray(body.data.worktrees))
  assert.equal(body.data.worktrees.length, 1)
})

test('summary with stats: false defers the diffstats, stats delivers phase two (issue #11)', async () => {
  const deferred = await call('summary', { cwd: repo, stats: false })
  assert.equal(deferred.status, 200)
  assert.equal(deferred.body.data.statsDeferred, true)
  // Rows are complete without the numbers; stats simply read as 0 until the merge.
  assert.deepEqual(deferred.body.data.changes.staged.map((file) => file.path), ['staged.txt'])
  assert.equal(deferred.body.data.changes.unstaged[0].additions, 0)
  assert.equal(deferred.body.data.changes.unstaged[0].deletions, 0)
  // A summary without the flag keeps the legacy single-phase shape.
  const full = await call('summary', { cwd: repo })
  assert.equal(full.body.data.statsDeferred, false)
  assert.equal(full.body.data.changes.unstaged[0].additions, 1)

  const second = await call('stats', { cwd: repo })
  assert.equal(second.status, 200)
  assert.equal(second.body.ok, true)
  const unstaged = second.body.data.unstaged.filter((row) => row[0] === 'a.txt')
  assert.equal(unstaged.length, 1)
  assert.equal(unstaged[0][1], 1)
  assert.equal(unstaged[0][2], 0)
  assert.equal(unstaged[0][3], false)
  const staged = second.body.data.staged.filter((row) => row[0] === 'staged.txt')
  assert.equal(staged.length, 1)
  assert.equal(staged[0][1], 1)
})

test('gitLogs records runs and clone validates its inputs (v0.15 more-menu)', async () => {
  const logs = await call('gitLogs', {})
  assert.equal(logs.status, 200)
  assert.ok(Array.isArray(logs.body.data.entries))
  assert.ok(logs.body.data.entries.length > 0)
  const last = logs.body.data.entries[logs.body.data.entries.length - 1]
  assert.equal(typeof last.argv, 'string')
  assert.equal(typeof last.code, 'number')
  assert.equal(typeof last.at, 'string')

  // A local path is a valid clone source — fast, offline, and proves the happy path.
  const target = join(repo, 'dig-clone-' + String(process.pid))
  const cloned = await call('clone', { cwd: repo, url: repo, dir: target })
  assert.equal(cloned.status, 200)
  assert.equal(cloned.body.ok, true)
  assert.ok(existsSync(join(target, '.git')))
  rmSync(target, { recursive: true, force: true })

  const badUrl = await call('clone', { url: '', dir: join(tmpdir(), 'x') })
  assert.notEqual(badUrl.status, 200)
  const badDir = await call('clone', { url: repo, dir: 'relative/path' })
  assert.notEqual(badDir.status, 200)
  const flagUrl = await call('clone', { url: '--upload-pack=evil', dir: join(tmpdir(), 'x') })
  assert.notEqual(flagUrl.status, 200)
})

test('branches reports locals, remotes, tags and HEAD', async () => {
  const { body } = await call('branches', { cwd: repo })
  const names = body.data.local.map((entry) => entry.name)
  assert.ok(names.includes('main'))
  assert.ok(names.includes('feature'))
  const head = body.data.local.filter((entry) => entry.head === true)
  assert.equal(head.length, 1)
  assert.equal(head[0].name, 'main')
  assert.deepEqual(body.data.tags.map((tag) => tag.name), ['v1'])
  assert.ok(Array.isArray(body.data.remotes))
})

test('log parses hash, parents and paginates', async () => {
  const first = await call('log', { cwd: repo, limit: 1 })
  assert.equal(first.body.data.commits.length, 1)
  assert.equal(first.body.data.hasMore, true)
  const head = first.body.data.commits[0]
  assert.equal(head.parents.length, 1)
  assert.match(head.hash, /^[0-9a-f]{40}$/)
  assert.ok(head.refs.some((ref) => ref.includes('HEAD')))
  const rest = await call('log', { cwd: repo, limit: 10, rev: 'v1' })
  assert.equal(rest.body.data.commits[0].subject, 'second')
  assert.equal(rest.body.data.hasMore, false)
})

test('commitDetail returns body and per-file numstat', async () => {
  // v1 is tagged on the second commit — a stable anchor that earlier tests
  // (which add commits) cannot move.
  const hash = git('rev-parse', 'v1').trim()
  const { body } = await call('commitDetail', { cwd: repo, hash })
  assert.equal(body.data.subject, 'second')
  assert.equal(body.data.body.trim(), 'body line')
  const paths = body.data.files.map((file) => file.path)
  assert.ok(paths.includes('sub/b.txt'))
})

test('diff returns a unified patch and rejects escaping paths', async () => {
  const ok = await call('diff', { cwd: repo, path: 'a.txt' })
  assert.match(ok.body.data.patch, /\+three/)
  const escaped = await call('diff', { cwd: repo, path: '../../etc/passwd' })
  assert.equal(escaped.body.ok, false)
  assert.equal(escaped.body.error.code, 'bad-request')
})

test('diff renders untracked files as a new-file patch and fences --no-index escapes', async () => {
  // The pre-fix behavior stays byte-identical for callers that do not opt in.
  const legacy = await call('diff', { cwd: repo, path: 'untracked.txt' })
  assert.equal(legacy.body.ok, true)
  assert.equal(legacy.body.data.patch, '')
  // untracked: true rides a --no-index /dev/null patch so the preview is not blank.
  const ok = await call('diff', { cwd: repo, path: 'untracked.txt', untracked: true })
  assert.equal(ok.body.ok, true)
  assert.match(ok.body.data.patch, /new file mode/)
  assert.match(ok.body.data.patch, /^\+new$/m)
  // the header lines are rewritten repository-relative, not the absolute path
  assert.match(ok.body.data.patch, /^\+\+\+ b\/untracked\.txt$/m)
  assert.equal(ok.body.data.patch.includes(repo), false)
  // --no-index reads the file for real, so an absolute path must not escape.
  const absEscape = await call('diff', { cwd: repo, path: '/etc/hosts', untracked: true })
  assert.equal(absEscape.body.ok, false)
  assert.equal(absEscape.body.error.code, 'bad-request')
  const relEscape = await call('diff', { cwd: repo, path: '../../../etc/passwd', untracked: true })
  assert.equal(relEscape.body.ok, false)
})

test('stage, unstage and commit move files through the index', async () => {
  const staged = await call('stage', { cwd: repo, paths: ['a.txt'] })
  assert.equal(staged.body.ok, true)
  const after = await call('summary', { cwd: repo })
  assert.deepEqual(after.body.data.changes.staged.map((file) => file.path).sort(), ['a.txt', 'staged.txt'])
  const unstaged = await call('unstage', { cwd: repo, paths: ['a.txt'] })
  assert.equal(unstaged.body.ok, true)
  const committed = await call('commit', { cwd: repo, message: 'check commit' })
  assert.equal(committed.body.ok, true)
  assert.match(committed.body.data.output, /check commit/)
})

test('branch and tag lifecycle works and compare reports the delta', async () => {
  const created = await call('checkout', { cwd: repo, branch: 'tmp-check', create: true })
  assert.equal(created.body.data.created, true)
  const back = await call('checkout', { cwd: repo, branch: 'main' })
  assert.equal(back.body.data.branch, 'main')
  const renamed = await call('branchRename', { cwd: repo, from: 'tmp-check', to: 'tmp-renamed' })
  assert.equal(renamed.body.data.to, 'tmp-renamed')
  const deleted = await call('branchDelete', { cwd: repo, name: 'tmp-renamed' })
  assert.equal(deleted.body.data.force, false)
  const hash = git('rev-parse', 'HEAD~1').trim()
  await call('tagCreate', { cwd: repo, name: 'v2', hash })
  assert.ok((await call('branches', { cwd: repo })).body.data.tags.some((tag) => tag.name === 'v2'))
  await call('tagDelete', { cwd: repo, name: 'v2' })
  const compared = await call('compare', { cwd: repo, base: 'main', head: 'feature' })
  assert.deepEqual(compared.body.data.files.map((file) => file.path), ['c.txt'])
  assert.equal(compared.body.data.commits.length, 1)
})

test('stash push / list / apply / drop round-trips', async () => {
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n')
  const pushed = await call('stashPush', { cwd: repo, message: 'api-check' })
  assert.equal(pushed.body.ok, true)
  const listed = await call('stashList', { cwd: repo })
  assert.equal(listed.body.data.stashes.length, 1)
  assert.match(listed.body.data.stashes[0].subject, /api-check/)
  const applied = await call('stashApply', { cwd: repo, ref: 'stash@{0}' })
  assert.equal(applied.body.ok, true)
  const dropped = await call('stashDrop', { cwd: repo, ref: 'stash@{0}', confirm: true })
  assert.equal(dropped.body.ok, true)
  assert.equal((await call('stashList', { cwd: repo })).body.data.stashes.length, 0)
})

test('destructive methods refuse without confirm', async () => {
  assert.equal((await call('push', { cwd: repo })).body.error.message, 'push requires confirm: true')
  assert.equal((await call('reset', { cwd: repo, hash: 'HEAD', mode: 'hard' })).body.error.message, 'hard reset requires confirm: true')
  assert.equal((await call('branchDelete', { cwd: repo, name: 'feature', force: true })).body.error.message, 'force delete requires confirm: true')
  assert.equal((await call('stashDrop', { cwd: repo, ref: 'stash@{0}' })).body.error.message, 'dropping a stash requires confirm: true')
})

test('argument validation blocks ref injection', async () => {
  const injected = await call('checkout', { cwd: repo, branch: '--force' })
  assert.equal(injected.body.error.code, 'bad-request')
  const relative = await call('summary', { cwd: 'relative/path' })
  assert.equal(relative.body.error.message, 'cwd must be an absolute path')
  const unknown = await call('nope', { cwd: repo })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.error.code, 'not-found')
})

test('registered workspace boundaries reject external cwd, repoRoot, symlink and clone target', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'dsh-ide-git-outside-'))
  const alias = join(repo, 'outside-alias')
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: outside })
    symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')
    for (const method of ['summary', 'repos', 'stage', 'commit-message']) {
      const refused = await call(method, { cwd: outside, paths: [], sessionId: 'x' })
      assert.equal(refused.status, 403, method + ': ' + JSON.stringify(refused.body))
    }
    for (const candidate of [outside, alias]) {
      const refused = await call('summary', { cwd: repo, repoRoot: candidate })
      assert.equal(refused.status, 403, JSON.stringify(refused.body))
      const badCwd = await call('repos', { cwd: candidate })
      assert.equal(badCwd.status, 403)
    }
    const cloneExternal = await call('clone', { cwd: repo, url: repo, dir: join(outside, 'new') })
    assert.equal(cloneExternal.status, 403)
    assert.equal(existsSync(join(outside, 'new')), false)
    const cloneAlias = await call('clone', { cwd: repo, url: repo, dir: join(alias, 'new') })
    assert.equal(cloneAlias.status, 403)
    const cloneFinalAlias = await call('clone', { cwd: repo, url: repo, dir: alias })
    assert.notEqual(cloneFinalAlias.status, 200)
    assert.equal(existsSync(join(outside, 'new')), false)
    const linkedFile = join(repo, 'linked-secret')
    writeFileSync(join(outside, 'secret'), 'outside\n')
    symlinkSync(join(outside, 'secret'), linkedFile)
    try {
      const diff = await call('diff', { cwd: repo, path: 'linked-secret', untracked: true })
      assert.equal(diff.status, 400, 'untracked diff must not read symlink targets outside the repository')
    } finally { rmSync(linkedFile, { force: true }) }
    const badRoot = await call('summary', { cwd: repo, repoRoot: join(repo, 'sub') })
    assert.equal(badRoot.status, 400, 'repoRoot must be an actual git root')
    const absolutePath = await call('stage', { cwd: repo, paths: [join(outside, 'secret')] })
    assert.equal(absolutePath.status, 400)
  } finally {
    rmSync(alias, { force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('roots resolves nested Session cwd to its registered primary without Desktop', async () => {
  for (const cwd of [repo, join(repo, 'sub')]) {
    assert.deepEqual((await call('roots', { cwd })).body.data, { workspace: repo, roots: [repo] })
  }
  const outside = mkdtempSync(join(tmpdir(), 'dsh-ide-git-unregistered-'))
  const alias = join(repo, 'outside-root-link')
  try {
    assert.equal((await call('roots', { cwd: outside })).status, 403)
    symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal((await call('roots', { cwd: alias })).status, 403)
  } finally {
    rmSync(alias, { force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('replacing a registered primary with a symlink revokes its grant and attached associations', async () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-ide-git-primary-swap-'))
  const primary = join(base, 'primary')
  const oldDirectory = join(base, 'old-primary')
  const outside = join(base, 'outside')
  const attached = join(base, 'attached')
  mkdirSync(primary)
  mkdirSync(outside)
  mkdirSync(attached)
  workspaces.add(primary)
  desktopRootsEnabled = true
  attachments.set(primary, [attached])
  try {
    assert.deepEqual((await call('roots', { cwd: primary })).body.data.roots, [primary, attached])
    renameSync(primary, oldDirectory)
    symlinkSync(outside, primary, process.platform === 'win32' ? 'junction' : 'dir')
    for (const cwd of [primary, oldDirectory, outside, attached]) {
      assert.equal((await call('roots', { cwd })).status, 403)
      assert.equal((await call('repos', { cwd })).status, 403)
    }
  } finally {
    workspaces.delete(primary)
    attachments.delete(primary)
    desktopRootsEnabled = false
    rmSync(base, { recursive: true, force: true })
  }
})

test('attached source is a live selected grant, independent of primary and Files selection', async () => {
  const attached = mkdtempSync(join(tmpdir(), 'dsh-ide-git-attached-'))
  const unrelated = mkdtempSync(join(tmpdir(), 'dsh-ide-git-unrelated-'))
  desktopRootsEnabled = true
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: attached })
    execFileSync('git', ['config', 'user.name', 'Check'], { cwd: attached })
    execFileSync('git', ['config', 'user.email', 'check@example.com'], { cwd: attached })
    writeFileSync(join(attached, 'attached.txt'), 'attached\n')
    execFileSync('git', ['add', '-A'], { cwd: attached })
    execFileSync('git', ['commit', '-q', '-m', 'attached'], { cwd: attached })
    attachments.set(repo, [attached])
    mkdirSync(join(attached, 'session-dir'))
    for (const cwd of [repo, join(repo, 'sub'), attached, join(attached, 'session-dir')]) {
      assert.deepEqual((await call('roots', { cwd })).body.data, { workspace: repo, roots: [repo, attached] })
    }
    assert.equal((await call('summary', { cwd: attached })).status, 200)
    assert.ok((await call('repos', { cwd: attached })).body.data.repos.some((row) => row.path === attached))
    const cloned = join(attached, 'clone-check')
    assert.equal((await call('clone', { cwd: attached, url: repo, dir: cloned })).status, 200)
    rmSync(cloned, { recursive: true, force: true })
    // A selected primary cannot borrow a repoRoot or clone destination from the
    // attached grant, nor may an attached selection borrow the primary's tree.
    for (const [cwd, other] of [[repo, attached], [attached, repo]]) {
      assert.equal((await call('summary', { cwd, repoRoot: other })).status, 403)
      assert.equal((await call('clone', { cwd, url: repo, dir: join(other, 'blocked-clone') })).status, 403)
      assert.equal(existsSync(join(other, 'blocked-clone')), false)
    }
    assert.equal((await call('repos', { cwd: unrelated })).status, 403)
    assert.equal((await call('summary', { cwd: attached, repoRoot: unrelated })).status, 403)
    assert.equal((await call('clone', { cwd: attached, url: repo, dir: join(unrelated, 'blocked') })).status, 403)
    attachments.delete(repo)
    for (const method of ['summary', 'repos', 'clone']) {
      assert.equal((await call(method, { cwd: attached, url: repo, dir: join(attached, 'revoked') })).status, 403)
    }
    assert.deepEqual((await call('roots', { cwd: repo })).body.data.roots, [repo])
    assert.equal((await call('roots', { cwd: join(attached, 'session-dir') })).status, 403)
  } finally {
    attachments.delete(repo)
    desktopRootsEnabled = false
    rmSync(attached, { recursive: true, force: true })
    rmSync(unrelated, { recursive: true, force: true })
  }
})

test('replaced attached-source symlink cannot inherit a former grant', async () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-ide-git-replaced-'))
  const attached = join(base, 'source')
  const previous = join(base, 'previous')
  const replacement = join(base, 'replacement')
  mkdirSync(attached)
  mkdirSync(replacement)
  desktopRootsEnabled = true
  try {
    attachments.set(repo, [attached])
    assert.deepEqual((await call('roots', { cwd: repo })).body.data.roots, [repo, attached])
    renameSync(attached, previous)
    symlinkSync(replacement, attached, process.platform === 'win32' ? 'junction' : 'dir')
    assert.deepEqual((await call('roots', { cwd: repo })).body.data.roots, [repo])
    assert.equal((await call('repos', { cwd: attached })).status, 403)
    assert.equal((await call('repos', { cwd: previous })).status, 403)
  } finally {
    attachments.delete(repo)
    desktopRootsEnabled = false
    rmSync(base, { recursive: true, force: true })
  }
})

test('nested repository is usable but its path must remain inside the workspace', async () => {
  const nested = join(repo, 'nested-test')
  mkdirSync(nested)
  try {
    execFileSync('git', ['init', '-q', '-b', 'nested'], { cwd: nested })
    execFileSync('git', ['config', 'user.name', 'Check'], { cwd: nested })
    execFileSync('git', ['config', 'user.email', 'check@example.com'], { cwd: nested })
    writeFileSync(join(nested, 'readme.txt'), 'nested\n')
    execFileSync('git', ['add', '-A'], { cwd: nested })
    execFileSync('git', ['commit', '-q', '-m', 'nested'], { cwd: nested })
    const summary = await call('summary', { cwd: repo, repoRoot: nested })
    assert.equal(summary.status, 200, JSON.stringify(summary.body))
    assert.equal(summary.body.data.branch, 'nested')
    const clone = await call('clone', { cwd: repo, url: repo, dir: join(repo, 'nested-clone') })
    assert.equal(clone.status, 200, JSON.stringify(clone.body))
    rmSync(join(repo, 'nested-clone'), { recursive: true, force: true })
  } finally { rmSync(nested, { recursive: true, force: true }) }
})

test('connection rejection precedes all routes regardless of spoofed Host and fetch headers', async () => {
  for (const status of [401, 403]) {
    rejection = status
    try {
      for (const method of ['summary', 'clone', 'roots', 'gitLogs', 'commit-models', 'version']) {
        const rejected = await call(method, { cwd: repo, url: repo, dir: join(repo, 'never-clone') }, { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })
        assert.equal(rejected.status, status, method)
      }
    } finally { rejection = undefined }
  }
  const allowed = await call('summary', { cwd: repo }, { host: 'remote.example.com' })
  assert.equal(allowed.status, 200)
})

test('branch delete is reversible through the undo stack', async () => {
  git('branch', 'doomed', 'HEAD')
  const head = git('rev-parse', 'doomed').trim()
  const removed = await call('branchDelete', { cwd: repo, name: 'doomed' })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.data.hash, head)
  assert.ok(removed.body.data.undo !== undefined, 'a delete must hand back an undo handle')
  assert.equal(git('branch', '--list', 'doomed').trim(), '')
  const listed = await call('undoList', { cwd: repo })
  assert.ok(listed.body.data.items.some((entry) => entry.id === removed.body.data.undo.id))
  const undone = await call('undoApply', { cwd: repo, id: removed.body.data.undo.id })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.data.kind, 'branch-delete')
  assert.equal(git('rev-parse', 'doomed').trim(), head)
  // One-shot: the same handle cannot be replayed.
  const again = await call('undoApply', { cwd: repo, id: removed.body.data.undo.id })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'undo-gone')
  git('branch', '-q', '-D', 'doomed')
})

test('undo refuses when the branch name is taken again', async () => {
  git('branch', 'redo', 'HEAD')
  const removed = await call('branchDelete', { cwd: repo, name: 'redo' })
  git('branch', 'redo', 'HEAD')
  const conflict = await call('undoApply', { cwd: repo, id: removed.body.data.undo.id })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'undo-conflict')
  git('branch', '-q', '-D', 'redo')
})

test('multi-select batch: branch/tag delete accept arrays and stay reversible', async () => {
  git('branch', 'batch-a', 'HEAD')
  git('branch', 'batch-b', 'HEAD')
  const removed = await call('branchDelete', { cwd: repo, names: ['batch-a', 'batch-b'] })
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.body.data.names, ['batch-a', 'batch-b'])
  assert.equal(git('branch', '--list', 'batch-a').trim(), '')
  assert.equal(git('branch', '--list', 'batch-b').trim(), '')
  // ONE handle restores BOTH branches.
  const undone = await call('undoApply', { cwd: repo, id: removed.body.data.undo.id })
  assert.equal(undone.status, 200)
  const base = git('rev-parse', 'HEAD').trim()
  assert.equal(git('rev-parse', 'batch-a').trim(), base)
  assert.equal(git('rev-parse', 'batch-b').trim(), base)
  git('branch', '-q', '-D', 'batch-a', 'batch-b')
  // The checked-out branch is refused even inside a batch.
  const current = git('rev-parse', '--abbrev-ref', 'HEAD').trim()
  const refused = await call('branchDelete', { cwd: repo, names: ['batch-a', current] })
  assert.equal(refused.status, 409)
  assert.equal(refused.body.error.code, 'protected-branch')
  // Ref names inside a batch go through the same guard.
  const injected = await call('branchDelete', { cwd: repo, names: ['--force'] })
  assert.equal(injected.body.error.code, 'bad-request')

  git('tag', 'batch-t1', 'HEAD')
  git('tag', 'batch-t2', 'HEAD')
  const tags = await call('tagDelete', { cwd: repo, names: ['batch-t1', 'batch-t2'] })
  assert.equal(tags.status, 200)
  assert.deepEqual(tags.body.data.names, ['batch-t1', 'batch-t2'])
  assert.equal(git('tag', '--list', 'batch-t1').trim(), '')
  assert.equal(git('tag', '--list', 'batch-t2').trim(), '')
})

test('multi-select batch: cherry-pick expands hashes to one git call', async () => {
  // A well-formed but unknown hash proves the array reaches git (git-failed),
  // while a ref-injection attempt is stopped by the per-item guard (bad-request).
  const missing = await call('cherryPick', { cwd: repo, hashes: ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'] })
  assert.equal(missing.status, 409)
  assert.equal(missing.body.error.code, 'git-failed')
  const injected = await call('cherryPick', { cwd: repo, hashes: ['HEAD; rm -rf /'] })
  assert.equal(injected.body.error.code, 'bad-request')
})

test('the checked-out branch and protected branches are guarded', async () => {
  const current = await call('branchDelete', { cwd: repo, name: 'main', confirm: true })
  assert.equal(current.status, 409)
  assert.equal(current.body.error.code, 'protected-branch')
  git('branch', 'master', 'HEAD')
  const guarded = await call('branchDelete', { cwd: repo, name: 'master' })
  assert.equal(guarded.status, 400)
  assert.match(guarded.body.error.message, /requires confirm: true/)
  const allowed = await call('branchDelete', { cwd: repo, name: 'master', confirm: true })
  assert.equal(allowed.status, 200)
})

test('discard refuses to target the repository root', async () => {
  writeFileSync(join(repo, 'keep-me.txt'), 'x\n')
  const refused = await call('discard', { cwd: repo, paths: ['.'], untracked: true, confirm: true })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error.message, 'paths is required')
  assert.ok(existsSync(join(repo, 'keep-me.txt')), 'a refused discard must not delete anything')
  rmSync(join(repo, 'keep-me.txt'), { force: true })
})

test('summary reports an in-progress git operation', async () => {
  assert.equal((await call('summary', { cwd: repo })).body.data.operation, null)
  const marker = join(repo, '.git', 'MERGE_HEAD')
  writeFileSync(marker, git('rev-parse', 'HEAD'))
  assert.equal((await call('summary', { cwd: repo })).body.data.operation, 'merge')
  rmSync(marker, { force: true })
  assert.equal((await call('summary', { cwd: repo })).body.data.operation, null)
})

test('a dropped stash can be restored from the undo stack', async () => {
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n')
  await call('stashPush', { cwd: repo, message: 'undo-check' })
  assert.equal((await call('stashList', { cwd: repo })).body.data.stashes.length, 1)
  const dropped = await call('stashDrop', { cwd: repo, ref: 'stash@{0}', confirm: true })
  assert.equal(dropped.status, 200)
  assert.ok(dropped.body.data.undo !== undefined)
  assert.equal((await call('stashList', { cwd: repo })).body.data.stashes.length, 0)
  const undone = await call('undoApply', { cwd: repo, id: dropped.body.data.undo.id })
  assert.equal(undone.status, 200)
  assert.equal((await call('stashList', { cwd: repo })).body.data.stashes.length, 1)
  git('stash', 'clear')
})

test('discarding a tracked file hands back an undo that puts the bytes back', async () => {
  const target = join(repo, 'undo-discard.txt')
  writeFileSync(target, 'committed\n')
  git('add', 'undo-discard.txt')
  git('commit', '-q', '-m', 'add undo-discard')
  writeFileSync(target, 'dirty edit\n')
  const discarded = await call('discard', { cwd: repo, paths: ['undo-discard.txt'] })
  assert.equal(discarded.status, 200)
  assert.equal(readFileSync(target, 'utf8'), 'committed\n')
  assert.ok(discarded.body.data.undo !== undefined, 'a discard must hand back an undo handle')
  const undone = await call('undoApply', { cwd: repo, id: discarded.body.data.undo.id })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.data.kind, 'discard')
  assert.equal(readFileSync(target, 'utf8'), 'dirty edit\n')
  // One-shot, exactly like the delete handles.
  const again = await call('undoApply', { cwd: repo, id: discarded.body.data.undo.id })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'undo-gone')
})

test('discarding an untracked file can be undone too', async () => {
  const target = join(repo, 'untracked-note.txt')
  writeFileSync(target, 'scratch\n')
  const discarded = await call('discard', { cwd: repo, paths: ['untracked-note.txt'], untracked: true, confirm: true })
  assert.equal(discarded.status, 200)
  assert.equal(existsSync(target), false, 'clean really deletes the file')
  assert.ok(discarded.body.data.undo !== undefined)
  const undone = await call('undoApply', { cwd: repo, id: discarded.body.data.undo.id })
  assert.equal(undone.status, 200)
  assert.equal(readFileSync(target, 'utf8'), 'scratch\n')
  rmSync(target, { force: true })
})

test('a file deleted in the working tree is undone back to absent', async () => {
  const target = join(repo, 'gone.txt')
  writeFileSync(target, 'committed\n')
  git('add', 'gone.txt')
  git('commit', '-q', '-m', 'add gone')
  rmSync(target)
  const discarded = await call('discard', { cwd: repo, paths: ['gone.txt'] })
  assert.equal(discarded.status, 200)
  assert.equal(existsSync(target), true, 'checkout brings the committed file back')
  const undone = await call('undoApply', { cwd: repo, id: discarded.body.data.undo.id })
  assert.equal(undone.status, 200)
  assert.equal(existsSync(target), false, 'undoing restores the deletion, not the file')
})

test('the discard undo refuses once the file changed again', async () => {
  const target = join(repo, 'undo-conflict.txt')
  writeFileSync(target, 'first\n')
  git('add', 'undo-conflict.txt')
  git('commit', '-q', '-m', 'add undo-conflict')
  writeFileSync(target, 'second\n')
  const discarded = await call('discard', { cwd: repo, paths: ['undo-conflict.txt'] })
  assert.equal(discarded.status, 200)
  // The user typed something new after the discard: writing the old bytes back
  // would silently destroy it, so the undo has to refuse.
  writeFileSync(target, 'third\n')
  const conflict = await call('undoApply', { cwd: repo, id: discarded.body.data.undo.id })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'undo-conflict')
  assert.equal(readFileSync(target, 'utf8'), 'third\n')
})

test('a discard too large to snapshot still happens, just without an undo handle', async () => {
  const target = join(repo, 'huge-untracked.bin')
  writeFileSync(target, Buffer.alloc(5 * 1024 * 1024, 7))
  const discarded = await call('discard', { cwd: repo, paths: ['huge-untracked.bin'], untracked: true, confirm: true })
  assert.equal(discarded.status, 200)
  assert.equal(existsSync(target), false)
  // No handle is better than a handle that would fail later: the panel says so.
  assert.equal(discarded.body.data.undo, undefined)
  assert.equal(discarded.body.data.undoBlocked, true)
})

test('ignored files show up only when the panel asks for them', async () => {
  writeFileSync(join(repo, '.gitignore'), 'ignored-dir/\nignored-note.txt\n')
  mkdirSync(join(repo, 'ignored-dir'), { recursive: true })
  writeFileSync(join(repo, 'ignored-dir', 'junk.txt'), 'x\n')
  writeFileSync(join(repo, 'ignored-note.txt'), 'x\n')
  const plain = await call('summary', { cwd: repo })
  assert.deepEqual(plain.body.data.changes.ignored, [], 'ignored files stay out of the default summary')
  const asked = await call('summary', { cwd: repo, ignored: true })
  const paths = asked.body.data.changes.ignored.map((file) => file.path)
  // --ignored=traditional reports the directory itself, not every file inside it.
  assert.ok(paths.includes('ignored-dir/'), 'ignored directory as one entry: ' + JSON.stringify(paths))
  assert.ok(paths.includes('ignored-note.txt'))
  assert.equal(asked.body.data.changes.untracked.some((file) => file.path.indexOf('ignored') === 0), false,
    'nothing ignored may leak into the groups the panel stages from')
  rmSync(join(repo, 'ignored-dir'), { recursive: true, force: true })
  rmSync(join(repo, 'ignored-note.txt'), { force: true })
  rmSync(join(repo, '.gitignore'), { force: true })
})

test('only ANOTHER working tree marks a branch as occupied', async () => {
  // `git worktree list` includes the checkout the repository lives in, so a naive
  // read flags the CURRENT branch as occupied by its own working tree.
  const linked = join(tmpdir(), 'dsh-ide-git-wt-' + Date.now())
  git('worktree', 'add', '-q', '-b', 'wt-branch', linked)
  try {
    const data = await call('branches', { cwd: repo })
    const current = data.body.data.local.find((entry) => entry.name === data.body.data.branch)
    const other = data.body.data.local.find((entry) => entry.name === 'wt-branch')
    assert.ok(current !== undefined && other !== undefined, 'both branches are listed')
    assert.equal(current.worktree, null, 'the checkout the panel is looking at is not occupied')
    assert.ok(other.worktree !== null && other.worktree.indexOf('dsh-ide-git-wt-') >= 0,
      'the linked checkout marks its own branch: ' + JSON.stringify(other.worktree))
  } finally {
    git('worktree', 'remove', '--force', linked)
    git('branch', '-D', 'wt-branch')
    rmSync(linked, { recursive: true, force: true })
  }
})

/* ============================== ai commit message (issue #6) ============================== */

/** Drive one commit-message call against a fake llm/sessions pair. */
async function withServices(llm, sessions, run) {
  let route = null
  let dispose = null
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (spec) => { route = spec; return () => {} } },
    ...securityServices,
    inject: (capabilities, callback) => {
      assert.deepEqual(capabilities, ['llm', 'sessions'])
      callback({
        get: (name) => (name === 'llm' ? llm : (name === 'sessions' ? sessions : undefined)),
        /* The service handle is module state: releasing it here keeps one test's
           fake model out of the next test's host. */
        effect: (fn) => { dispose = fn() },
      })
    },
  }
  apply(ctx)
  const call = (method, payload) => new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/dsh-ide-git/api/' + method
    req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status },
      end(text) { try { resolve({ status: this.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) } },
    }
    void route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(payload === undefined ? {} : payload)))
    req.emit('end')
  })
  try {
    return await run(call)
  } finally {
    if (typeof dispose === 'function') dispose()
  }
}

const chunksOf = (list) => (async function* generate() { for (const chunk of list) yield chunk })()
/* The default capability answer mirrors a real DeepSeek route: off and high
   efforts, high as the adapter default — the exact combination issue #7 tripped
   over (an unset effort resolves to reasoning ON, and the old hardcoded 512
   budget covered reasoning + message together). */
const fakeLlm = (chunks, seen, info) => ({
  listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  listModels: async (provider) => (provider === 'deepseek-official' ? [{ provider, id: 'deepseek-flash', name: 'Flash' }] : []),
  resolveModelInfo: async (provider, model) => (info === undefined
    ? { provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }
    : info),
  stream: (options) => { if (seen !== undefined) seen.push(options); return chunksOf(chunks) },
})
const fakeSessions = (config) => ({ list: () => [{ id: 'sess-1', requestHeader: () => ({ config }) }] })

test('commit-message: the accepted stream decides success, never silence', async () => {
  writeFileSync(join(repo, 'ai-subject.txt'), 'ai commit input\n')
  git('add', 'ai-subject.txt')
  const seen = []
  const llm = fakeLlm([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'feat: add the ai subject file\n\n' },
    { type: 'text-delta', index: 0, text: 'It exists so the message has something to describe.' },
    { type: 'finish', reason: { kind: 'stop' } },
  ], seen)
  const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.match(result.body.data.message, /^feat: add the ai subject file/)
  assert.equal(result.body.data.provider, 'deepseek-official')
  assert.equal(result.body.data.routeSource, 'session')
  assert.ok(result.body.data.input.files >= 1, 'the change set reached the model')
  // The user's own text is DATA in the message, never the system instruction.
  assert.ok(seen.length === 1)
  assert.ok(!seen[0].system.includes('Conventional Commits'), 'a user instruction must not become the system prompt')
  assert.equal(seen[0].provider, 'deepseek-official')
  assert.equal(seen[0].model, 'deepseek-flash')
  // Issue #7: the unset default asks for no reasoning, and the output cap is
  // the model's own configuration, never a hardcoded number.
  assert.equal(seen[0].reasoningEffort, 'off', 'an unset effort asks for off when the route offers it')
  assert.equal(seen[0].maxTokens, undefined, 'no hardcoded output cap is sent')
  assert.equal(result.body.data.reasoningEffort, 'off', 'the response reports the effort actually sent')
})

test('commit-message: the user prompt is appended as data and capped', async () => {
  const seen = []
  const llm = fakeLlm([{ type: 'text-delta', index: 0, text: 'chore: x' }, { type: 'finish', reason: { kind: 'stop' } }], seen)
  const long = 'A'.repeat(3000)
  const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1', prompt: long }))
  assert.equal(result.status, 200)
  assert.equal(result.body.data.promptTruncated, true)
  const text = seen[0].messages[0].content[0].text
  assert.ok(text.includes('A'.repeat(2000)), 'the prompt is appended to the user message')
  assert.ok(!text.includes('A'.repeat(2001)), 'the prompt is capped at the documented limit')
  assert.match(seen[0].system, /commit messages/, 'the built-in rules stay in the system prompt')
})

/* A workspace can hold several sibling repositories, so the session cwd is not
   necessarily a repository itself. Every other git call carries the picked one
   as `repoRoot`; commit-message resolved its root from `cwd` alone and answered
   not-a-repo, which made the AI message the one action that could not work in a
   multi-repo workspace while the rest of the panel did. */
test('commit-message: the picked repository travels as repoRoot in a multi-repo workspace', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-ide-git-ws-'))
  const picked = join(workspace, 'picked')
  mkdirSync(picked)
  workspaces.add(workspace)
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: picked })
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: picked })
    execFileSync('git', ['config', 'user.name', 'Check'], { cwd: picked })
    execFileSync('git', ['config', 'user.email', 'check@example.com'], { cwd: picked })
    writeFileSync(join(picked, 'a.txt'), 'one\n')
    execFileSync('git', ['add', '-A'], { cwd: picked })
    execFileSync('git', ['commit', '-q', '-m', 'first'], { cwd: picked })

    const seen = []
    const llm = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }], seen)
    await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), async (call) => {
      /* The picked repository wins over the cwd. A clean repository stops at
         "nothing to describe" — before the model is reached, so the fake stream
         stays unused and what the assertion measures is the resolved root. */
      const withRoot = await call('commit-message', { cwd: workspace, repoRoot: picked, sessionId: 'sess-1' })
      assert.equal(withRoot.status, 400, JSON.stringify(withRoot.body))
      assert.match(withRoot.body.error.message, /nothing to describe/)

      /* Without a picked repository the guard stays honest: a cwd outside every
         repository is still reported as not-a-repo, never silently guessed. */
      const withoutRoot = await call('commit-message', { cwd: workspace, sessionId: 'sess-1' })
      assert.equal(withoutRoot.status, 409, JSON.stringify(withoutRoot.body))
      assert.equal(withoutRoot.body.error.code, 'not-a-repo')
    })
    assert.equal(seen.length, 0, 'a clean repository never reaches the model')
  } finally {
    workspaces.delete(workspace)
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('commit-message: an error finish is a failure with the provider text, not an empty message', async () => {
  const failure = { code: 'NO_CREDENTIAL', message: 'no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY' }
  const llm = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure } }])
  const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(result.status, 502)
  assert.equal(result.body.error.code, 'llm-error')
  assert.match(result.body.error.message, /no API key for provider route/)
})

test('commit-message: aborted, truncated and finish-less streams all fail loud', async () => {
  const aborted = await withServices(fakeLlm([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'user cancelled' } } }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(aborted.body.error.code, 'llm-aborted')
  const cut = await withServices(fakeLlm([{ type: 'text-delta', index: 0, text: 'feat: half' }, { type: 'finish', reason: { kind: 'max-tokens' } }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(cut.status, 502)
  assert.equal(cut.body.error.code, 'llm-unfinished')
  /* Issue #7's exact signature: the budget (reasoning included) ran out
     mid-thought, so there is no message text at all — and the failure says
     what happened instead of a bare finish kind. */
  const burnt = await withServices(fakeLlm([{ type: 'reasoning-delta', index: 0, text: 'thinking and thinking' }, { type: 'finish', reason: { kind: 'max-tokens' } }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(burnt.status, 502)
  assert.equal(burnt.body.error.code, 'llm-unfinished')
  assert.match(burnt.body.error.message, /reasoning spent the whole output budget/, 'the diagnosis names the reasoning burn')
  const silent = await withServices(fakeLlm([{ type: 'text-delta', index: 0, text: 'feat: no finish' }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(silent.status, 502)
  assert.equal(silent.body.error.code, 'llm-no-finish')
  const empty = await withServices(fakeLlm([{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(empty.status, 502)
  assert.equal(empty.body.error.code, 'empty-output')
})

test('commit-message: a thrown adapter failure is still a loud failure', async () => {
  const llm = {
    listProviders: () => [{ id: 'p' }],
    listModels: async () => [],
    stream: () => (async function* generate() { throw new Error('adapter exploded') })(),
  }
  const result = await withServices(llm, fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(result.status, 500)
  assert.match(result.body.error.message, /adapter exploded/)
})

test('commit-message: no session route, unknown provider and unknown model are refused with a next step', async () => {
  const noRoute = await withServices(fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }]), { list: () => [{ id: 'sess-1', requestHeader: () => ({ config: {} }) }] }, (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
  assert.equal(noRoute.status, 502)
  assert.equal(noRoute.body.error.code, 'no-route')
  const noSession = await withServices(fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }]), { list: () => [] }, (call) => call('commit-message', { cwd: repo, sessionId: 'ghost' }))
  assert.equal(noSession.body.error.code, 'no-session')
  const badShape = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 's', model: 'deepseek-flash' }))
  assert.equal(badShape.status, 400)
  assert.match(badShape.body.error.message, /provider\/model/)
  const badProvider = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 's', model: 'nope/x' }))
  assert.equal(badProvider.body.error.code, 'unknown-provider')
  const badModel = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: repo, sessionId: 's', model: 'deepseek-official/nope' }))
  assert.equal(badModel.body.error.code, 'unknown-model')
  assert.match(badModel.body.error.message, /deepseek-flash/, 'the refusal names a model that does exist')
})

test('commit-message: the reasoning default is off when offered, and never assumed', async () => {
  writeFileSync(join(repo, 'ai-effort.txt'), 'reasoning default probe\n')
  git('add', 'ai-effort.txt')
  // Offered -> asked for off; the cap stays the model's own configuration.
  {
    const seen = []
    const llm = fakeLlm([{ type: 'text-delta', index: 0, text: 'chore: x' }, { type: 'finish', reason: { kind: 'stop' } }], seen)
    const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(seen[0].reasoningEffort, 'off')
    assert.equal(seen[0].maxTokens, undefined)
  }
  // Not offered on the route -> nothing sent: the adapter default stands (a
  // blind 'off' would be rejected by the runtime's efforts validation).
  {
    const seen = []
    const llm = fakeLlm([{ type: 'text-delta', index: 0, text: 'chore: x' }, { type: 'finish', reason: { kind: 'stop' } }], seen, { provider: 'deepseek-official', id: 'deepseek-flash', name: 'Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }] } })
    const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(seen[0].reasoningEffort, undefined, 'no off on the route: the effort is left to the adapter')
    assert.equal(result.body.data.reasoningEffort, null)
  }
  // The user's explicit choice always wins.
  {
    const seen = []
    const llm = fakeLlm([{ type: 'text-delta', index: 0, text: 'chore: x' }, { type: 'finish', reason: { kind: 'stop' } }], seen)
    const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1', reasoningEffort: 'low' }))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(seen[0].reasoningEffort, 'low', 'the explicit effort wins')
    assert.equal(result.body.data.reasoningEffort, 'low')
  }
  // A capability lookup that fails is a preference that could not be applied,
  // never a failed generation.
  {
    const seen = []
    const llm = {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [],
      resolveModelInfo: async () => { throw new Error('capability lookup down') },
      stream: (options) => { seen.push(options); return chunksOf([{ type: 'text-delta', index: 0, text: 'chore: x' }, { type: 'finish', reason: { kind: 'stop' } }]) },
    }
    const result = await withServices(llm, fakeSessions({ provider: 'deepseek-official', model: 'deepseek-flash' }), (call) => call('commit-message', { cwd: repo, sessionId: 'sess-1' }))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(seen[0].reasoningEffort, undefined, 'a failed lookup leaves the effort to the adapter')
  }
})

test('commit-models and commit-efforts feed the settings card pickers', async () => {
  const catalog = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-models', {}))
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body))
  assert.equal(catalog.body.data.providers.length, 1)
  assert.equal(catalog.body.data.providers[0].id, 'deepseek-official')
  assert.equal(catalog.body.data.providers[0].name, 'DeepSeek')
  assert.deepEqual(catalog.body.data.providers[0].models.map((row) => row.id), ['deepseek-flash'])
  const efforts = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-efforts', { model: 'deepseek-official/deepseek-flash' }))
  assert.equal(efforts.status, 200, JSON.stringify(efforts.body))
  assert.deepEqual(efforts.body.data.efforts.map((row) => row.id), ['off', 'high'])
  assert.equal(efforts.body.data.defaultEffort, 'high')
  const badShape = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-efforts', { model: 'nope' }))
  assert.equal(badShape.status, 400)
  assert.match(badShape.body.error.message, /provider\/model/)
  const badProvider = await withServices(fakeLlm([]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-efforts', { model: 'ghost/x' }))
  assert.equal(badProvider.body.error.code, 'unknown-provider')
  /* The picker is a convenience, not a gate: a capability lookup that fails
     answers an EMPTY list (the browser keeps its text field), not an error. */
  const broken = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [],
    resolveModelInfo: async () => { throw new Error('capability lookup down') },
    stream: () => chunksOf([]),
  }
  const quiet = await withServices(broken, fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-efforts', { model: 'deepseek-official/deepseek-flash' }))
  assert.equal(quiet.status, 200, JSON.stringify(quiet.body))
  assert.deepEqual(quiet.body.data.efforts, [])
})

test('commit-message: a host without llm/sessions answers no-host-service instead of hanging', async () => {
  let route = null
  apply({ effect: (fn) => fn(), webServer: { register: (spec) => { route = spec; return () => {} } }, ...securityServices })
  const response = await new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/dsh-ide-git/api/commit-message'
    req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
    req.destroy = () => {}
    const res = { statusCode: 0, writeHead(status) { this.statusCode = status }, end(text) { try { resolve({ status: this.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) } } }
    void route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ cwd: repo, sessionId: 'sess-1' })))
    req.emit('end')
  })
  assert.equal(response.status, 501)
  assert.equal(response.body.error.code, 'no-host-service')
})

test('commit-message: concurrent calls are serialized by one single-flight guard', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const llm = {
    listProviders: () => [{ id: 'p' }],
    listModels: async () => [],
    stream: () => (async function* generate() {
      await gate
      yield { type: 'text-delta', index: 0, text: 'feat: slow' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  const result = await withServices(llm, fakeSessions({ provider: 'p', model: 'm' }), async (call) => {
    const first = call('commit-message', { cwd: repo, sessionId: 'sess-1' })
    /* Let the model call take its time; the second click must be refused while
       the first is still in flight, and this timer is what ends the first. */
    setTimeout(() => { release() }, 400)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const second = await call('commit-message', { cwd: repo, sessionId: 'sess-1' })
    return { first: await first, second }
  })
  assert.equal(result.second.status, 409)
  assert.equal(result.second.body.error.code, 'busy')
  assert.equal(result.first.status, 200)
})

test('commit-message: four simultaneous clicks spend the model exactly once', async () => {
  // DEF-3: the single-flight window used to open only around the stream, so the
  // route lookup, the git reads and the model call all sat outside it and four
  // simultaneous requests each reached the provider (4x200, measured 3/3 rounds).
  let providerCalls = 0
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const llm = {
    listProviders: () => [{ id: 'p' }],
    listModels: async () => [],
    stream: () => {
      providerCalls += 1
      return (async function* generate() {
        await gate
        yield { type: 'text-delta', index: 0, text: 'feat: once' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const statuses = await withServices(llm, fakeSessions({ provider: 'p', model: 'm' }), async (call) => {
    const inflight = [
      call('commit-message', { cwd: repo, sessionId: 'sess-1' }),
      call('commit-message', { cwd: repo, sessionId: 'sess-1' }),
      call('commit-message', { cwd: repo, sessionId: 'sess-1' }),
      call('commit-message', { cwd: repo, sessionId: 'sess-1' }),
    ]
    await new Promise((resolve) => setTimeout(resolve, 150))
    release()
    const settled = await Promise.all(inflight)
    return settled.map((row) => row.status)
  })
  assert.equal(statuses.filter((status) => status === 200).length, 1, 'exactly one request may generate')
  assert.equal(statuses.filter((status) => status === 409).length, 3, 'the rest are refused as busy')
  assert.equal(providerCalls, 1, 'the provider is called once, not four times')
})

test('commit-message: a lock file is not a describable change, and says so', async () => {
  const lockRepo = mkdtempSync(join(tmpdir(), 'dsh-ide-git-lock-'))
  workspaces.add(lockRepo)
  const lockGit = (...args) => execFileSync('git', args, { cwd: lockRepo, encoding: 'utf8' })
  lockGit('init', '-q', '-b', 'main')
  lockGit('config', 'user.email', 't@example.com')
  lockGit('config', 'user.name', 't')
  writeFileSync(join(lockRepo, 'README.md'), 'base\n')
  lockGit('add', 'README.md')
  lockGit('commit', '-qm', 'init')
  writeFileSync(join(lockRepo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  lockGit('add', 'pnpm-lock.yaml')
  const result = await withServices(fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }]), fakeSessions({ provider: 'p', model: 'm' }), (call) => call('commit-message', { cwd: lockRepo, sessionId: 'sess-1' }))
  assert.equal(result.status, 400, JSON.stringify(result.body))
  assert.equal(result.body.error.code, 'only-ignored-changes')
  assert.match(result.body.error.message, /lock files or binary/)
  workspaces.delete(lockRepo)
  rmSync(lockRepo, { recursive: true, force: true })
})

/* ============================== repos discovery cache ==============================
 * The host caches one discovery pass per cwd (the client re-POSTs `repos` on
 * every panel mount, and a scan spawns a git process per checkout). The tests
 * drive the real route and seed `repoScanCache` directly: a row no scan could
 * ever produce (`/ghost/...`) is the hard evidence of WHERE an answer came
 * from. Pinning TTL to 0 is not expressible against an ESM binding, but the
 * freshness test is `Date.now() - at < REPOS_CACHE_TTL_MS` — an entry whose
 * `at` already lies past the window behaves exactly like a TTL of 0, where
 * every write expires immediately and every call rescans. */

test('repos serves a warm cache entry as-is and marks the answer cached', async () => {
  const ghost = { path: repo, name: 'from-cache', label: 'from-cache', branch: null, kind: 'workspace' }
  repoScanCache.set(repo, { at: Date.now(), rows: [{ ...ghost }, { ...ghost, path: tmpdir(), name: 'escaped-cache' }] })
  try {
    const { body } = await call('repos', { cwd: repo })
    assert.equal(body.ok, true)
    assert.equal(body.data.cached, true, 'a fresh entry must be answered from the cache')
    assert.deepEqual(body.data.repos, [ghost], 'the cached rows come back without any scan')
    assert.equal(body.data.isRepo, true, 'isRepo is derived from the cached rows like from a scan')
  } finally {
    repoScanCache.delete(repo)
  }
})

test('an expired entry forces a real scan, and the scan repopulates the cache', async () => {
  const stale = { path: '/ghost/stale', name: 'stale', label: 'stale', branch: null, kind: 'nested' }
  repoScanCache.set(repo, { at: Date.now() - REPOS_CACHE_TTL_MS - 1, rows: [stale] })
  try {
    const first = await call('repos', { cwd: repo })
    assert.equal(first.body.ok, true)
    assert.equal(first.body.data.cached, undefined, 'an expired entry must not be answered as cached')
    assert.ok(first.body.data.repos.every((row) => row.path !== '/ghost/stale'), 'the stale rows are gone')
    const self = first.body.data.repos.find((row) => row.kind === 'workspace')
    assert.ok(self !== undefined, 'the fixture repository itself is discovered')
    assert.equal(first.body.data.isRepo, true)
    // The fresh scan was written back: the immediate next call hits the cache.
    const second = await call('repos', { cwd: repo })
    assert.equal(second.body.data.cached, true, 'the repopulated entry serves the next call')
    assert.deepEqual(second.body.data.repos.map((row) => row.path), first.body.data.repos.map((row) => row.path))
  } finally {
    repoScanCache.delete(repo)
  }
})

test('REPOS_CACHE_TTL_MS stays the documented 15-second window', () => {
  assert.equal(REPOS_CACHE_TTL_MS, 15000)
})
