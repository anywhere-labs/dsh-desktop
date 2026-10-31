/**
 * dsh-ide-git — host half (plain JavaScript, no build step).
 *
 * One HTTP surface backs the browser panel:
 *
 *   POST /dsh-ide-git/api/<method>   -> { ok: true, data } | { ok: false, error }
 *
 * Every method is a thin, argv-array wrapper around the local `git` binary
 * (never a shell string), executed within a registered workspace. Read methods
 * are cheap; write methods are explicit, and destructive ones require
 * `confirm: true` from the caller.
 *
 * Trust fence: every route uses the Host connection's requestRejection and
 * resolves paths against a selected, live Workspace grant before running git.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const name = 'dsh-ide-git'
export const inject = ['webServer', 'connection', 'workspaceRegistry']

/* Row Config = the plugin's settings surface on dsh >= 0.1.7: the host persists
   these values under the loader row id ('ide-git', see cordis.patch.yml) and the
   browser reads them through ctx.configForms, so the settings card on the
   plugin's page and the action rail read ONE document. The rail's edit is one
   switch per action (`railRefresh` … `railPush`); a missing field means "default"
   (the action is shown), which is what keeps an action added by a later version
   visible on an older profile.
   `@deepseek-ai/schemastery` is resolved LAZILY: it is a host-provided module
   (every sibling plugin declares its row Config the same way), and on a host that
   cannot resolve it the row config is passed through unvalidated instead of the
   whole row disappearing — so the browser keeps its localStorage home there. */
let Schema = null
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch (error) {
  console.warn('[dsh-ide-git] @deepseek-ai/schemastery is not resolvable here; the row Config surface is absent'
    + ' (the browser falls back to its localStorage rail config): ' + (error && error.message ? error.message : String(error)))
}

/** Rail action ids, in rail order. MUST mirror RAIL_SPECS in src/client.js. */
const RAIL_CONFIG_IDS = [
  'refresh', 'tree', 'float', 'split', 'fullscreen', 'newBranch', 'checkout', 'delete',
  'compare', 'diff', 'stash', 'tag', 'favorite', 'fetch', 'pull', 'push',
]

/** Volatile refs (dsh >= 0.1.7 settings contract) or plain values on older hosts. */
function live(schema) {
  return typeof schema.volatile === 'function' ? schema.volatile() : schema
}

function railConfigSchema(schema) {
  const shape = {}
  for (const id of RAIL_CONFIG_IDS) {
    shape['rail' + id.charAt(0).toUpperCase() + id.slice(1)] = live(schema.boolean().default(true))
  }
  /* AI commit message (issue #6), the three settings the user asked for. Empty
     string means "follow whatever the session is using" / "no extra prompt", so
     an untouched profile behaves exactly like the feature's default. */
  shape.commitModel = live(schema.string().default(''))
  shape.commitReasoning = live(schema.string().default(''))
  shape.commitPrompt = live(schema.string().default(''))
  /* Conversation-area view tab (issue #8): on by default, switchable off from
     the plugin settings card. false means "do not register the
     conversation.view seat at all" — the sidebar and dock seats are not
     affected; a missing field means the default (shown). */
  shape.conversationTab = live(schema.boolean().default(true))
  /* Immersive conversation seat (issue #8 round 3): on by default. false means
     the seat falls back to the pin-to-scrollport layout with a visible
     composer; a missing field means the default (on). NOTE: the field MUST be
     declared here — the Host rejects row-Config writes for paths the schema
     does not mark volatile ("Config field … is not volatile"), and the settings
     switch then rolls back silently. */
  shape.immersive = live(schema.boolean().default(true))
  /* Panel font scale (appearance group): percent, 100 = default; the client
     clamps to 80–160 in steps of 10. Same volatility rule as `immersive` —
     undeclared, the Host would reject the settings card's writes. */
  shape.fontScale = live(schema.number().default(100))
  return schema.object(shape)
}

export const Config = Schema === null ? undefined : railConfigSchema(Schema)

const ROUTE_PREFIX = '/dsh-ide-git/api'
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/* Ring buffer of the most recent git runs — the panel's "Git output" view
   (VS Code's scm showOutput equivalent). Bounded on both axes: entries and
   per-entry text, so a hostile `log -p` cannot grow it without limit. */
const GIT_LOG_MAX_ENTRIES = 200
const GIT_LOG_TEXT_MAX = 4000
const gitLog = []
function pushGitLog(entry) {
  gitLog.push(entry)
  if (gitLog.length > GIT_LOG_MAX_ENTRIES) gitLog.splice(0, gitLog.length - GIT_LOG_MAX_ENTRIES)
}
function clipGitLogText(text) {
  if (typeof text !== 'string' || text.length <= GIT_LOG_TEXT_MAX) return text
  return text.slice(0, GIT_LOG_TEXT_MAX / 2) + '\n…[' + String(text.length - GIT_LOG_TEXT_MAX) + ' more chars]…\n' + text.slice(-GIT_LOG_TEXT_MAX / 2)
}
const MAX_DIFF_CHARS = 400 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 180_000
const RECORD_SEP = '\u001e'
const FIELD_SEP = '\u001f'

/* ============================== errors ============================== */

class PanelError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function badRequest(message) {
  return new PanelError('bad-request', message, 400)
}

/* ============================== argv git ============================== */

function gitBinary() {
  const override = process.env.DSH_IDE_GIT_BIN
  return override !== undefined && override.trim() !== '' ? override.trim() : 'git'
}

/**
 * Run git with an argv array (no shell). Resolves for ANY exit code so callers
 * can decide whether a non-zero status is data (e.g. `git diff --quiet`) or an
 * error; `git()` below is the throwing form.
 */
function runGit(cwd, args, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(gitBinary(), args, { cwd, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
    } catch (error) {
      reject(new PanelError('git-missing', 'cannot start git: ' + messageOf(error), 500))
      return
    }
    const out = []
    const err = []
    let outBytes = 0
    let errBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      pushGitLog({ at: new Date(startedAt).toISOString(), argv: args.join(' '), code: 'timeout', ms: timeoutMs, out: '', err: 'timed out after ' + String(timeoutMs) + 'ms' })
      reject(new PanelError('git-timeout', 'git ' + args[0] + ' timed out after ' + timeoutMs + 'ms', 504))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length
      if (outBytes <= MAX_OUTPUT_BYTES) out.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      errBytes += chunk.length
      if (errBytes <= MAX_OUTPUT_BYTES) err.push(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new PanelError('git-missing', 'cannot run git: ' + messageOf(error), 500))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pushGitLog({
        at: new Date(startedAt).toISOString(),
        argv: args.join(' '),
        code: code === null ? -1 : code,
        ms: Date.now() - startedAt,
        out: clipGitLogText(Buffer.concat(out).toString('utf8')),
        err: clipGitLogText(Buffer.concat(err).toString('utf8')),
      })
      resolve({
        code: code === null ? -1 : code,
        signal: signal === null ? undefined : signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated: outBytes > MAX_OUTPUT_BYTES,
      })
    })
  })
}

async function git(cwd, args, options = {}) {
  const result = await runGit(cwd, args, options)
  if (result.code !== 0) {
    const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()
    throw new PanelError('git-failed', 'git ' + args.join(' ') + ' failed: ' + (detail === '' ? 'exit ' + result.code : detail), 409)
  }
  return result.stdout
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/* ============================== payload helpers ============================== */

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  if (!path.isAbsolute(value)) throw badRequest(label + ' must be an absolute path')
  return path.resolve(value)
}

/** A ref/branch/tag name: no whitespace, no leading dash, no control characters. */
function requireRef(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  const name = value.trim()
  if (name.startsWith('-')) throw badRequest(label + ' must not start with "-"')
  if (/[\u0000-\u001f\u007f\s]/.test(name)) throw badRequest(label + ' contains invalid characters')
  return name
}

function optionalRevs(value, label) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw badRequest(label + ' must be an array')
  return value.map((entry) => requireRef(entry, label + ' entry'))
}

function requireMessage(value) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest('message is required')
  return value
}

function cwdOf(payload) {
  return requireAbsolute(payload === undefined ? undefined : payload.cwd, 'cwd')
}

/** A path is inside a selected grant only after both sides are resolved. */
function inside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}

function canonical(value, label) {
  const absolute = requireAbsolute(value, label)
  try { return realpathSync(absolute) }
  catch { throw badRequest(label + ' must exist') }
}

function registeredPrimaries(ctx) {
  return ctx.workspaceRegistry.list().map((entry) => {
    try {
      const root = realpathSync(entry.path)
      return root === entry.path ? root : null
    } catch { return null }
  }).filter((root) => root !== null)
}

function sourceRootService(ctx) {
  return ctx.reflect?.get('desktopGitSourceRoots')
}

/** A grant is valid only while its primary remains registered and the Desktop
 * source association still resolves to the same canonical directory. Never
 * infer a grant from some other workspace's attached roots or from the Files
 * panel's independent selected-root preference. */
function grantFor(ctx, cwd) {
  const service = sourceRootService(ctx)
  const grants = []
  for (const primary of registeredPrimaries(ctx)) {
    if (inside(primary, cwd)) grants.push({ primary, root: primary })
    if (service === undefined) continue
    // Do not turn a broken association store into a primary-only fallback.
    let attached
    try { attached = service.attachedRoots(primary) }
    catch { throw new PanelError('forbidden', 'workspace source roots are unavailable', 403) }
    if (!Array.isArray(attached)) throw new PanelError('forbidden', 'workspace source roots are unavailable', 403)
    for (const stored of attached) {
      // The Desktop registry returns canonical paths. A replaced source symlink
      // cannot silently transfer its grant even if another directory exists.
      if (typeof stored !== 'string' || !path.isAbsolute(stored)) continue
      let root
      try { root = realpathSync(stored) } catch { continue }
      if (root !== stored || !inside(root, cwd)) continue
      grants.push({ primary, root })
    }
  }
  grants.sort((a, b) => b.root.length - a.root.length)
  if (grants.length === 0) throw new PanelError('forbidden', 'path is outside registered workspaces', 403)
  return grants[0]
}

function requireInside(root, target) {
  if (!inside(root, target)) throw new PanelError('forbidden', 'path is outside the selected source root', 403)
  return target
}

function roots(payload) {
  return { workspace: payload.workspaceRoot, roots: payload.sourceRoots }
}

/** Validate the actual git root, not just a caller-supplied directory name. */
async function scopedPayload(ctx, method, payload) {
  if (method === 'version' || method === 'commit-models' || method === 'commit-efforts' || method === 'gitLogs') return payload
  const cwd = canonical(payload.cwd, 'cwd')
  if (method === 'roots') {
    const { primary } = grantFor(ctx, cwd)
    const service = sourceRootService(ctx)
    let attached = []
    if (service !== undefined) {
      try { attached = service.attachedRoots(primary) }
      catch { throw new PanelError('forbidden', 'workspace source roots are unavailable', 403) }
      if (!Array.isArray(attached)) throw new PanelError('forbidden', 'workspace source roots are unavailable', 403)
    }
    const live = attached.filter((root) => {
      if (typeof root !== 'string' || !path.isAbsolute(root)) return false
      try { return realpathSync(root) === root && !inside(primary, root) && !inside(root, primary) }
      catch { return false }
    })
    return { ...payload, cwd, workspaceRoot: primary, sourceRoots: [primary, ...live] }
  }
  const { root: workspace } = grantFor(ctx, cwd)
  const scoped = { ...payload, cwd }
  if (method === 'clone') {
    const dir = requireAbsolute(payload.dir, 'dir')
    const parent = requireInside(workspace, canonical(path.dirname(dir), 'clone parent'))
    const target = path.join(parent, path.basename(dir))
    // Git may accept an existing empty directory; never follow a final symlink.
    if (existsSync(target) || isSymbolicLink(target)) {
      requireInside(workspace, canonical(target, 'dir'))
      if (isSymbolicLink(target)) throw badRequest('dir must not be a symbolic link')
    }
    if (target === workspace) throw badRequest('dir must not be the workspace root')
    scoped.dir = target
    return scoped
  }
  if (method === 'repos') {
    scoped.workspaceRoot = workspace
    const top = await runGit(cwd, ['rev-parse', '--show-toplevel'])
    if (top.code === 0) requireInside(workspace, canonical(top.stdout.trim(), 'repoRoot'))
    return scoped
  }
  const selected = payload.repoRoot === undefined ? cwd : canonical(payload.repoRoot, 'repoRoot')
  requireInside(workspace, selected)
  const top = await runGit(selected, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) {
    if (payload.repoRoot !== undefined) throw badRequest('repoRoot must be a repository')
    // Preserve the existing not-a-repo response for container workspaces.
    return scoped
  }
  const root = requireInside(workspace, canonical(top.stdout.trim(), 'repoRoot'))
  if (payload.repoRoot !== undefined && selected !== root) throw badRequest('repoRoot must be a repository root')
  scoped.repoRoot = root
  return scoped
}

function isSymbolicLink(target) {
  try { return lstatSync(target).isSymbolicLink() } catch { return false }
}

/* ============================== git reads ============================== */

async function repoRootOf(cwd, payload) {
  /* Normalize the separator: `rev-parse --show-toplevel` spells drive paths
     with forward slashes on Windows while path.join produces backslashes, so
     the untracked-diff fence (root + path.sep prefix check) rejected every
     in-repo path there. macOS/Linux are byte-identical no-ops. */
  if (payload !== undefined && payload.repoRoot !== undefined) return path.normalize(requireAbsolute(payload.repoRoot, 'repoRoot'))
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) {
    // A workspace that is not a repository is a normal state, not a failure:
    // the client answers it with a repo picker instead of an error banner.
    throw new PanelError('not-a-repo', 'not a git repository: ' + cwd, 409)
  }
  const top = result.stdout.trim()
  return path.normalize(top === '' ? cwd : top)
}

async function currentBranchOf(root) {
  const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return name
}

async function upstreamOf(root, branch) {
  const result = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', branch + '@{u}'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name === '' ? null : name
}

async function aheadBehindOf(root, upstream, branch) {
  if (upstream === null) return { ahead: 0, behind: 0 }
  const result = await runGit(root, ['rev-list', '--left-right', '--count', upstream + '...' + branch])
  if (result.code !== 0) return { ahead: 0, behind: 0 }
  const parts = result.stdout.trim().split(/\s+/)
  const behind = Number.parseInt(parts[0], 10)
  const ahead = Number.parseInt(parts[1], 10)
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
}

/** Parse `git status --porcelain=v1 -z` (NUL separated, rename pairs follow). */
function parsePorcelain(stdout) {
  const records = stdout.split('\u0000')
  const entries = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) continue
    const x = record[0]
    const y = record[1]
    const filePath = record.slice(3)
    let origPath
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const next = records[index + 1]
      if (next !== undefined && next !== '') {
        origPath = next
        index += 1
      }
    }
    entries.push({ x, y, path: filePath, origPath })
  }
  return entries
}

function classify(entries) {
  const staged = []
  const unstaged = []
  const untracked = []
  const conflicted = []
  for (const entry of entries) {
    const pair = entry.x + entry.y
    if (pair === '??') { untracked.push(entry); continue }
    if (pair === '!!') continue
    if (pair === 'DD' || pair === 'AU' || pair === 'UD' || pair === 'UA' || pair === 'DU' || pair === 'AA' || pair === 'UU') {
      conflicted.push(entry)
      continue
    }
    if (entry.x !== ' ' && entry.x !== '?') staged.push(entry)
    if (entry.y !== ' ' && entry.y !== '?') unstaged.push(entry)
  }
  return { staged, unstaged, untracked, conflicted }
}

/** An ignored tree can be enormous, and this list is informational only. */
const MAX_IGNORED_ENTRIES = 500

/**
 * Ignored paths, asked for on their own. `git status -uall --ignored` expands
 * every file inside an ignored directory — node_modules alone would flood the
 * panel — while `ls-files --directory` reports the directory as a single entry.
 */
async function ignoredEntriesOf(root) {
  const result = await runGit(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
  if (result.code !== 0) return { entries: [], truncated: false }
  const paths = result.stdout.split('\u0000').filter((entry) => entry !== '')
  const kept = paths.slice(0, MAX_IGNORED_ENTRIES)
  return {
    entries: kept.map((filePath) => ({ index: '!', worktree: '!', path: filePath })),
    truncated: paths.length > kept.length,
  }
}

/** `git diff --numstat -z` -> Map(path -> { additions, deletions, binary }). */
async function numstatOf(root, args) {
  const result = await runGit(root, ['diff', '--numstat', '-z', ...args])
  const map = new Map()
  if (result.code !== 0) return map
  const records = result.stdout.split('\u0000')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const addRaw = record.slice(0, firstTab)
    const delRaw = record.slice(firstTab + 1, secondTab)
    let filePath = record.slice(secondTab + 1)
    if (filePath === '') {
      filePath = records[index + 1] === undefined ? '' : records[index + 1]
      index += 1
      const renamed = records[index + 1]
      if (renamed !== undefined && renamed !== '') index += 1
    }
    const binary = addRaw === '-' || delRaw === '-'
    map.set(filePath, {
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    })
  }
  return map
}

function decorate(entries, numstat) {
  return entries.map((entry) => {
    const stat = numstat.get(entry.path)
    return {
      path: entry.path,
      origPath: entry.origPath,
      index: entry.x,
      worktree: entry.y,
      additions: stat === undefined ? 0 : stat.additions,
      deletions: stat === undefined ? 0 : stat.deletions,
      binary: stat === undefined ? false : stat.binary,
    }
  })
}

/** Parse the FIELD_SEP/RECORD_SEP pretty format used by `log`/`show`. */
function parseLog(stdout) {
  const commits = []
  for (const record of stdout.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    if (parts.length < 8) continue
    commits.push({
      hash: parts[0],
      shortHash: parts[1],
      parents: parts[2].trim() === '' ? [] : parts[2].trim().split(' '),
      author: parts[3],
      email: parts[4],
      date: parts[5],
      subject: parts[6],
      refs: parts[7].trim() === '' ? [] : parts[7].split(',').map((ref) => ref.trim()).filter((ref) => ref !== ''),
    })
  }
  return commits
}

const LOG_FORMAT = '%H' + FIELD_SEP + '%h' + FIELD_SEP + '%P' + FIELD_SEP + '%an' + FIELD_SEP + '%ae' + FIELD_SEP + '%aI' + FIELD_SEP + '%s' + FIELD_SEP + '%D' + RECORD_SEP

async function stashCountOf(root) {
  const result = await runGit(root, ['rev-list', '--walk-reflogs', '--count', 'refs/stash'])
  if (result.code !== 0) return 0
  const count = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(count) ? count : 0
}

/** Same directory, tolerating a trailing slash and macOS /var vs /private/var. */
function sameDirectory(left, right) {
  const one = path.resolve(String(left))
  const two = path.resolve(String(right))
  if (one === two) return true
  try { return realpathSync(one) === realpathSync(two) } catch { return false }
}

async function worktreesOf(root) {
  const result = await runGit(root, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) return []
  const trees = []
  let current = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current !== null) trees.push(current)
      current = { path: line.slice('worktree '.length), branch: null, head: null, detached: false, bare: false }
      continue
    }
    if (current === null) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace('refs/heads/', '')
    else if (line === 'detached') current.detached = true
    else if (line === 'bare') current.bare = true
  }
  if (current !== null) trees.push(current)
  return trees
}

/* ============================== safety ============================== */

/**
 * Write operations on one repository run one at a time. The client greys its
 * actions out while a request is in flight, but a stale tab, a second window or
 * a double click could still start two writers, and git dislikes concurrent
 * index writers — so the host serialises writes per repository.
 */
const repoQueues = new Map()

function withRepoLock(key, work) {
  const previous = repoQueues.get(key) === undefined ? Promise.resolve() : repoQueues.get(key)
  const next = previous.then(work, work)
  const settled = next.then(() => undefined, () => undefined)
  repoQueues.set(key, settled)
  settled.then(() => { if (repoQueues.get(key) === settled) repoQueues.delete(key) })
  return next
}

const WRITE_METHODS = new Set([
  'stage', 'unstage', 'discard', 'commit', 'checkout', 'branchCreate', 'branchRename',
  'branchDelete', 'merge', 'rebase', 'cherryPick', 'revert', 'reset', 'fetch', 'pull',
  'push', 'stashPush', 'stashApply', 'stashDrop', 'stashClear', 'tagCreate', 'tagDelete', 'tagDeleteRemote', 'pushTags', 'clone', 'remoteAdd', 'remoteRemove', 'branchDeleteRemote', 'rebaseAbort', 'undoApply',
])

function lockKeyOf(payload) {
  if (typeof payload.repoRoot === 'string' && payload.repoRoot !== '') return payload.repoRoot
  if (typeof payload.cwd === 'string' && payload.cwd !== '') return payload.cwd
  return 'global'
}

/* Deleting is a real delete — but the host remembers how to bring it back for a
   while, so the panel can offer an undo. Entries are per repository, newest
   last, capped and time-limited. */
const UNDO_LIMIT = 20
const UNDO_TTL_MS = 30 * 60 * 1000
const undoStacks = new Map()
let undoSeq = 0

/** Branches whose deletion is never a routine action. */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk'])

function undoEntriesOf(root) {
  const stored = undoStacks.get(root) === undefined ? [] : undoStacks.get(root)
  const alive = stored.filter((entry) => Date.now() - entry.at < UNDO_TTL_MS)
  if (alive.length !== stored.length) undoStacks.set(root, alive)
  return alive
}

function pushUndo(root, entry) {
  const list = undoEntriesOf(root)
  undoSeq += 1
  const record = Object.assign({ id: 'u' + undoSeq.toString(36) + Date.now().toString(36), at: Date.now() }, entry)
  list.push(record)
  while (list.length > UNDO_LIMIT) list.shift()
  undoStacks.set(root, list)
  return { id: record.id, kind: record.kind, label: record.label }
}

/* Undoing a discard means writing the old bytes back, so the host has to keep
   them: a checkout/clean is the one moment they still exist. Snapshots stay
   deliberately conservative — regular files only, capped in count and in total
   size — and anything that cannot be reproduced faithfully (a symlink, a
   special file, a huge tree) yields NO undo handle at all rather than a promise
   the host cannot keep. */
const UNDO_MAX_FILES = 400
const UNDO_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

function hashOf(data) {
  return createHash('sha1').update(data).digest('hex')
}

/** Repo-relative POSIX path of a target, or null when it escapes the repo. */
function relInside(root, target) {
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/**
 * Read every regular file the given paths cover (each path may be a file or a
 * directory). Returns null when the snapshot would not be faithful, which makes
 * the caller skip the undo handle instead of offering one it cannot honour.
 */
function snapshotForUndo(root, paths) {
  const files = []
  let bytes = 0
  const collect = (target) => {
    const rel = relInside(root, target)
    if (rel === null) return true
    let stat
    try {
      stat = lstatSync(target)
    } catch (error) {
      // Already gone ('D' in the working tree) is itself a state worth undoing
      // to, so record the absence. Any other failure is not ours to guess at.
      if (error.code === 'ENOENT') { files.push({ rel: rel, data: null }); return true }
      return false
    }
    if (stat.isSymbolicLink()) return false
    if (stat.isDirectory()) {
      if (path.basename(target) === '.git') return true
      let names
      try { names = readdirSync(target) } catch { return false }
      for (const name of names) if (!collect(path.join(target, name))) return false
      return true
    }
    if (!stat.isFile()) return false
    if (files.length >= UNDO_MAX_FILES) return false
    let data
    try { data = readFileSync(target) } catch { return false }
    bytes += data.length
    if (bytes > UNDO_MAX_SNAPSHOT_BYTES) return false
    files.push({ rel: rel, data: data })
    return true
  }
  for (const entry of paths) if (!collect(path.resolve(root, entry))) return null
  return files
}

/**
 * The shape the snapshot targets have right now: a content hash, or null when
 * the path is absent. The undo compares against this before writing anything,
 * so content typed after the discard is never silently overwritten.
 */
function snapshotState(root, files) {
  return files.map((file) => {
    try {
      return { rel: file.rel, hash: hashOf(readFileSync(path.join(root, file.rel))) }
    } catch {
      return { rel: file.rel, hash: null }
    }
  })
}

/** .git markers that mean a multi-step operation is still in progress. */
async function operationOf(root) {
  const result = await runGit(root, ['rev-parse', '--absolute-git-dir'])
  if (result.code !== 0) return null
  const gitDir = result.stdout.trim()
  if (gitDir === '') return null
  const markers = [
    ['merge', 'MERGE_HEAD'],
    ['rebase', 'rebase-merge'],
    ['rebase', 'rebase-apply'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['revert', 'REVERT_HEAD'],
    ['bisect', 'BISECT_LOG'],
  ]
  for (const marker of markers) {
    if (existsSync(path.join(gitDir, marker[1]))) return marker[0]
  }
  return null
}

/* ============================== methods ============================== */

async function summary(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Two-phase changes (issue #11): with `stats: false` the two `diff
     --numstat` passes — the most expensive step once a tree holds thousands
     of changes — are skipped, `statsDeferred: true` announces that the +/-
     numbers arrive through the `stats` method instead. The rows themselves
     are complete without them; nothing is truncated. */
  const deferStats = payload.stats === false
  /* The branch chain (branch → upstream → ahead/behind) is sequential by
     necessity; everything else is independent and runs concurrently, so a
     large `status` scan no longer serialises behind five cheap calls
     (issue #11: the sum of ~ten sequential commands became the max of two
     chains). */
  const [branchInfo, statusOut, unstagedStat, stagedStat, ignored, stashCount, worktrees, operation] = await Promise.all([
    (async () => {
      const branch = await currentBranchOf(root)
      const detached = branch === 'HEAD'
      const upstream = detached ? null : await upstreamOf(root, branch)
      const tracking = upstream === null ? { ahead: 0, behind: 0 } : await aheadBehindOf(root, upstream, branch)
      return { branch, detached, upstream, tracking }
    })(),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    deferStats ? Promise.resolve(new Map()) : numstatOf(root, []),
    deferStats ? Promise.resolve(new Map()) : numstatOf(root, ['--cached']),
    payload.ignored === true ? ignoredEntriesOf(root) : { entries: [], truncated: false },
    stashCountOf(root),
    worktreesOf(root),
    operationOf(root),
  ])
  const groups = classify(parsePorcelain(statusOut))
  return {
    repoRoot: root,
    cwd,
    branch: branchInfo.branch,
    detached: branchInfo.detached,
    upstream: branchInfo.upstream,
    ahead: branchInfo.tracking.ahead,
    behind: branchInfo.tracking.behind,
    changes: {
      staged: decorate(groups.staged, stagedStat),
      unstaged: decorate(groups.unstaged, unstagedStat),
      untracked: decorate(groups.untracked, new Map()),
      conflicted: decorate(groups.conflicted, new Map()),
      ignored: ignored.entries,
      ignoredTruncated: ignored.truncated,
    },
    statsDeferred: deferStats === true,
    stashCount: stashCount,
    worktrees: worktrees,
    operation: operation,
  }
}

/* The second phase of the two-phase changes (issue #11): the two numstat
   passes, concurrent, packed as [path, additions, deletions, binary] rows so
   they survive JSON. Paths are post-rename paths — exactly what `summary`
   decorates its entries with. Read-only: deliberately not in WRITE_METHODS. */
async function stats(payload) {
  const root = await repoRootOf(cwdOf(payload), payload)
  const [unstaged, staged] = await Promise.all([
    numstatOf(root, []),
    numstatOf(root, ['--cached']),
  ])
  const pack = (map) => {
    const rows = []
    for (const [path, stat] of map) rows.push([path, stat.additions, stat.deletions, stat.binary === true])
    return rows
  }
  return { unstaged: pack(unstaged), staged: pack(staged) }
}

async function branches(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const branch = await currentBranchOf(root)
  const format = ['%(refname)', '%(refname:short)', '%(objectname)', '%(objectname:short)', '%(HEAD)', '%(upstream:short)', '%(committerdate:iso-strict)', '%(contents:subject)', '%(symref)'].join(FIELD_SEP)
  const out = await git(root, ['for-each-ref', '--format=' + format + RECORD_SEP, 'refs/heads', 'refs/remotes', 'refs/tags'])
  const local = []
  const remote = []
  const tags = []
  const worktrees = await worktreesOf(root)
  const busy = new Map()
  for (const tree of worktrees) {
    if (tree.branch === null || tree.branch === '') continue
    // `git worktree list` includes the checkout this repository lives in, so
    // without this the CURRENT branch was flagged as occupied by its own working
    // tree (reported on v0.3.11: main showed the marker while checked out here).
    // Only a SECOND working tree holding a branch blocks checking it out here.
    if (sameDirectory(tree.path, root)) continue
    busy.set(tree.branch, tree.path)
  }
  for (const record of out.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    if (parts.length < 9) continue
    const entry = {
      name: parts[1],
      hash: parts[2],
      shortHash: parts[3],
      head: parts[4] === '*',
      upstream: parts[5] === '' ? null : parts[5],
      date: parts[6],
      subject: parts[7],
      worktree: busy.get(parts[1]) === undefined ? null : busy.get(parts[1]),
      ahead: 0,
      behind: 0,
    }
    if (parts[0].startsWith('refs/heads/')) local.push(entry)
    else if (parts[0].startsWith('refs/remotes/')) remote.push(entry)
    else if (parts[0].startsWith('refs/tags/')) tags.push({ name: entry.name, hash: entry.hash, shortHash: entry.shortHash, date: entry.date, subject: entry.subject })
  }
  for (const entry of local) {
    if (entry.upstream === null) continue
    const tracking = await aheadBehindOf(root, entry.upstream, entry.name)
    entry.ahead = tracking.ahead
    entry.behind = tracking.behind
  }
  local.sort((a, b) => (a.head === b.head ? a.name.localeCompare(b.name) : a.head ? -1 : 1))
  remote.sort((a, b) => a.name.localeCompare(b.name))
  tags.sort((a, b) => a.name.localeCompare(b.name))
  const remotesOut = await runGit(root, ['remote'])
  const remotes = remotesOut.code === 0 ? remotesOut.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') : []
  return { repoRoot: root, branch, local, remote, tags, remotes }
}

async function log(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const limit = clampInt(payload.limit, 1, 500, 100)
  const skip = clampInt(payload.skip, 0, 1_000_000, 0)
  const args = ['log', '--max-count=' + (limit + 1), '--skip=' + skip, '--date-order', '--pretty=format:' + LOG_FORMAT]
  if (typeof payload.rev === 'string' && payload.rev.trim() !== '') args.push(requireRef(payload.rev, 'rev'))
  if (typeof payload.path === 'string' && payload.path.trim() !== '') args.push('--', payload.path)
  const out = await git(root, args)
  const all = parseLog(out)
  const hasMore = all.length > limit
  return { repoRoot: root, commits: hasMore ? all.slice(0, limit) : all, hasMore, skip, limit }
}

async function commitDetail(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const metaFormat = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%b', '%D'].join(FIELD_SEP)
  const metaOut = await git(root, ['show', '-s', '--format=' + metaFormat, hash])
  const parts = metaOut.trim().split(FIELD_SEP)
  const parents = parts[2] === undefined || parts[2].trim() === '' ? [] : parts[2].trim().split(' ')
  const numstatOut = await git(root, ['show', '--numstat', '-z', '--format=', '-m', '--first-parent', hash])
  const files = []
  const records = numstatOut.split('\u0000')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    let filePath = record.slice(secondTab + 1)
    let origPath
    if (filePath === '') {
      origPath = records[index + 1]
      filePath = records[index + 2]
      index += 2
    }
    const addRaw = record.slice(0, firstTab)
    const delRaw = record.slice(firstTab + 1, secondTab)
    const binary = addRaw === '-' || delRaw === '-'
    files.push({
      path: filePath === undefined ? '' : filePath,
      origPath: origPath === undefined || origPath === '' ? undefined : origPath,
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    })
  }
  return {
    hash: parts[0],
    shortHash: parts[1],
    parents,
    author: parts[3],
    email: parts[4],
    date: parts[5],
    subject: parts[6],
    body: parts[7] === undefined ? '' : parts[7],
    refs: parts[8] === undefined || parts[8].trim() === '' ? [] : parts[8].split(',').map((ref) => ref.trim()).filter((ref) => ref !== ''),
    files,
  }
}

async function diff(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Untracked files have no index entry, so plain `git diff [--cached] -- path`
     is legitimately empty for them — the panel's change list still shows the
     file and the preview must not go blank. `--no-index /dev/null <file>`
     produces the honest "new file" patch; its exit code is 1 when differences
     exist, which is data, not failure (only >1 rejects). */
  if (payload.untracked === true) {
    const rel = requireRelativePath(payload.path)
    const absolute = path.isAbsolute(rel) ? rel : path.join(root, rel)
    /* --no-index reads the file for real, so unlike the plain `git diff --`
       form an absolute path must NOT be allowed to escape the repository. */
    if (!inside(root, absolute)) throw badRequest('path must stay inside the repository')
    try {
      if (!inside(realpathSync(root), realpathSync(absolute))) throw badRequest('path must stay inside the repository')
    } catch (error) {
      if (error instanceof PanelError) throw error
      throw badRequest('path must exist inside the repository')
    }
    /* git quotes and C-escapes backslash paths inside the diff header (and
       git ≥2.55 spells the a/ side with the real path instead of /dev/null);
       passing forward slashes keeps the header unquoted, so the rewrite below
       can match it verbatim. POSIX is a no-op. */
    const headerPath = absolute.split(path.sep).join('/')
    const result = await runGit(root, ['diff', '--no-color', '--no-ext-diff', '-U3', '--no-index', '--', '/dev/null', headerPath])
    if (result.code !== 0 && result.code !== 1) {
      const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()
      throw new PanelError('git-failed', 'git diff --no-index failed: ' + (detail === '' ? 'exit ' + result.code : detail), 409)
    }
    /* --no-index spells the b/ side with the absolute path we passed; rewrite
       the header lines back to the repository-relative spelling so the preview
       reads like every other patch (body lines are left untouched). */
    let out = result.stdout
    if (out.indexOf(headerPath) >= 0 && out.indexOf('\n') !== -1) {
      out = out.split('\n').map((line) => {
        if (line.startsWith('diff --git ') && line.indexOf(headerPath) >= 0) return 'diff --git a/' + rel + ' b/' + rel
        /* git ≥2.55 quotes the header and spells the a/ side with the real
           path instead of /dev/null, so match on the path, not the prefix. */
        if (line.startsWith('+++ ') && line.indexOf(headerPath) >= 0) return '+++ b/' + rel
        return line
      }).join('\n')
    }
    const truncated = out.length > MAX_DIFF_CHARS
    return { patch: truncated ? out.slice(0, MAX_DIFF_CHARS) : out, truncated }
  }
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3']
  if (payload.staged === true) args.push('--cached')
  if (typeof payload.hash === 'string' && payload.hash.trim() !== '') {
    args.length = 0
    args.push('show', '--no-color', '--no-ext-diff', '-U3', '--format=', requireRef(payload.hash, 'hash'))
  }
  if (typeof payload.path === 'string' && payload.path.trim() !== '') args.push('--', requireRelativePath(payload.path))
  const out = await git(root, args)
  const truncated = out.length > MAX_DIFF_CHARS
  return { patch: truncated ? out.slice(0, MAX_DIFF_CHARS) : out, truncated }
}

function requireRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest('path is required')
  const trimmed = value.trim()
  if (path.isAbsolute(trimmed) || trimmed.split(/[\\/]/).includes('..')) throw badRequest('path must stay inside the repository')
  return trimmed
}

async function stage(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const paths = optionalPaths(payload, 'paths')
  await git(root, ['add', '-A', '--', ...paths])
  return { staged: paths.length }
}

async function unstage(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const paths = optionalPaths(payload, 'paths')
  const result = await runGit(root, ['reset', '-q', 'HEAD', '--', ...paths])
  if (result.code !== 0) await git(root, ['rm', '--cached', '-r', '-q', '--', ...paths])
  return { unstaged: paths.length }
}

async function discard(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  // '.' would discard EVERYTHING in the repository in one go; the panel always
  // discards explicit paths, so the root itself is not a valid target here.
  const paths = optionalPaths(payload, 'paths').filter((entry) => entry !== '.' && entry !== './')
  if (paths.length === 0) throw badRequest('paths is required')
  const untracked = payload.untracked === true
  if (untracked && payload.confirm !== true) throw badRequest('discarding untracked files requires confirm: true')
  // Last chance to keep the bytes: the checkout/clean below is what destroys them.
  const files = snapshotForUndo(root, paths)
  if (untracked) await git(root, ['clean', '-f', '-d', '--', ...paths])
  else await git(root, ['checkout', '--', ...paths])
  // A snapshot the host cannot reproduce faithfully means no handle at all — the
  // panel says so instead of showing an undo that would fail later.
  if (files === null) return { discarded: paths.length, untracked: untracked, undoBlocked: true }
  const label = paths.length === 1 ? paths[0] : paths.length + ' paths'
  const undo = pushUndo(root, { kind: 'discard', label: label, files: files, after: snapshotState(root, files) })
  return { discarded: paths.length, untracked: untracked, undo: undo }
}

async function commit(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const message = requireMessage(payload.message)
  const paths = (payload.paths === undefined || payload.paths === null) ? [] : optionalPaths(payload, 'paths')
  if (paths.length > 0) await git(root, ['add', '-A', '--', ...paths])
  const args = ['commit', '-m', message]
  if (payload.amend === true) args.push('--amend')
  if (payload.signoff === true) args.push('--signoff')
  const out = await git(root, args)
  const result = { output: out.trim() }
  if (payload.push === true) {
    // Commit-and-push is one gesture in the panel, so the commit is published in
    // the same request. A failed push must not hide the commit that did land.
    if (payload.confirm !== true) throw badRequest('pushing requires confirm: true')
    const pushed = await runGit(root, ['push'])
    result.pushed = pushed.code === 0
    if (pushed.code !== 0) result.pushError = (pushed.stderr.trim() || pushed.stdout.trim() || 'push failed')
  }
  return result
}

async function checkout(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.create === true) {
    const name = requireRef(payload.branch, 'branch')
    const start = typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '' ? requireRef(payload.startPoint, 'startPoint') : undefined
    const args = ['checkout', '-b', name]
    if (start !== undefined) args.push(start)
    await git(root, args)
    return { branch: name, created: true }
  }
  const target = requireRef(payload.branch, 'branch')
  await git(root, ['checkout', target])
  return { branch: target, created: false }
}

async function branchCreate(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  const args = ['branch', name]
  if (typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '') args.push(requireRef(payload.startPoint, 'startPoint'))
  await git(root, args)
  return { branch: name }
}

async function branchRename(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const from = requireRef(payload.from, 'from')
  const to = requireRef(payload.to, 'to')
  await git(root, ['branch', '-m', from, to])
  return { from, to }
}

async function branchDelete(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const force = payload.force === true
  if (force && payload.confirm !== true) throw badRequest('force delete requires confirm: true')
  /* Batch form (multi-select): `names` wins when present; the single `name`
     keeps working exactly as before. Every name goes through the same ref
     guard — an array never bypasses validation. */
  const names = Array.isArray(payload.names)
    ? payload.names.map((entry) => requireRef(entry, 'name'))
    : [requireRef(payload.name, 'name')]
  const current = await currentBranchOf(root)
  for (const name of names) {
    if (name === current) throw new PanelError('protected-branch', 'refusing to delete the checked-out branch "' + name + '"', 409)
    if (PROTECTED_BRANCHES.has(name) && payload.confirm !== true) throw badRequest('deleting "' + name + '" requires confirm: true')
  }
  const branches = []
  for (const name of names) {
    const head = (await git(root, ['rev-parse', '--verify', 'refs/heads/' + name])).trim()
    branches.push({ name: name, hash: head })
  }
  // -d (the default) refuses to drop an unmerged branch: git is the guard here.
  await git(root, ['branch', force ? '-D' : '-d', ...names])
  const label = names.length === 1 ? names[0] : names.length + ' branches'
  const undo = pushUndo(root, {
    kind: 'branch-delete', label: label,
    branches: branches,
    // Legacy single-branch fields stay so an in-flight old handle keeps working.
    name: names[0], hash: branches[0].hash,
  })
  return { branch: names[0], hash: branches[0].hash, names: names, branches: branches, force: force, undo: undo }
}

async function merge(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const branch = requireRef(payload.branch, 'branch')
  const args = ['merge', '--no-edit']
  if (payload.ffOnly === true) args.push('--ff-only')
  if (payload.noFf === true) args.push('--no-ff')
  if (payload.squash === true) args.push('--squash')
  args.push(branch)
  const result = await runGit(root, args)
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT|Automatic merge failed/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'merge failed' : combined, 409)
  return { branch, conflicted, output: combined }
}

async function rebase(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const onto = requireRef(payload.onto, 'onto')
  const result = await runGit(root, ['rebase', onto])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT|could not apply/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'rebase failed' : combined, 409)
  return { onto, conflicted, output: combined }
}

/* VS Code's "Abort Rebase" (SCM ▸ Commit ▸ Abort Rebase). Only meaningful
   while a rebase is in progress — `operationOf` already surfaces that state,
   so the menu greys the entry out; the route still refuses honestly when
   there is nothing to abort. */
async function rebaseAbort(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const result = await runGit(root, ['rebase', '--abort'])
  if (result.code !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()
    throw new PanelError('git-failed', detail === '' ? 'no rebase to abort' : detail, 409)
  }
  return { output: (result.stdout + '\n' + result.stderr).trim() }
}

/* VS Code's SCM ▸ Remote ▸ Add Remote.... The name is a ref, the URL the same
   grammar `clone` already accepts. */
async function remoteAdd(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  const url = requireUrl(payload.url, 'url')
  await git(root, ['remote', 'add', name, url])
  return { name, url }
}

async function remoteRemove(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  if (typeof payload.confirm !== 'boolean' || payload.confirm !== true) throw badRequest('removing a remote requires confirm: true')
  await git(root, ['remote', 'remove', name])
  return { name }
}

/* SCM ▸ Branch ▸ Delete Remote Branch...: `git push <remote> --delete <branch>`.
   Genuinely destructive on the OTHER side, so it keeps the typed-confirm
   posture of a local protected-branch delete: confirm is mandatory. */
async function branchDeleteRemote(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const remote = requireRef(payload.remote, 'remote')
  /* Batch form (multi-select): `branches` wins; the single `branch` keeps
     working. `git push --delete` accepts several names in one go. */
  const branches = Array.isArray(payload.branches)
    ? payload.branches.map((entry) => requireRef(entry, 'branch'))
    : [requireRef(payload.branch, 'branch')]
  if (payload.confirm !== true) throw badRequest('deleting a remote branch requires confirm: true')
  const out = await git(root, ['push', remote, '--delete', ...branches], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { remote: remote, branch: branches[0], branches: branches, output: out.trim() }
}

/* SCM ▸ Tags ▸ Delete Remote Tag... / Push Tags. */
async function tagDeleteRemote(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const remote = requireRef(payload.remote, 'remote')
  const tag = requireRef(payload.name, 'name')
  if (payload.confirm !== true) throw badRequest('deleting a remote tag requires confirm: true')
  const out = await git(root, ['push', remote, '--delete', tag], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { remote, tag, output: out.trim() }
}

async function pushTags(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('pushing tags requires confirm: true')
  const remote = typeof payload.remote === 'string' && payload.remote.trim() !== '' ? requireRef(payload.remote, 'remote') : 'origin'
  const out = await git(root, ['push', remote, '--tags'], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: out.trim() }
}

/* SCM ▸ Stash ▸ Drop All Stashes...: one `git stash clear`. No undo handle is
   possible (the stash reflog is gone with the clear), hence the mandatory
   confirm on top of the dialog. */
async function stashClear(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('dropping all stashes requires confirm: true')
  await git(root, ['stash', 'clear'])
  return { cleared: true }
}

async function cherryPick(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Batch form (multi-select): `hashes` are applied in the order given — the
     client sends them oldest-first so the sequence replays topologically. The
     single `hash` keeps working. */
  const hashes = Array.isArray(payload.hashes)
    ? payload.hashes.map((entry) => requireRef(entry, 'hash'))
    : [requireRef(payload.hash, 'hash')]
  const result = await runGit(root, ['cherry-pick', ...hashes])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'cherry-pick failed' : combined, 409)
  return { hash: hashes[0], hashes: hashes, conflicted: conflicted, output: combined }
}

async function revert(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const result = await runGit(root, ['revert', '--no-edit', hash])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'revert failed' : combined, 409)
  return { hash, conflicted, output: combined }
}

async function reset(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const mode = payload.mode === 'soft' || payload.mode === 'hard' ? payload.mode : 'mixed'
  if (mode === 'hard' && payload.confirm !== true) throw badRequest('hard reset requires confirm: true')
  await git(root, ['reset', '--' + mode, hash])
  return { hash, mode }
}

async function fetch(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const args = ['fetch']
  if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(requireRef(payload.remote, 'remote'))
  if (payload.all === true) args.push('--all')
  if (payload.prune !== false) args.push('--prune')
  args.push('--tags')
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: (out + '\n').trim() }
}

async function pull(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const mode = payload.mode === 'rebase' || payload.mode === 'merge' ? payload.mode : 'ff-only'
  const args = ['pull']
  if (mode === 'ff-only') args.push('--ff-only')
  if (mode === 'rebase') args.push('--rebase')
  if (mode === 'merge') args.push('--no-rebase')
  if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(requireRef(payload.remote, 'remote'))
  if (typeof payload.branch === 'string' && payload.branch.trim() !== '') args.push(requireRef(payload.branch, 'branch'))
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { mode, output: out.trim() }
}

async function push(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('push requires confirm: true')
  const args = ['push']
  if (payload.setUpstream === true) args.push('--set-upstream')
  if (payload.force === true) args.push('--force-with-lease')
  if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(requireRef(payload.remote, 'remote'))
  if (typeof payload.branch === 'string' && payload.branch.trim() !== '') args.push(requireRef(payload.branch, 'branch'))
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: (out + '\n').trim() }
}

async function stashList(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const out = await git(root, ['stash', 'list', '--pretty=format:%gd' + FIELD_SEP + '%gs' + FIELD_SEP + '%aI' + RECORD_SEP])
  const stashes = []
  for (const record of out.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    stashes.push({ ref: parts[0], subject: parts[1] === undefined ? '' : parts[1], date: parts[2] === undefined ? '' : parts[2] })
  }
  return { stashes }
}

async function stashPush(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const args = ['stash', 'push']
  if (payload.includeUntracked === true) args.push('--include-untracked')
  if (payload.staged === true) args.push('--staged')
  if (typeof payload.message === 'string' && payload.message.trim() !== '') args.push('-m', payload.message)
  const out = await git(root, args)
  return { output: out.trim() }
}

async function stashApply(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const ref = typeof payload.ref === 'string' && payload.ref.trim() !== '' ? requireRef(payload.ref, 'ref') : 'stash@{0}'
  const args = ['stash', payload.pop === true ? 'pop' : 'apply', ref]
  const result = await runGit(root, args)
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'stash apply failed' : combined, 409)
  return { ref, conflicted, output: combined }
}

async function stashDrop(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const ref = typeof payload.ref === 'string' && payload.ref.trim() !== '' ? requireRef(payload.ref, 'ref') : 'stash@{0}'
  if (payload.confirm !== true) throw badRequest('dropping a stash requires confirm: true')
  const sha = (await git(root, ['rev-parse', '--verify', ref])).trim()
  await git(root, ['stash', 'drop', ref])
  const undo = pushUndo(root, { kind: 'stash-drop', label: ref, hash: sha })
  return { ref, hash: sha, undo: undo }
}

async function tagCreate(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const tag = requireRef(payload.name, 'name')
  const args = ['tag']
  if (typeof payload.message === 'string' && payload.message.trim() !== '') args.push('-a', tag, '-m', payload.message)
  else args.push(tag)
  if (typeof payload.hash === 'string' && payload.hash.trim() !== '') args.push(requireRef(payload.hash, 'hash'))
  await git(root, args)
  return { tag }
}

async function tagDelete(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Batch form (multi-select): `names` wins; the single `name` keeps working. */
  const names = Array.isArray(payload.names)
    ? payload.names.map((entry) => requireRef(entry, 'name'))
    : [requireRef(payload.name, 'name')]
  await git(root, ['tag', '-d', ...names])
  return { tag: names[0], names: names }
}

/* VS Code's SCM title "Clone..." — clone a URL into an absolute local path.
   The PARENT of the target must exist; git creates the last component itself
   and refuses a non-empty one, which is the safety net for typos. It writes a
   brand-new tree (never touches an existing repository), but it does write the
   filesystem, so it rides the write queue like everything else that mutates. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000
function requireUrl(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  const text = value.trim()
  if (text.startsWith('-') === true || /[\s\u0000-\u001f]/.test(text) === true || text.length > 2048) {
    throw badRequest(label + ' is not a valid repository URL')
  }
  return text
}
async function clone(payload) {
  const url = requireUrl(payload.url, 'url')
  const dir = requireAbsolute(payload.dir, 'dir')
  await git(path.dirname(dir), ['clone', url, dir], { timeoutMs: CLONE_TIMEOUT_MS })
  return { dir }
}

/* The tail of the git run ring buffer (see runGit). Read-only, global. */
async function gitLogs() {
  return { entries: gitLog.slice(-GIT_LOG_MAX_ENTRIES) }
}

/** What this repository can still undo right now (newest last). */
async function undoList(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const items = undoEntriesOf(root).map((entry) => ({ id: entry.id, kind: entry.kind, label: entry.label, at: entry.at }))
  return { items }
}

/**
 * Undo one remembered action. Nothing here is a 'soft delete': the branch (or
 * stash entry) really was gone, and the undo recreates it from the object id
 * recorded before the deletion; a discard really overwrote the working tree,
 * and the undo writes the snapshotted bytes back. It is one-shot and fails
 * loudly when the world moved on — the name is taken again, or the discarded
 * files were edited since.
 */
async function undoApply(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const id = requireRef(payload.id, 'id')
  const list = undoEntriesOf(root)
  const index = list.findIndex((entry) => entry.id === id)
  if (index < 0) throw new PanelError('undo-gone', 'this action can no longer be undone', 409)
  const entry = list[index]
  if (entry.kind === 'branch-delete') {
    /* Batch handles carry `branches: [{name, hash}]`; older single-branch
       handles only have `name`/`hash` — normalise both to one list. */
    const restores = Array.isArray(entry.branches) ? entry.branches : [{ name: entry.name, hash: entry.hash }]
    for (const item of restores) {
      const exists = await runGit(root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + item.name])
      if (exists.code === 0) throw new PanelError('undo-conflict', 'branch "' + item.name + '" already exists again', 409)
      await git(root, ['branch', item.name, item.hash])
    }
  } else if (entry.kind === 'stash-drop') {
    await git(root, ['stash', 'store', '-m', 'dsh-ide-git: restored ' + entry.label, entry.hash])
  } else if (entry.kind === 'discard') {
    // Refuse to trample anything typed since the discard: every target must
    // still look exactly the way the discard left it.
    const now = snapshotState(root, entry.files)
    for (let position = 0; position < now.length; position += 1) {
      if (now[position].hash !== entry.after[position].hash) {
        throw new PanelError('undo-conflict', 'these files changed after the discard', 409)
      }
    }
    // Preflight every target before writing any snapshot bytes: a path may
    // have become a symlink after discard, including an ancestor directory.
    for (const file of entry.files) {
      let ancestor = root
      for (const part of file.rel.split('/')) {
        ancestor = path.join(ancestor, part)
        if (isSymbolicLink(ancestor)) throw new PanelError('undo-conflict', 'undo target is a symbolic link', 409)
      }
    }
    for (const file of entry.files) {
      const target = path.join(root, file.rel)
      if (file.data === null) {
        // The file was absent before the discard: absent is what we restore.
        try { unlinkSync(target) } catch { /* already gone */ }
        continue
      }
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, file.data)
    }
  } else {
    throw new PanelError('undo-unsupported', 'this action cannot be undone', 500)
  }
  list.splice(index, 1)
  undoStacks.set(root, list)
  return { kind: entry.kind, label: entry.label }
}

async function compare(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const base = requireRef(payload.base, 'base')
  const head = requireRef(payload.head, 'head')
  const stat = await git(root, ['diff', '--numstat', '-z', base + '...' + head])
  const files = []
  const records = stat.split('\u0000')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const addRaw = record.slice(0, firstTab)
    const delRaw = record.slice(firstTab + 1, secondTab)
    const binary = addRaw === '-' || delRaw === '-'
    files.push({
      path: record.slice(secondTab + 1),
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    })
  }
  const logOut = await git(root, ['log', '--max-count=100', '--date-order', '--pretty=format:' + LOG_FORMAT, base + '..' + head])
  return { base, head, files, commits: parseLog(logOut) }
}

/** Directories never descended into while looking for repositories. */
const REPO_SCAN_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '.venv', '__pycache__', 'coverage', 'tmp', 'temp'])

/* `git submodule status --recursive` already reports every nesting level of a
   repository in ONE call (paths arrive fully qualified), so the submodule walk
   costs exactly one `status` per checkout; the lists stay bounded so a
   pathological tree cannot flood the picker. */
const SUBMODULE_LIST_LIMIT = 400
const REPO_LIST_LIMIT = 60

/** Slash-normalized path, for comparing paths that came from different
 *  producers (git prints forward slashes; `path.join` prints backslashes on
 *  Windows). Case-insensitive on Windows so the same checkout reached two ways
 *  collapses to one row. */
function pathIdentity(value) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  /* realpath collapses producer spellings of one checkout: git's
   * --show-toplevel resolves symlinks (/private/var on macOS) while a
   * directory walk keeps the spelling it was handed (/var), and without this
   * the same submodule arrived as two rows. An unresolvable path falls back
   * to the slash-normalized form. */
  try {
    return realpathSync(key).replace(/\\/g, '/').replace(/\/+$/, '')
  } catch {
    return key
  }
}

/** One repository row shipped to the client (`kind` drives the picker badge). */
function repoRow(root, submodulePath, kind) {
  return {
    path: root.replace(/\\/g, '/'),
    /** Full checkout name; a submodule carries its repo-relative path so two
     *  same-named checkouts stay apart in a long list. */
    name: submodulePath === undefined ? path.basename(root) : submodulePath,
    label: submodulePath === undefined ? path.basename(root) : submodulePath.split('/').pop(),
    branch: null,
    kind,
    ...(submodulePath === undefined ? {} : { submodulePath }),
  }
}

/**
 * Every checkout registered as a submodule under `root`, at any depth.
 *
 * Git itself is the source of truth: `git submodule status --recursive` lists
 * the registered paths (relative to the parent repository) even for submodules
 * that were never initialised, and `--recursive` walks EVERY nesting level in
 * that one call — deeper entries arrive as fully qualified paths
 * ("outer/inner"), so one `status` per checkout is the whole discovery. (An
 * earlier revision also re-ran `status` inside every confirmed submodule; those
 * calls could only re-list checkouts the recursive pass had already reported,
 * which multiplied the process count on a workspace full of checkouts without
 * producing a single new row.) A path that is present on disk and passes
 * `rev-parse --show-toplevel` is a real, independent working tree — the parent
 * only ever sees it as one gitlink line, so this is what makes it selectable
 * as a repository of its own (the SourceTree behavior).
 *
 * The working-tree checks all run at once, because a repository with a dozen
 * submodules otherwise costs a dozen sequential processes on every scan.
 */
async function collectSubmoduleRepos(root, workspace) {
  const found = []
  const listing = await runGit(root, ['submodule', 'status', '--recursive'])
  if (listing.code !== 0) return found
  const candidates = []
  for (const raw of listing.stdout.split('\n')) {
    if (candidates.length >= SUBMODULE_LIST_LIMIT) break
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    /* `<state><sha> <path> (<describe>)`: the state prefix is ' ', '+', '-' or 'U'. */
    const match = /^[\s+\-U]([0-9a-f]{4,64})\s+(.+?)(?:\s+\(.*\))?$/.exec(line)
    const rel = (match === null ? line.trim().replace(/^[\s+\-U]\S*\s+/, '') : match[2]).trim().replace(/\\/g, '/')
    if (rel === '') continue
    const absolute = path.resolve(root, rel)
    /* An uninitialised submodule has no `.git` yet: git still registers it, but
       there is no working tree to bind the panel to. */
    if (!existsSync(path.join(absolute, '.git'))) continue
    let real
    try { real = realpathSync(absolute) } catch { continue }
    if (!inside(workspace, real)) continue
    candidates.push({ absolute: real, rel })
  }
  const tops = await Promise.all(candidates.map((entry) => runGit(entry.absolute, ['rev-parse', '--show-toplevel'])))
  for (let index = 0; index < candidates.length; index += 1) {
    const top = tops[index]
    if (top.code !== 0) continue
    const reported = top.stdout.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const actual = reported === '' ? candidates[index].absolute : reported
    try {
      const real = realpathSync(actual)
      if (inside(workspace, real)) found.push({ root: real, rel: candidates[index].rel })
    } catch { /* stale submodule */ }
  }
  return found
}

/* The whole discovery pass is cached in-process per cwd: one scan walks the
   tree and spawns a git process per checkout, while the client re-POSTs `repos`
   on every panel mount — a warm answer is what keeps switching back to the Git
   page instant on a workspace full of checkouts. Entries are { at, rows };
   REPOS_CACHE_TTL_MS is a module-level `let` so tests can pin it to 0 and
   observe the always-rescan path.

   The cache is deliberately NOT invalidated when a write method succeeds:
   `repos` is a read-only discovery of which checkouts EXIST, and no write
   method changes that set — a commit or a new branch does not conjure a
   repository. A clone landing inside the 15s window simply stays invisible
   until the next scan; that is an accepted trade, the client's background
   refresh is the safety net. */
export const repoScanCache = new Map()
export let REPOS_CACHE_TTL_MS = 15000

async function scanRepos(cwd, workspace) {
  const cached = repoScanCache.get(cwd)
  /* Hand back fresh row objects: the cache is shared by every caller, and a
     consumer that decorates or reorders what it received must not write
     through into the next request's answer. */
  if (cached !== undefined && Date.now() - cached.at < REPOS_CACHE_TTL_MS) {
    return { cached: true, rows: cached.rows.filter((row) => {
      try { return inside(workspace, realpathSync(row.path)) } catch { return false }
    }).map((row) => ({ ...row })) }
  }
  const list = []
  const self = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  const isRepo = self.code === 0
  if (isRepo) {
    const top = self.stdout.trim()
    const actual = realpathSync(top === '' ? cwd : top)
    if (inside(workspace, actual)) list.push(repoRow(actual, undefined, 'workspace'))
  }
  for (const dir of findNestedRepos(cwd, 2)) {
    try {
      const actual = realpathSync(dir)
      if (inside(workspace, actual)) list.push(repoRow(actual, undefined, 'nested'))
    } catch { /* stale checkout */ }
  }
  /* Submodules of EVERY discovered checkout, not only a workspace that is one:
     a container workspace (a folder holding several checkouts — the usual
     shape of a multi-repo project) reaches its repositories through the rows
     above, and each of those may carry submodules of its own. Without this
     pass the picker lists `eis` but none of the eight checkouts under it.
     These rows are built LAST and the map below lets them win: the directory
     scan can reach the same checkout through a plain path (a submodule whose
     parent directory is not itself a repository), and the submodule row is the
     better one — its name carries the repo-relative path. */
  const roots = list.map((row) => row.path)
  const submoduleLists = await Promise.all(roots.map((root) => collectSubmoduleRepos(root, workspace)))
  for (const entries of submoduleLists) {
    for (const entry of entries) list.push(repoRow(entry.root, entry.rel, 'nested'))
  }
  const byIdentity = new Map()
  for (const row of list) byIdentity.set(pathIdentity(row.path), row)
  const rows = [...byIdentity.values()]
  rows.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'workspace' ? -1 : 1))
  const capped = rows.slice(0, REPO_LIST_LIMIT).map((row) => ({ ...row }))
  const branches = await Promise.all(capped.map((row) => branchOrNull(row.path)))
  for (let index = 0; index < capped.length; index += 1) capped[index].branch = branches[index]
  repoScanCache.set(cwd, { at: Date.now(), rows: capped })
  return { cached: false, rows: capped.map((row) => ({ ...row })) }
}

/** Depth-capped search for repositories nested in a workspace. */
function findNestedRepos(root, maxDepth) {
  const found = []
  const walk = (dir, depth) => {
    if (found.length >= 40 || depth > maxDepth) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || REPO_SCAN_SKIP.has(entry.name)) continue
      const child = path.join(dir, entry.name)
      if (existsSync(path.join(child, '.git'))) { found.push(child); continue }
      if (depth < maxDepth) walk(child, depth + 1)
    }
  }
  walk(root, 1)
  return found
}

async function branchOrNull(root) {
  const result = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name === '' ? null : name
}

/**
 * Repositories this panel may bind to: the session workspace itself when it is
 * one, repositories nested inside it (a sandbox holding many checkouts), and
 * the submodules of every checkout discovered that way — git records each
 * submodule as its own working tree with its own HEAD, index and branches, so
 * it is a repository the panel can bind to like any other. The client turns
 * this into the repo picker, and picking a row is all it takes: every later
 * call carries that path as `repoRoot`, which is the working directory the git
 * commands run in.
 */
async function repos(payload) {
  const cwd = cwdOf(payload)
  const { cached, rows } = await scanRepos(cwd, payload.workspaceRoot)
  /* `cached: true` rides a cache hit only; the client ignores it today, it just
     makes the answer say where it came from. */
  return { cwd, isRepo: rows.some((row) => row.kind === 'workspace'), repos: rows, ...(cached ? { cached: true } : {}) }
}

async function version() {
  const result = await runGit(process.cwd(), ['--version'])
  const raw = result.code === 0 ? result.stdout.trim() : ''
  const match = /git version (\S+)/.exec(raw)
  return { git: match === null ? raw : match[1], available: result.code === 0 }
}

function optionalPaths(payload, label) {
  if (payload === undefined || payload[label] === undefined || payload[label] === null) return []
  if (!Array.isArray(payload[label])) throw badRequest(label + ' must be an array')
  if (payload[label].length > 5000) throw badRequest(label + ' has too many entries')
  return payload[label].map((entry) => requireRelativePath(entry))
}

function clampInt(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/* ============================== ai commit message ============================== */
/* Issue #6: write the commit message with the session's own model route. The
   settings arrive WITH the request (the browser reads them from the same row
   Config document it renders), so a setting change takes effect on the next
   click without the host caching anything. */
const COMMIT_MAX_PROMPT_CHARS = 2000
const COMMIT_TOTAL_BYTES = 12 * 1024
const COMMIT_FILE_BYTES = 2048
const COMMIT_FILE_LINES = 80
const COMMIT_MAX_FILES = 30
const COMMIT_BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|bz2|xz|7z|jar|war|woff2?|ttf|otf|eot|mp[34]|mov|avi|mkv|so|dylib|dll|exe|bin|wasm|class|o|a)$/i

/** One model call's text, plus how it ENDED (a failure arrives as a finish chunk). */
async function collectCommitStream(stream) {
  let text = ''
  let finish = null
  let sawReasoning = false
  for await (const chunk of stream) {
    if (chunk === null || chunk === undefined) continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk.type === 'reasoning-delta') sawReasoning = true
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  return { text: text, finish: finish, sawReasoning: sawReasoning }
}

/** The change set, trimmed to a budget the model can actually be asked about. */
function commitInputOf(stagedPatch, unstagedPatch) {
  const patch = (stagedPatch === '' ? '' : stagedPatch) + (unstagedPatch === '' ? '' : (stagedPatch === '' ? '' : '\n') + unstagedPatch)
  const files = []
  let bytes = 0
  let dropped = 0
  let truncated = false
  const parts = patch.split(/^diff --git /m).slice(1)
  for (const part of parts) {
    const head = /^a\/(.+?) b\//.exec(part)
    const name = head === null ? '(unknown)' : head[1]
    if (files.length >= COMMIT_MAX_FILES) { dropped += 1; continue }
    if (COMMIT_BINARY.test(name)) { dropped += 1; continue }
    if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock)$/.test(name)) { dropped += 1; continue }
    let body = 'diff --git ' + part
    let trimmed = false
    const lines = body.split('\n')
    if (lines.length > COMMIT_FILE_LINES) { body = lines.slice(0, COMMIT_FILE_LINES).join('\n'); trimmed = true }
    if (body.length > COMMIT_FILE_BYTES) { body = body.slice(0, COMMIT_FILE_BYTES); trimmed = true }
    /* A file the total budget then drops was never sent, so it must not report
       as "truncated": truncated means "the model saw a shortened version". */
    if (bytes + body.length > COMMIT_TOTAL_BYTES) { dropped += 1; continue }
    if (trimmed === true) truncated = true
    bytes += body.length
    files.push({ path: name, body: body })
  }
  return { files: files, bytes: bytes, dropped: dropped, truncated: truncated }
}

/** Built-in instruction + the change set + the user's own addition, as DATA. */
function commitMessagesOf(input, userPrompt) {
  const system = [
    'You write git commit messages.',
    'Reply with the commit message ONLY: no prose, no code fences, no quotes, no explanation.',
    'First line: a concise subject, at most 72 characters, no trailing period.',
    'Then one blank line and a short body explaining what changed and why, when it adds value.',
    'Describe only what the diff shows. Never invent files, features or issue numbers.',
  ].join('\n')
  const user = [
    'Write the commit message for these changes.',
    '',
    input.files.map((file) => file.body).join('\n'),
  ].join('\n')
  /* The user's text is DATA in the same message, never a system instruction: it
     steers style (format, language, length) but cannot replace the rules above. */
  const addition = typeof userPrompt === 'string' && userPrompt.trim() !== ''
    ? '\n\nAdditional requirements from the user (style only; the rules above still apply):\n' + userPrompt.trim()
    : ''
  return { system: system, user: user + addition }
}

/** Strip what a model habitually wraps a message in; keep the text itself. */
function cleanupCommitMessage(text) {
  let out = String(text === null || text === undefined ? '' : text).trim()
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(out)
  if (fence !== null) out = fence[1].trim()
  if (out.length > 1 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('“') && out.endsWith('”')))) out = out.slice(1, -1).trim()
  return out
}

/* ---- ai commit message: the route handler ---- */
let commitServices = null
let commitBusy = false

function gatewayError(code, message) {
  return new PanelError(code, message, 502)
}

function failureTextOf(failure) {
  if (failure === null || failure === undefined) return ''
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  return String(failure.code === undefined ? failure : failure.code)
}

/** Route the call exactly like the session does when it talks to the model. */
async function commitRouteOf(payload) {
  const wanted = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (wanted === '') {
    const id = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (id === '') throw new PanelError('no-session', 'no session id: cannot follow the session model route', 502)
    const list = commitServices.sessions.list()
    const session = list.filter((row) => String(row.id) === id)[0]
    if (session === undefined) throw new PanelError('no-session', 'unknown session "' + id + '"', 502)
    let header = null
    try { header = session.requestHeader() } catch (error) { header = null; void error }
    const config = header === null || header === undefined || header.config === undefined || header.config === null ? {} : header.config
    if (typeof config.provider !== 'string' || typeof config.model !== 'string') {
      throw new PanelError('no-route', 'this session has no model route yet; pick a model in the session first', 502)
    }
    return { provider: config.provider, model: config.model, source: 'session' }
  }
  const slash = wanted.indexOf('/')
  if (slash <= 0 || slash === wanted.length - 1 || wanted.indexOf('/', slash + 1) >= 0) {
    throw badRequest('model must look like "provider/model"')
  }
  const provider = wanted.slice(0, slash)
  const model = wanted.slice(slash + 1)
  const known = commitServices.llm.listProviders().map((row) => row.id)
  if (known.indexOf(provider) < 0) {
    throw new PanelError('unknown-provider', 'unknown provider "' + provider + '"; this host serves: ' + known.join(', '))
  }
  /* The catalog is advisory (routing accepts unlisted ids), so an empty catalog
     cannot prove a model wrong — only a non-empty one without this id can. */
  const models = await commitServices.llm.listModels(provider)
  if (models.length > 0 && !models.some((row) => row.id === model)) {
    throw new PanelError('unknown-model', 'unknown model "' + model + '" for ' + provider + '; try: ' + models.map((row) => row.id).slice(0, 8).join(', '))
  }
  return { provider: provider, model: model, source: 'setting' }
}

/** The unset reasoning default: 'off' when this route offers it, '' otherwise.
    Failures stay silent on purpose — this is a preference, not a contract: an
    unreachable capability lookup must not turn a working model call into an
    error; it just leaves the effort to the adapter's own default. */
async function quietOffEffortOf(route) {
  try {
    const llm = commitServices.llm
    if (typeof llm.resolveModelInfo !== 'function') return ''
    const info = await llm.resolveModelInfo(route.provider, route.model)
    const reasoning = info !== null && typeof info === 'object' && info.reasoning !== null && typeof info.reasoning === 'object' ? info.reasoning : null
    const efforts = reasoning !== null && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
    return efforts.some((row) => row !== null && typeof row === 'object' && row.id === 'off') ? 'off' : ''
  } catch (error) {
    void error
    return ''
  }
}

/** The settings card's model picker: every provider route this host serves and
    the models each one lists. The catalog is advisory (routing accepts
    unlisted ids, see commitRouteOf), so a stored hand-typed value stays valid
    even when it is not in this list. */
async function commitModels() {
  if (commitServices === null) {
    throw new PanelError('no-host-service', 'this host does not serve llm + sessions, so there is no model catalog here', 501)
  }
  const providers = []
  for (const row of commitServices.llm.listProviders()) {
    /* One provider's discovery failing must not hide the others: its entry
       ships with an empty model list and the picker still works. */
    let models = []
    try { models = await commitServices.llm.listModels(row.id) } catch (error) { models = []; void error }
    providers.push({
      id: row.id,
      name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
      models: models
        .filter((model) => model !== null && typeof model === 'object' && typeof model.id === 'string' && model.id !== '')
        .map((model) => ({ id: model.id, name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id })),
    })
  }
  return { providers: providers }
}

/** The settings card's reasoning picker: the efforts one exact provider/model
    route accepts. An unreachable capability lookup answers with an EMPTY list
    (the browser falls back to its text field) instead of an error — the picker
    is a convenience, not a gate. */
async function commitEfforts(payload) {
  if (commitServices === null) {
    throw new PanelError('no-host-service', 'this host does not serve llm + sessions, so there are no reasoning efforts here', 501)
  }
  const wanted = typeof payload.model === 'string' ? payload.model.trim() : ''
  const slash = wanted.indexOf('/')
  if (slash <= 0 || slash === wanted.length - 1 || wanted.indexOf('/', slash + 1) >= 0) {
    throw badRequest('model must look like "provider/model"')
  }
  const provider = wanted.slice(0, slash)
  const model = wanted.slice(slash + 1)
  const known = commitServices.llm.listProviders().map((row) => row.id)
  if (known.indexOf(provider) < 0) {
    throw new PanelError('unknown-provider', 'unknown provider "' + provider + '"; this host serves: ' + known.join(', '))
  }
  if (typeof commitServices.llm.resolveModelInfo !== 'function') {
    return { provider: provider, model: model, efforts: [], defaultEffort: null }
  }
  try {
    const info = await commitServices.llm.resolveModelInfo(provider, model)
    const reasoning = info !== null && typeof info === 'object' && info.reasoning !== null && typeof info.reasoning === 'object' ? info.reasoning : null
    const efforts = reasoning !== null && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
    return {
      provider: provider,
      model: model,
      efforts: efforts
        .filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string' && row.id !== '')
        .map((row) => ({ id: row.id, name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id })),
      defaultEffort: reasoning !== null && typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : null,
    }
  } catch (error) {
    void error
    return { provider: provider, model: model, efforts: [], defaultEffort: null }
  }
}

async function commitMessage(payload) {
  if (commitServices === null) {
    throw new PanelError('no-host-service', 'this host does not serve llm + sessions, so the message cannot be written here', 501)
  }
  /* The single-flight window opens BEFORE the first await and covers the route
     lookup, the git reads and the model call. Claiming it only around the stream
     let four simultaneous clicks all pass the check and spend four model calls
     (measured: 4x200 on one click burst), which is four times the user's quota. */
  if (commitBusy) throw new PanelError('busy', 'a commit message is already being written', 409)
  commitBusy = true
  try {
    const cwd = cwdOf(payload)
    /* The picked repository travels as `repoRoot`, and every other git call
       threads it through `repoRootOf`. Resolving the root from `cwd` alone made
       this the one route that answered not-a-repo in a workspace whose own root
       is not a repository — a workspace holding several sibling repos, which is
       exactly what the repo picker exists for. */
    const repoRoot = await repoRootOf(cwd, payload)
    const scope = { cwd: cwd, repoRoot: repoRoot }
    const route = await commitRouteOf(payload)
    const sums = await summary(scope)
    const stagedPatch = sums.changes.staged.length > 0 ? (await diff(Object.assign({}, scope, { staged: true }))).patch : ''
    const input = commitInputOf(stagedPatch, (await diff(scope)).patch)
    if (input.files.length === 0) {
      if (input.dropped > 0) {
        throw new PanelError('only-ignored-changes', 'the only changes are lock files or binary files, which are not sent to the model; stage a source change first')
      }
      throw badRequest('nothing to describe: stage or edit something first')
    }
    const asked = typeof payload.prompt === 'string' ? payload.prompt : ''
    const prompt = asked.slice(0, COMMIT_MAX_PROMPT_CHARS)
    const reasoning = typeof payload.reasoningEffort === 'string' ? payload.reasoningEffort.trim() : ''
    const spoken = commitMessagesOf(input, prompt)
    const options = {
      provider: route.provider,
      model: route.model,
      system: spoken.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: spoken.user }] }],
      temperature: 0.2,
    }
    /* No maxTokens on purpose: omitted, the runtime materializes the selected
       model's own configured output cap (resolveModelInfo().defaultMaxTokens) —
       exactly what a session call gets. The hardcoded 512 here was half of
       issue #7: with thinking enabled, max_tokens is the budget for reasoning
       AND message together, so 512 died inside the reasoning phase before one
       word of the message existed. */
    /* The other half of issue #7: an UNSET effort is not a neutral "model
       default" — the DeepSeek adapter resolves "unspecified" to reasoning ON at
       "high". A commit message is a formatting task, so the unset default now
       asks for "off" whenever the route offers it. The id is read from the
       route's own efforts table (resolveModelInfo), never assumed: the runtime
       rejects an effort the route does not list, so a blind 'off' would trade
       one loud failure for another. The user's explicit choice always wins. */
    const effectiveReasoning = reasoning !== '' ? reasoning : await quietOffEffortOf(route)
    if (effectiveReasoning !== '') options.reasoningEffort = effectiveReasoning
    if (typeof payload.sessionId === 'string' && payload.sessionId !== '') options.sessionId = payload.sessionId
    const started = Date.now()
    const collected = await collectCommitStream(commitServices.llm.stream(options))
    /* An adapter failure is a terminal finish, not a throw: a missing check here
       would turn "the call failed" into "the model said nothing" (假成功). */
    const finish = collected.finish
    if (finish === null || finish === undefined) {
      throw gatewayError('llm-no-finish', 'the model stream ended without a finish reason; treat the result as unknown, not as success')
    }
    if (finish.kind === 'error') throw gatewayError('llm-error', failureTextOf(finish.failure))
    if (finish.kind === 'aborted') throw gatewayError('llm-aborted', 'the call was aborted: ' + failureTextOf(finish.failure))
    if (finish.kind !== 'stop') {
      /* The max-tokens + no-text + reasoning-delta shape is the exact signature
         of issue #7: the budget (reasoning included) ran out mid-thought. Say
         what happened and what to do, instead of a bare finish kind. */
      if (finish.kind === 'max-tokens' && collected.text.trim() === '' && collected.sawReasoning === true) {
        throw gatewayError('llm-unfinished', 'the model stopped with "max-tokens" before writing the message: its reasoning spent the whole output budget; lower the reasoning effort in the plugin settings or pick a lighter model')
      }
      throw gatewayError('llm-unfinished', 'the model stopped with "' + String(finish.kind) + '"; the message may be incomplete')
    }
    const message = cleanupCommitMessage(collected.text)
    if (message === '') throw gatewayError('empty-output', 'the model returned no text')
    return {
      message: message,
      provider: route.provider,
      model: route.model,
      routeSource: route.source,
      reasoningEffort: effectiveReasoning === '' ? null : effectiveReasoning,
      elapsedMs: Date.now() - started,
      input: { files: input.files.length, bytes: input.bytes, dropped: input.dropped, truncated: input.truncated },
      promptTruncated: asked.length > COMMIT_MAX_PROMPT_CHARS,
    }
  } finally {
    commitBusy = false
  }
}

const METHODS = {
  version,
  'commit-message': commitMessage,
  'commit-models': commitModels,
  'commit-efforts': commitEfforts,
  roots,
  repos,
  summary,
  stats,
  branches,
  log,
  commitDetail,
  diff,
  compare,
  stage,
  unstage,
  discard,
  commit,
  checkout,
  branchCreate,
  branchRename,
  branchDelete,
  merge,
  rebase,
  cherryPick,
  revert,
  reset,
  fetch,
  pull,
  push,
  stashList,
  stashPush,
  stashApply,
  stashDrop,
  tagCreate,
  tagDelete,
  tagDeleteRemote,
  pushTags,
  clone,
  gitLogs,
  remoteAdd,
  remoteRemove,
  branchDeleteRemote,
  rebaseAbort,
  stashClear,
  undoList,
  undoApply,
}

/* ============================== http plumbing ============================== */

function rejectRequest(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readJsonBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new PanelError('too-large', 'request body is too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') { resolve({}); return }
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(badRequest('request body must be JSON'))
      }
    })
    req.on('error', (error) => { reject(new PanelError('transport', messageOf(error), 500)) })
  })
}

async function handle(ctx, req, res) {
  if (rejectRequest(ctx, req, res)) return
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'POST required' } })
    return
  }
  const pathname = new URL(req.url === undefined ? '/' : req.url, 'http://dsh.internal').pathname
  const method = pathname.startsWith(ROUTE_PREFIX + '/') ? pathname.slice(ROUTE_PREFIX.length + 1) : ''
  const handler = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : undefined
  if (handler === undefined || method.includes('/')) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method "' + method + '"' } })
    return
  }
  try {
    const payload = await scopedPayload(ctx, method, await readJsonBody(req))
    const data = WRITE_METHODS.has(method)
      ? await withRepoLock(lockKeyOf(payload), () => handler(payload))
      : await handler(payload)
    sendJson(res, 200, { ok: true, data: data })
  } catch (error) {
    if (error instanceof PanelError) {
      sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
      return
    }
    const message = messageOf(error)
    sendJson(res, 500, { ok: false, error: { code: 'internal', message } })
  }
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: (req, res) => handle(ctx, req, res) }),
    'dsh-ide-git: /dsh-ide-git/api git routes',
  )
  /* AI commit message (issue #6). `llm` and `sessions` are injected HERE and not
     in `export const inject`: a host without them must still load the whole
     plugin, it just answers commit-message with no-host-service. */
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['llm', 'sessions'], (injected) => {
    const llm = injected.get('llm')
    const sessions = injected.get('sessions')
    if (llm === undefined || llm === null || sessions === undefined || sessions === null) return
    injected.effect(() => {
      commitServices = { llm: llm, sessions: sessions }
      return () => { commitServices = null }
    }, 'dsh-ide-git: ai commit message')
  })
}
