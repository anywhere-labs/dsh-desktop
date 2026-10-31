/**
 * dsh-ide-git — repository-picker integration test.
 *
 * Drives the real `repos` route against throwaway repositories built in the OS
 * temp dir. Git submodules are ordinary working trees with their own HEAD and
 * index that the parent only ever sees as one gitlink line, so the picker must
 * offer them as repositories of their own — the behavior a desktop Git client
 * gives when a submodule is clicked. A workspace that is only a container of
 * checkouts must keep listing them too.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { apply } from '../src/index.js'

let parent = ''
let container = ''
let route = null
const workspaces = new Set()

function git(cwd, ...args) {
  /* `protocol.file.allow=always` is what makes a submodule fixture possible at
     all: Git >= 2.38 refuses the `file://` transport for submodules by default
     (CVE-2022-39253), and a test has no server to clone from. */
  return execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function commitAll(cwd, message) {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
}

function makeRepo(dir, branch) {
  execFileSync('git', ['init', '-q', '-b', branch, dir], { encoding: 'utf8' })
  /* Windows Git for Windows ships a system-level core.autocrlf=true; a fixture
     that lets it rewrite line endings makes byte assertions host-dependent. */
  git(dir, 'config', 'core.autocrlf', 'false')
  git(dir, 'config', 'core.eol', 'lf')
  git(dir, 'config', 'user.name', 'Check')
  git(dir, 'config', 'user.email', 'check@example.com')
  writeFileSync(join(dir, 'readme.txt'), `${branch}\n`)
  commitAll(dir, `first on ${branch}`)
}

function call(method, payload) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/dsh-ide-git/api/' + method
    req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status },
      end(text) {
        try { resolve({ status: this.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) }
      },
    }
    void route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(payload === undefined ? {} : payload)))
    req.emit('end')
  })
}

const rows = (body) => body.data.repos
const find = (body, name) => rows(body).find((row) => row.name === name)

before(() => {
  apply({
    effect: (fn) => fn(),
    webServer: { register: (spec) => { route = spec; return () => {} } },
    connection: { requestRejection: () => undefined },
    workspaceRegistry: { list: () => [...workspaces].map((path) => ({ path })) },
  })
  assert.equal(route.path, '/dsh-ide-git/api')

  const base = mkdtempSync(join(tmpdir(), 'dsh-ide-git-repos-'))
  parent = join(base, 'parent')
  container = join(base, 'container')
  execFileSync('git', ['init', '-q', '-b', 'main', parent], { encoding: 'utf8' })
  git(parent, 'config', 'core.autocrlf', 'false')
  git(parent, 'config', 'core.eol', 'lf')
  git(parent, 'config', 'user.name', 'Check')
  git(parent, 'config', 'user.email', 'check@example.com')

  /* Two submodules on deliberately different branches: selecting one must
     report that checkout's branch, not the parent's. */
  const inner = join(base, 'inner')
  const sibling = join(base, 'sibling')
  makeRepo(inner, 'inner-work')
  makeRepo(sibling, 'sibling-work')

  writeFileSync(join(parent, 'top.txt'), 'top\n')
  git(parent, 'submodule', 'add', '-q', pathToFileURL(inner).href, 'libs/inner')
  git(parent, 'submodule', 'add', '-q', pathToFileURL(sibling).href, 'libs/sibling')
  commitAll(parent, 'add submodules')

  /* A container workspace: no repository of its own, several checkouts inside
     it. `base` itself is never a repository, so the directory scan is what
     reaches `parent`. */
  container = base
  workspaces.add(base)
})

after(() => {
  if (parent !== '') rmSync(parent, { recursive: true, force: true })
})

test('repos reports the workspace repository and every submodule', async () => {
  const { status, body } = await call('repos', { cwd: parent })
  assert.equal(status, 200)
  assert.equal(body.data.isRepo, true)

  const workspace = rows(body).filter((row) => row.kind === 'workspace')
  assert.equal(workspace.length, 1)
  assert.equal(workspace[0].name, 'parent')

  const names = rows(body).map((row) => row.name).sort()
  assert.deepEqual(names, ['libs/inner', 'libs/sibling', 'parent'])
})

test('every submodule row carries its own branch and a short label', async () => {
  const { body } = await call('repos', { cwd: parent })
  const inner = find(body, 'libs/inner')
  const sibling = find(body, 'libs/sibling')
  assert.equal(inner.branch, 'inner-work')
  assert.equal(sibling.branch, 'sibling-work')
  assert.equal(inner.label, 'inner')
  assert.equal(sibling.label, 'sibling')
  assert.equal(inner.kind, 'nested')
  assert.equal(inner.submodulePath, 'libs/inner')
})

test('a submodule path binds the git methods to that checkout', async () => {
  const { body } = await call('repos', { cwd: parent })
  const inner = find(body, 'libs/inner')
  const summary = await call('summary', { cwd: parent, repoRoot: inner.path })
  assert.equal(summary.status, 200, JSON.stringify(summary.body))
  /* The submodule answers with its own branch, so the panel is demonstrably
     bound to it and not to the parent that contains it. */
  assert.equal(summary.body.data.branch, 'inner-work')

  const branches = await call('branches', { cwd: parent, repoRoot: inner.path })
  assert.equal(branches.status, 200)
  assert.equal(branches.body.data.branch, 'inner-work')
  assert.deepEqual(branches.body.data.local.map((entry) => entry.name), ['inner-work'])
})

test('a container workspace still lists the checkouts inside it', async () => {
  const { status, body } = await call('repos', { cwd: container })
  assert.equal(status, 200)
  assert.equal(body.data.isRepo, false)
  const names = rows(body).map((row) => row.name).sort()
  assert.ok(names.includes('parent'), `expected the parent checkout in ${JSON.stringify(names)}`)
})

test('a checkout reachable two ways appears once', async () => {
  const { body } = await call('repos', { cwd: parent })
  /* The directory scan reaches `libs/inner` through its path and the submodule
     listing reaches it through the registration; both must collapse into the
     submodule row, whose name carries the repo-relative path. */
  const inners = rows(body).filter((row) => row.path.toLowerCase().endsWith('libs/inner'))
  assert.equal(inners.length, 1, 'one row per checkout')
  assert.equal(inners[0].name, 'libs/inner')
})

test('an uninitialised submodule is registered but not offered', async () => {
  /* `git submodule status` lists a submodule that was never initialised, but
     there is no working tree to bind the panel to, so it must not become a
     picker row. The registration is what the requirement is about; a path with
     no `.git` is the discriminator. */
  const blank = mkdtempSync(join(tmpdir(), 'dsh-ide-git-uninit-'))
  workspaces.add(blank)
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', blank], { encoding: 'utf8' })
    git(blank, 'config', 'core.autocrlf', 'false')
    git(blank, 'config', 'core.eol', 'lf')
    git(blank, 'config', 'user.name', 'Check')
    git(blank, 'config', 'user.email', 'check@example.com')
    writeFileSync(join(blank, 'top.txt'), 'top\n')
    commitAll(blank, 'initial')
    /* Register without checking out. `.gitmodules` is only the registry — the
       AUTHORITY is the gitlink (mode 160000) in the index and tree, which is
       what `git submodule status` reads. A directory that is absent from disk
       is exactly the state a fresh clone is in before
       `submodule update --init`. */
    const head = git(blank, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(blank, '.gitmodules'),
      '[submodule "libs/absent"]\n\tpath = libs/absent\n\turl = ' + pathToFileURL(blank).href + '\n')
    git(blank, 'add', '.gitmodules')
    git(blank, 'update-index', '--add', '--cacheinfo', '160000,' + head + ',libs/absent')
    git(blank, 'commit', '-q', '-m', 'register an uninitialised submodule')

    const status = git(blank, 'submodule', 'status')
    assert.ok(status.includes('libs/absent'), `git registers the uninitialised submodule: ${JSON.stringify(status)}`)
    assert.ok(status.startsWith('-'), 'the leading "-" marks it uninitialised')

    const { body } = await call('repos', { cwd: blank })
    assert.equal(body.data.isRepo, true)
    assert.equal(rows(body).length, 1, 'only the workspace row')
    assert.equal(rows(body)[0].kind, 'workspace')
  } finally {
    workspaces.delete(blank)
    rmSync(blank, { recursive: true, force: true })
  }
})
