/**
 * dsh-ide-git — smoke test (file-level only: no Cordis runtime, no browser).
 *
 * Guards the invariants that would silently break the plugin at load time:
 * manifest/bookkeeping consistency, the no-build client wrapper, the baseline
 * require whitelist, and the argv-only git posture of the host half.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (name) => readFileSync(join(root, name), 'utf8')
const exists = (name) => existsSync(join(root, name))

const pkg = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('dsh.plugin.json'))
const host = read('src/index.js')
const client = read('src/client.js')
const changelog = read('CHANGELOG.md')
const patch = read('cordis.patch.yml')

/** The dsh client baseline modules a no-build client half may require. */
const BASELINE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

test('release bookkeeping: package.json and dsh.plugin.json agree', () => {
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.main, './' + pkg.main)
  assert.equal(pkg.name, 'dsh-ide-git')
  assert.match(manifest.id, /^dsh-external\//)
  assert.equal(pkg.license, 'MIT')
  assert.ok(exists('LICENSE'))
})

test('every published entry exists on disk', () => {
  assert.ok(exists(pkg.main), 'host entry missing')
  assert.ok(exists('cordis.patch.yml'))
  for (const file of pkg.files) {
    if (file.includes('*')) continue
    assert.ok(exists(file), 'files[] entry missing: ' + file)
  }
  assert.equal(pkg.exports['.'], './' + pkg.main)
  assert.equal(pkg.exports['./client'], './src/client.js')
  // The Electron renderer has no loader-internal resolver, so client-module
  // discovery falls back to createRequire(baseUrl).resolve('<pkg>/package.json')
  // — which honours the exports map. Without this key the client half never
  // enters the boot graph and every host log stays green (v0.5.6, issue #2).
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('the dsh peer survives the runtime compatibility check', () => {
  // dsh 0.1.7+ enforces peerDependencies entries named @deepseek-ai/dsh* and
  // ignores engines.dsh entirely (packages/boot/app-boot/src/plugin-compatibility.ts),
  // so the plugin's floor has to live in BOTH fields with the same value.
  const peer = pkg.peerDependencies['@deepseek-ai/dsh']
  assert.equal(peer, pkg.engines.dsh, 'the dsh peer must mirror engines.dsh exactly')
  // Open floor with a prerelease tag, NO ceiling. The floor tracks the oldest
  // supported host (0.1.6-alpha.2 — the first one with the plugins.bundle.config
  // seat; 0.1.6 never shipped a stable). The host gate satisfies with
  // includePrerelease:true (app-boot plugin-compatibility.ts), so a single
  // `>=X.Y.Z-tag` comparator is both honest and sufficient; the tag keeps a
  // future prerelease floor expressible without a second branch.
  const floor = /^>=(\d+)\.(\d+)\.(\d+)(-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(peer)
  assert.ok(floor, 'the dsh peer must stay an open >=X.Y.Z[-tag] floor: ' + peer)
  const required = floor.slice(1, 4).map(Number)
  const floorTag = floor[5] || null
  // semver prerelease identifier compare: numeric fields compare numerically,
  // numeric < alphanumeric, longer wins when one is a prefix of the other.
  const compareTag = (a, b) => {
    const as = a === null ? [] : String(a).split('.')
    const bs = b === null ? [] : String(b).split('.')
    for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
      const x = as[i]; const y = bs[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y)
      if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d }
      else if (xn !== yn) return xn ? -1 : 1
      else if (x !== y) return x < y ? -1 : 1
    }
    return 0
  }
  // Mirror of the host gate (semver.satisfies with includePrerelease:true) at
  // numeric + prerelease granularity.
  const satisfies = (version) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(version)
    assert.ok(m, 'unparsable version ' + version)
    const got = m.slice(1, 4).map(Number)
    for (let i = 0; i < 3; i += 1) {
      if (got[i] !== required[i]) return got[i] > required[i]
    }
    if (floorTag === null) return true
    if (m[4] === undefined) return true // a stable release outranks any prerelease
    return compareTag(m[4], floorTag) >= 0
  }
  // Mirror of the host gate at numeric + prerelease granularity: 0.1.6-alpha.1
  // and older hosts predate the plugins.bundle.config seat and are rejected.
  for (const version of ['0.1.2', '0.1.5', '0.1.6-alpha.1']) {
    assert.ok(!satisfies(version), 'the dsh peer must reject ' + version)
  }
  for (const version of ['0.1.6-alpha.2', '0.1.6-alpha.3', '0.1.6', '0.1.7-alpha.1', '0.1.7-rc.1', '0.2.0']) {
    assert.ok(satisfies(version), 'the dsh peer would reject ' + version)
  }
  // OPTIONAL keeps the gate intact while removing the install hazard: the gate
  // reads peerDependencies only, but a package manager with autoInstallPeers
  // (pnpm's default) resolves the range against the registry — and every
  // published @deepseek-ai/dsh version is a prerelease, which a plain range
  // excludes (ERR_PNPM_NO_MATCHING_VERSION for the whole install).
  assert.equal(pkg.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional, true)
})

test('cordis patch mounts exactly one row named dsh-ide-git', () => {
  // Commented-out examples must not count: only live YAML lines are the mount.
  const active = patch.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  assert.match(active, /- insert:/)
  const names = active.match(/name: '([^']+)'/g) || []
  assert.deepEqual(names, ["name: 'dsh-ide-git'"])
  assert.match(active, /id: ide-git/)
})

test('client half uses the no-build ModuleLoader wrapper', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: 'dsh-ide-git'/)
  assert.match(client, /factory: \(require\) =>/)
  assert.doesNotMatch(client, /^\s*import\s/m, 'client half must not use import')
  assert.doesNotMatch(client, /\bexport\s+(default\s+)?(const|function|class)\b/)
})

test('client half requires only baseline modules', () => {
  const calls = client.match(/require\((['"])([^'"]+)\1\)/g) || []
  assert.ok(calls.length > 0, 'expected at least one require call')
  for (const call of calls) {
    const name = call.slice(call.indexOf('(') + 2, call.length - 2)
    assert.ok(BASELINE.has(name), 'non-baseline require: ' + name)
  }
})

test('send-to-chat rides the composer facade with a guarded primitives require', () => {
  // The insertion channel is ui-conversation's SessionInput facade, reached
  // through ctx.get() probes (research brief docs/research/host-api-notes.md):
  // files insert structured reference chips, plain text rides the scoped
  // insert-text bail event. `inputTriggers...openReference` is a PREVIEW — it
  // never inserts, so the panel must not even call it.
  assert.match(client, /function composerTargetOf\(ctx, sessionId\)/, 'the probed composer target must exist')
  assert.match(client, /function insertIntoComposer\(ctx, sessionId, apply\)/, 'the CAS-retrying insert must exist')
  assert.match(client, /ctx\.get\('conversation'\)/, 'the conversation service is the insertion channel')
  assert.match(client, /ctx\.get\('sessions'\)/, 'the retained session scope comes from the sessions service')
  assert.match(client, /input\.insertReference\(/, 'file rows insert structured reference chips')
  assert.match(client, /slash\/input-insert-text/, 'plain text rides the scoped insert-text bail event')
  assert.match(client, /function fileMentionOf\(relPath\)/, 'the @-mention grammar must be inlined (the grammar package is not on the seed table)')
  assert.doesNotMatch(client, /\.openReference\(/, 'openReference opens a preview and must never be called for insertion')
  // Spans are DETECT coordinates; the published draft is the CLIPBOARD one.
  // Every span construction must go through the conversion — a bare
  // draft.length tail points past detectLength once a chip exists and the
  // edit silently fails (the v0.13.5 real-machine report).
  assert.match(client, /function detectTailSpanOf\(state\)/, 'the detect-coordinate conversion must exist')
  assert.match(client, /const span = detectTailSpanOf\(state\)/, 'the funnel must build its span through the conversion')
  assert.match(client, /const tail = detectTailSpanOf\(state\)/, 'the chip+text second leg must rebuild its tail through the conversion')
  assert.doesNotMatch(client, /start: state\.draft\.length/, 'a raw clipboard-length span would regress the probe failure')
  // A host without the seed module must degrade, not throw (invariant 1's spirit).
  assert.match(client, /let UIPrimitives = null/, 'the primitives module handle must default to null')
  assert.match(client, /try \{ UIPrimitives = require\('@deepseek-ai\/dsh-client-ui-primitives'\) \} catch/, 'the require must be guarded')
  assert.match(client, /UIPrimitives !== null && typeof UIPrimitives\.DiffBlock === 'function'/, 'the diff block must check the handle before use')
  assert.match(client, /UIPrimitives === null \|\| typeof UIPrimitives\.FileTypeIcon !== 'function'/, 'the file glyph must check the handle before use')
})

test('every send-to-chat surface is wired to the shared funnel', () => {
  // Branch rows and commit rows send plain text; change rows AND the
  // commit-detail file list send the reference. v0.14.1 removed the raw
  // PATH send on purpose (user feedback: two "send" items read as a
  // duplicate — the chip covers the file case, and 复制路径 + paste covers
  // the rare raw-string need), so the path key must be GONE everywhere.
  const hits = (key) => (client.match(new RegExp("t\\('" + key.replace(/\./g, '\\.') + "'\\)", 'g')) || []).length
  assert.ok(hits('menu.sendToChat') >= 4, 'menu.sendToChat must appear in branch, commit, change and detail-file menus (saw ' + hits('menu.sendToChat') + ')')
  assert.equal(hits('menu.sendFilePathToChat'), 0, 'the raw-path send item was removed (the @-chip covers it; 复制路径 remains)')
  assert.doesNotMatch(client, /'menu\.sendFilePathToChat'/, 'the path-send dictionary key is gone from every locale')
  assert.match(client, /commit\.hash\.slice\(0, 7\)/, 'commit rows send the short hash')
  assert.match(client, /onFileMenu: detailFileMenu/, 'the commit-detail file list must carry the context menu')
})

test('send payloads are self-describing (git commit / branch + repo, v0.13.3 feedback)', () => {
  // A bare short hash or branch name reads as noise out of context (v0.13.3
  // user feedback): the commit and branch sends must say WHAT they are and
  // WHERE from. The wording rides the fill() templates send.commitText /
  // send.branchText; the channel itself is unchanged. The file @-chip is
  // already self-describing and keeps its insertReference channel untouched.
  assert.match(client, /sendGitSummaryToChat\('send\.commitText', \{ hash: shortHash, subject: subject, repo: repoLabel \}\)/,
    'the commit payload carries hash + subject + repo')
  assert.match(client, /sendGitSummaryToChat\('send\.branchText', \{ name: entry\.name, repo: repoLabel \}\)/,
    'the branch payload carries the branch name + repo')
  assert.match(client, /const text = fill\(t\(key\), Object\.assign\(\{\}, values, \{ repo: repo \}\)\)/,
    'the payload text is a fill() template lookup, not a hand-built string')
  assert.match(client, /const repoLabel = repoRoot === null \? '' : baseName\(repoRoot\)/,
    'the repo label is the repo root basename')
  // fill() leaves unknown keys verbatim, so an unknown repo must become a
  // neutral placeholder INSIDE the helper — a literal {repo} must never reach
  // the chat.
  assert.match(client, /values\.repo === undefined \|\| values\.repo === '' \? '—' : values\.repo/,
    'an unknown repo degrades to a placeholder, never a literal {repo}')
  // A commit without a subject (git tolerates empty messages) must not fake
  // one: it degrades to the old bare-hash payload.
  assert.match(client, /if \(subject === ''\) \{ sendToComposer\(\{ text: shortHash, fallback: shortHash \}\); return \}/,
    'a commit without a subject degrades to the bare hash')
  // Both templates ship in ZH + EN + every LOCALES entry (21; the key-set test
  // would also catch a missing one, a named guard says WHY they must stay).
  for (const key of ['send.commitText', 'send.branchText']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 21, key + ' must ship in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }
  // Both git-summary menus (branch + commit) close over the funnel and the
  // label; a stale closure would send the PREVIOUS repo's name (invariant 12:
  // dependency arrays are evaluated during render). The multi-select episode
  // (issue #13) appended copyValues to both arrays — the guard needs the pair
  // PRESENT, not last, so a lookahead tolerates trailing deps.
  const menuDeps = (client.match(/sendGitSummaryToChat, repoLabel(?=[,\]])/g) || []).length
  assert.ok(menuDeps >= 2, 'branch and commit menus must both list the funnel + repoLabel (saw ' + menuDeps + ')')
})

/* The host DiffBlock paints rows WITHOUT line-number attributes (a row is a
   plain div carrying `row.text`; the +/- prefixes live in CSS ::before
   content), so the diff-pane menu reconstructs numbers by replaying the row
   kinds from the patch's first hunk header. That plumbing sits between two
   markers as a PURE block — slice it out and drive the real implementation,
   exactly like the pane sizing core. `fill` (used by the payload templates)
   and `diffLines` (used by the hand-drawn rows) are sliced along. */
function diffSelectionCore() {
  const fillStart = client.indexOf('function fill(template, values)')
  const fillEnd = client.indexOf('/* ============================== api')
  assert.ok(fillStart >= 0 && fillEnd > fillStart, 'the fill() helper must stay sliceable')
  const start = client.indexOf('function diffLines(patch)')
  const coreStart = client.indexOf('/* ---- diff selection core')
  const coreEnd = client.indexOf('/* ---- end diff selection core')
  assert.ok(start >= 0 && coreStart > start && coreEnd > coreStart, 'the diff selection core must keep its markers')
  return new Function(client.slice(fillStart, fillEnd) + '\n' + client.slice(start, coreEnd)
    + '\nreturn { DIFF_SNIPPET_MAX: DIFF_SNIPPET_MAX, hunkStartOf: hunkStartOf, hunkHeadersOf: hunkHeadersOf,'
    + ' beforeContentKind: beforeContentKind, lineSpanFromKinds: lineSpanFromKinds, rowSpanOfRows: rowSpanOfRows,'
    + ' linesLabelOf: linesLabelOf, lineSpanLabelOf: lineSpanLabelOf, diffSpanTextOf: diffSpanTextOf,'
    + ' diffLines: diffLines, fill: fill }')()
}

function composerSendCore() {
  const start = client.indexOf('function fileMentionOf(relPath)')
  const end = client.indexOf('/* ============================== diff ============================== */')
  assert.ok(start >= 0 && end > start, 'the composer send core must stay sliceable')
  return new Function(client.slice(start, end)
    + '\nreturn { fileMentionOf: fileMentionOf, detectTailSpanOf: detectTailSpanOf }')()
}

test('composer tail spans are built in DETECT coordinates, not clipboard ones (v0.13.5 real-machine fix)', () => {
  // projection.ts: detectText counts every chip as ONE U+FFFC, while the
  // published InputState.draft is the clipboard projection where a chip
  // expands to its full @path. selectSpan rejects end > detectLength, so a
  // tail from draft.length silently kills the text leg once a chip exists —
  // the conversion subtracts every occurrence's (length - 1).
  const core = composerSendCore()
  // No chips: the two projections agree, the tail is the plain draft length.
  assert.deepEqual(core.detectTailSpanOf({ draft: 'abc', draftRev: 2, occurrences: [] }),
    { start: 3, end: 3, draftRev: 2 })
  // One chip (the exact failing shape): '@deploy/x/f.md' is 14 clipboard
  // chars but ONE detect char — the tail moves back by 13 (draft 18 → 5,
  // exactly detectText = '\uFFFC 第3行').
  assert.deepEqual(core.detectTailSpanOf({ draft: '@deploy/x/f.md 第3行', draftRev: 5, occurrences: [
    { offset: 0, length: 14, clipboardText: '@deploy/x/f.md' },
  ] }), { start: 5, end: 5, draftRev: 5 }, 'the text leg span must land inside detectLength even right after the chip leg')
  // A draft the USER already seeded with a chip affects the plain-text sends too.
  assert.deepEqual(core.detectTailSpanOf({ draft: 'todo @src/a.ts then', draftRev: 9, occurrences: [
    { offset: 5, length: 9, clipboardText: '@src/a.ts' },
  ] }), { start: 11, end: 11, draftRev: 9 })
  // Two chips subtract twice.
  assert.deepEqual(core.detectTailSpanOf({ draft: '@a/x @b/y!', draftRev: 4, occurrences: [
    { offset: 0, length: 4, clipboardText: '@a/x' },
    { offset: 5, length: 4, clipboardText: '@b/y' },
  ] }), { start: 4, end: 4, draftRev: 4 })
  // Degenerate states refuse instead of inventing a span.
  assert.equal(core.detectTailSpanOf(null), null)
  assert.equal(core.detectTailSpanOf({ draft: 5, draftRev: 1, occurrences: [] }), null)
  assert.equal(core.detectTailSpanOf({ draft: 'abc', occurrences: [] }), null)
  assert.equal(core.detectTailSpanOf({ draft: '', draftRev: 1, occurrences: [
    { offset: 0, length: 99, clipboardText: '@ghost' },
  ] }), null, 'a negative tail must never be handed to the editor')
})

test('the diff selection core maps hunk headers to file line numbers (v0.13.5)', () => {
  const core = diffSelectionCore()

  /* A realistic two-hunk patch. Hunk 1: @@ -10,7 +10,8 @@ — 3 ctx + 1 del + 3
     add + ... let the numbers below carry it. Hunk 2 sits 40 lines lower, so
     every replay has to CROSS the second header to prove the first header
     seeds the whole walk and per-kind counters do the rest. */
  const PATCH = [
    'diff --git a/src/app.js b/src/app.js',
    'index 1111111..2222222 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -10,7 +10,8 @@ const config = {',
    ' const a = 1',        // ctx: old 10, new 10
    ' const b = 2',        // ctx: old 11, new 11
    '-const removed = 3',  // del: old 12
    '+const added = 4',    // add: new 12
    '+const added2 = 5',   // add: new 13
    ' const c = 6',        // ctx: old 13, new 14
    ' const d = 7',        // ctx: old 14, new 15
    ' const e = 8',        // ctx: old 15, new 16
    '@@ -50,6 +52,7 @@ export function main() {',
    ' main()',             // ctx: old 50, new 52
    ' prep()',             // ctx: old 51, new 53
    '-gone()',             // del: old 52
    '-gone2()',            // del: old 53
    '+here()',             // add: new 54
    '+here2()',            // add: new 55
    '+here3()',            // add: new 56
    ' finish()',           // ctx: old 54, new 57
    ' end()',              // ctx: old 55, new 58
  ].join('\n')

  // The first header seeds the replay, and only the first one counts.
  assert.deepEqual(core.hunkStartOf(PATCH), { oldLine: 10, newLine: 10 })
  assert.deepEqual(core.hunkStartOf('@@ -3,1 +3,1 @@\n x'), { oldLine: 3, newLine: 3 })
  assert.equal(core.hunkStartOf('diff --git a/x b/x\nbinary'), null, 'a headerless patch has no coordinates')
  // A multi-hunk diff restarts BOTH counters at every @@ line: the replay
  // needs one seed per hunk, in patch order.
  const headers = core.hunkHeadersOf(PATCH)
  assert.deepEqual(headers, [{ oldLine: 10, newLine: 10 }, { oldLine: 50, newLine: 52 }])

  /* Host-diffBlock path. A real body renders: the path row (chrome), hunk 1,
     a `⋯` gap row (chrome), hunk 2 — and the CHROME ROWS are what re-bases
     the counters to the next header. A flat kinds list without them would
     keep counting straight through the second header, so the cross-hunk
     assertions run against the WITH-chrome sequence only. */
  const rows = core.diffLines(PATCH)
  const kinds = rows.filter((row) => row.kind === 'ctx' || row.kind === 'del' || row.kind === 'add').map((row) => row.kind)
  assert.equal(kinds.length, 17)
  const withChrome = [null].concat(kinds.slice(0, 8), [null], kinds.slice(8))
  // path row, hunk 1 (8 rows), gap row, hunk 2 (9 rows)
  assert.equal(withChrome.length, 19)
  // First hunk, flat kinds: numbers from the first header.
  assert.deepEqual(core.lineSpanFromKinds(kinds, 0, 1, headers), { start: 10, end: 11, old: false })
  assert.deepEqual(core.lineSpanFromKinds(kinds, 2, 4, headers), { start: 12, end: 13, old: false },
    'mixed del+add span rides the new side')
  assert.deepEqual(core.lineSpanFromKinds(kinds, 2, 2, headers), { start: 12, end: 12, old: true },
    'a pure deletion reports OLD numbers, flagged as such')
  assert.deepEqual(core.lineSpanFromKinds(kinds, 3, 3, headers), { start: 12, end: 12, old: false },
    'one added line reports its new number, start == end')
  // With the chrome rows in: the gap re-bases to the second header.
  assert.equal(core.lineSpanFromKinds(withChrome, 0, 0, headers), null, 'the path row alone has no numbers')
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 1, 2, headers), { start: 10, end: 11, old: false })
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 12, 15, headers), { start: 54, end: 55, old: false },
    'a span across the gap reads on the NEW side of the SECOND header')
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 12, 13, headers), { start: 52, end: 53, old: true },
    "a pure deletion in the second hunk reports that hunk's OLD numbers")
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 14, 14, headers), { start: 54, end: 54, old: false })
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 17, 18, headers), { start: 57, end: 58, old: false },
    'context after the additions keeps counting from the same header')
  // Chrome-only span (path row or gap): no numbers at all.
  assert.equal(core.lineSpanFromKinds(withChrome, 9, 9, headers), null)
  assert.equal(core.lineSpanFromKinds([null, null], 0, 1, headers), null, 'a selection on path/gap rows has no line numbers')
  assert.equal(core.lineSpanFromKinds('nope', 0, 0, headers), null, 'non-array input degrades to null')
  assert.equal(core.lineSpanFromKinds(kinds, 0, 1, []), null, 'no headers, no coordinates')

  /* Hand-drawn path: diffLines rows carry both numbers already; the span
     must agree with the replayed one (row indexes include meta/hunk rows). */
  // rows: 0 diff, 1 index, 2 ---, 3 +++, 4 @@1, 5..12 body1, 13 @@2, 14..22 body2
  assert.deepEqual(core.rowSpanOfRows(rows, 7, 7), { start: 12, end: 12, old: true }, 'the deleted row reports its old number')
  assert.deepEqual(core.rowSpanOfRows(rows, 7, 9), { start: 12, end: 13, old: false }, 'mixed span rides the new side')
  assert.deepEqual(core.rowSpanOfRows(rows, 14, 15), { start: 52, end: 53, old: false }, 'the second hunk header re-bases both counters')
  assert.deepEqual(core.rowSpanOfRows(rows, 16, 19), { start: 54, end: 55, old: false }, 'cross-header spans stay on the new side')
  assert.deepEqual(core.rowSpanOfRows(rows, 20, 22), { start: 56, end: 58, old: false }, 'context after the additions keeps counting')
  assert.equal(core.rowSpanOfRows(rows, 0, 1), null, 'meta rows carry no numbers')
  assert.equal(core.rowSpanOfRows(rows, 3, 2), null, 'an inverted range is refused')

  // Labels: a single line stays bare, a range takes the en dash.
  assert.equal(core.linesLabelOf(7, 7), '7')
  assert.equal(core.linesLabelOf(7, 9), '7–9')
})

test('diff line payloads are self-describing in the 21-gate dictionaries (v0.13.5)', () => {
  const core = diffSelectionCore()
  const zhStart = client.indexOf('const ZH = {')
  let depth = 0
  let zhEnd = -1
  for (let index = client.indexOf('{', zhStart); index < client.length; index += 1) {
    if (client[index] === '{') depth += 1
    else if (client[index] === '}') {
      depth -= 1
      if (depth === 0) { zhEnd = index + 1; break }
    }
  }
  const ZH = new Function(client.slice(zhStart, zhEnd) + '\nreturn ZH')()
  const t = (key) => ZH[key]
  assert.equal(t('send.diffLinesCommit'), '{lines}(提交 {hash}「{subject}」@ {branch})', 'the zh templates must stay intact for this test to read them')

  // Commit context: short hash, subject truncated to 60, HEAD branch.
  const long = 'word '.repeat(30).trim()
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: 'a1b2c3d4e5f6', subject: 'Fix the thing' }, { start: 7, end: 9, old: false }, 'main'),
    '第 7–9 行(提交 a1b2c3d「Fix the thing」@ main)')
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: 'a1b2c3d4e5f6', subject: long }, { start: 3, end: 3, old: false }, ''),
    '第 3 行(提交 a1b2c3d「' + long.slice(0, 60) + '」@ —)', 'the subject is truncated and a missing branch degrades to a dash')
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: '', subject: '' }, { start: 5, end: 6, old: true }, 'dev'),
    '第 5–6 行(旧行号)(提交 —「—」@ dev)', 'an old-numbered span says so; an unknown hash/subject degrade, never fake')

  // Worktree context: staged vs uncommitted comes from the pane's own state.
  assert.equal(core.diffSpanTextOf(t, { kind: 'worktree', staged: true }, { start: 12, end: 12, old: false }, ''),
    '第 12 行(工作区已暂存)')
  assert.equal(core.diffSpanTextOf(t, null, { start: 18, end: 19, old: true }, ''),
    '第 18–19 行(旧行号)(工作区未提交)', 'a null context reads as the working tree, uncommitted')
})

test('the diff pane context menu reads the selection before the menu opens (v0.13.5)', () => {
  // The pane carries its own menu; a selection OUTSIDE the diff rows keeps
  // the browser's own menu (no preventDefault, no items).
  assert.match(client, /onContextMenu: onDiffPaneContextMenu/, 'the diff pane must carry its own context menu')
  const handler = client.slice(client.indexOf('const onDiffPaneContextMenu'), client.indexOf('const submitDialog'))
  assert.ok(handler.length > 200 && handler.length < 4000, 'the handler must be found whole')
  assert.match(handler, /const saved = savedSelectionOf\(\)/, 'the window selection is captured FIRST')
  assert.match(client, /getRangeAt\(0\)\.cloneRange\(\)/, 'the captured range is a CLONE — some platforms clear it under the menu')
  assert.match(handler, /if \(saved === null \|\| resolved === null\) return/, 'no diff selection keeps the browser menu (preventDefault skipped)')
  assert.ok(handler.indexOf('preventDefault') < handler.indexOf('openMenuAt'), 'the browser menu is only suppressed for real diff selections')
  assert.match(handler, /DIFF_SNIPPET_MAX/, 'the snippet degradation truncates like the core promises')

  // Forward-compat guard (v0.13.5): the rows may be HOST-rendered
  // (ui-primitives DiffBlock), and a future DSH may give that component its
  // own context-menu surface. React dispatches inner handlers first, so the
  // pane handler MUST defer to defaultPrevented before doing anything —
  // the host menu stands alone, never two menus, never an override. This
  // assertion pins the check to the FIRST statement of the handler so a
  // casual refactor cannot drop it.
  const deferPos = handler.indexOf('if (event.defaultPrevented === true) return')
  assert.ok(deferPos >= 0, 'the pane handler must defer to inner defaultPrevented (ours is a last resort, the host menu wins)')
  assert.ok(deferPos < handler.indexOf('const saved = savedSelectionOf()'), 'the defer check runs before the selection is even read')

  // The funnel gains a chip+text leg: the @file chip first, then the line
  // sentence at the NEW draft tail (the chip changed draft and rev).
  assert.match(client, /slash\/input-insert-text', \{ text: payload\.text, span: tail \}/,
    'the line-range sentence rides the text leg after the chip')
  assert.match(client, /if \(chipApplied === false\) return false/, 'a lost chip leg retries the whole payload')
  assert.match(client, /return true\n          \}\n          if \(payload\.appearance !== undefined\) \{/,
    'a chip that landed reads as sent even when the text leg lost its race')

  // The pane context rides the patch state and clears wherever the patch does
  // (pickRepo, selectCommit, onBack, pane close, view switch).
  assert.match(client, /const \[diffContext, setDiffContext\] = useState\(null\)/)
  const clears = (client.match(/setDiffContext\(null\)/g) || []).length
  assert.ok(clears >= 5, 'the diff context must clear wherever the patch clears (saw ' + clears + ')')
  // v0.14: the open verbs moved into ONE funnel, showDiff (external preview
  // first, inline pane as the fallback). The context contract survives
  // verbatim inside the funnel's inline legs.
  assert.match(client, /setDiffContext\(\{ kind: 'worktree', staged: seed\.staged === true \}\)/,
    'the worktree pane remembers whether it shows staged or unstaged (showDiff inline leg)')
  assert.match(client, /setDiffContext\(\{ kind: 'commit', hash: seed\.hash, subject: seed\.subject \|\| '' \}\)/,
    'the commit-detail pane carries hash + subject at open time (showDiff inline leg)')
  // The funnel itself: external channel first (seat onOpenDiff, then the
  // base's openTab toward the right sidebar), inline only as a fallback —
  // and the external ref carries the repo root both ways (worktree + repoRoot)
  // so a multi-root workspace cannot land the diff in the wrong repository.
  assert.match(client, /if \(previewDiff\(seed\) === true\) return/,
    'every diff verb goes through the external-first funnel')
  assert.match(client, /worktree: repoRoot, repoRoot: repoRoot/,
    'the external diff ref pins the repository root')

  // Nine new keys × 21 gates (the key-set test checks exact equality; this
  // says WHY they exist).
  for (const key of ['menu.sendDiffLinesToChat', 'menu.sendDiffSnippetToChat', 'menu.copyDiffRef', 'send.diffLinesCommit', 'send.diffLinesWorktree', 'send.diffStaged', 'send.diffUnstaged', 'send.diffNewLines', 'send.diffOldLines']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 21, key + ' must ship in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }
})

test('the conversation seat convergence is a controlled loop with a content trigger (v0.13.3 fix)', () => {
  // One feedback pass was not enough on the real host: content mounts AFTER
  // the first pass (composer, hero, diff) and re-opens the overflow, and the
  // ResizeObserver only sees the scrollport's own size. The seat must own a
  // bounded convergence LOOP (4 rAF rounds, overwrite-style so rounds cannot
  // compound, 240 floor) re-run by every trigger — and a host without the
  // conversation scrollport must skip the whole thing silently.
  const start = client.indexOf('Leftover wheel scroll, root cause')
  const end = client.indexOf('const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])')
  assert.ok(start >= 0 && end > start, 'the seat sizing effect block must exist')
  const effect = client.slice(start, end)
  assert.match(effect, /base\.current = Math\.round\(scroll\.clientHeight - offset - 8\)/,
    'measure() recomputes the UNCORRECTED base on every pass')
  assert.match(effect, /const overflow = scroll\.scrollHeight - scroll\.clientHeight\n            if \(overflow <= 1\) return/,
    'a convergence round stops once no meaningful overflow (>1px) is left')
  assert.match(effect, /leftover\.current = overflow\n            setSeatHeight\(Math\.max\(240, base\.current - overflow\)\)/,
    'the correction is recorded overwrite-style and clamps at 240')
  assert.match(effect, /if \(rounds < 4\) requestAnimationFrame\(step\)/,
    'the convergence loop is bounded (at most 4 rAF rounds)')
  assert.match(effect, /typeof MutationObserver === 'function'/,
    'the content watcher is feature-probed like the resize one')
  assert.match(effect, /mutationObserver\.observe\(scroll, \{ childList: true, subtree: true \}\)/,
    'the watcher covers content mounting later (childList + subtree)')
  assert.match(effect, /setTimeout\(\(\) => \{ mutationTimer = null; measure\(\) \}, 120\)/,
    'the mutation burst is debounced (~120ms)')
  assert.match(effect, /if \(mutationTimer !== null\) clearTimeout\(mutationTimer\)/,
    'a new burst replaces the pending debounce')
  assert.match(effect, /if \(mutationObserver !== undefined\) mutationObserver\.disconnect\(\)/,
    'unmount disconnects the watcher together with the resize one')
  assert.match(effect, /try \{ scroll = el\.closest\('\[data-conversation-scroll\]'\) \} catch/,
    'probing the host structure rides a try/catch: a missing scrollport skips silently')
})

test('client API base is mount-relative (sub-path support, issue #4)', () => {
  // dsh 0.1.7 serves the shell with <base href="./">: document.baseURI is the
  // mount the page loaded from, and fetch() resolves relative URLs against it.
  // An origin-absolute base ('/dsh-ide-git/api') would escape the mount and
  // 404 behind any strict prefix-stripping proxy.
  const match = client.match(/const API_BASE = '([^']+)'/)
  assert.ok(match, 'API_BASE declaration missing')
  const base = match[1]
  assert.ok(!base.startsWith('/'), 'API_BASE must be document-relative, not origin-absolute: ' + base)
  // Resolve the SHIPPED constant exactly the way the browser does, under both
  // serving shapes: a prefix-stripping proxy mount and the origin root.
  assert.equal(
    new URL(base + '/repos', 'http://dsh.internal/dsh/').pathname,
    '/dsh/dsh-ide-git/api/repos',
    'under a sub-path mount the call must stay inside the mount',
  )
  assert.equal(
    new URL(base + '/repos', 'http://dsh.internal/').pathname,
    '/dsh-ide-git/api/repos',
    'at the origin root the call must keep today\'s upstream path',
  )
  // The desktop renderer is the other document owner: it loads dsh-app://app/
  // and injects no <base> (its document directory already is the root), so the
  // relative form has to resolve to exactly the absolute form it replaced.
  assert.equal(
    new URL(base + '/repos', 'dsh-app://app/').href,
    new URL('/' + base + '/repos', 'dsh-app://app/').href,
    'the desktop document base must not change what the call resolves to',
  )
})

test('plugin API calls fall back to the remote pairing proxy on auth rejection (issue #9)', () => {
  // dsh-remote-web-ui's browser channel rewrites only the host's own /api/,
  // /sidebar/, /git/ and /pet/ prefixes onto its /remote/ proxy — a
  // plugin-owned route is not on the list, so from a paired remote client the
  // direct call reaches the harness browser-auth gate and comes back
  // 401/403 'forbidden' (both the sidebar tab and the dock panel refused to
  // open). The fix retries the same request through the proxy, which serves
  // any loopback path under /remote/<full pathname> with the device
  // credentials — admitted by our own loopback fence.
  const core = client.slice(
    client.indexOf('/* ---- remote channel fallback core'),
    client.indexOf('/* ---- end remote channel fallback core'))
  assert.ok(core.length > 200, 'the pure fallback core must exist in the client half')
  // URL shape mirrors the boot patch exactly: '/remote' + the request's FULL
  // pathname (mount prefix included) + search — resolved through the same
  // base the direct fetch used (document.baseURI, which honours <base href>).
  const helpers = new Function('window', 'document', core
    + '\nreturn { remoteFallbackUrl: remoteFallbackUrl, isAuthRejection: isAuthRejection }')
  const atMount = helpers({ location: { href: 'http://dsh.internal/dsh/session' } },
    { baseURI: 'http://dsh.internal/dsh/' })
  assert.equal(atMount.remoteFallbackUrl('dsh-ide-git/api/resolve'),
    '/remote/dsh/dsh-ide-git/api/resolve', 'under a sub-path mount the retry stays inside the mount')
  const atRoot = helpers({ location: { href: 'http://dsh.internal/session/x' } },
    { baseURI: 'http://dsh.internal/' })
  assert.equal(atRoot.remoteFallbackUrl('dsh-ide-git/api/resolve'),
    '/remote/dsh-ide-git/api/resolve', 'at the origin root the retry keeps the plugin path')
  assert.equal(atRoot.remoteFallbackUrl('dsh-ide-git/api/list?q=1'),
    '/remote/dsh-ide-git/api/list?q=1', 'the query string survives the rewrite')
  // Without a document (SSR / exotic hosts) the page URL is the base, and
  // without either the catch branch degrades to a plain prefix.
  const pageBase = helpers({ location: { href: 'http://dsh.internal/dsh/session/' } }, undefined)
  assert.equal(pageBase.remoteFallbackUrl('dsh-ide-git/api/resolve'),
    '/remote/dsh/session/dsh-ide-git/api/resolve', 'the page URL resolves relative paths against its directory')
  const bare = helpers(undefined, undefined)
  assert.equal(bare.remoteFallbackUrl('dsh-ide-git/api/resolve'), '/remote/dsh-ide-git/api/resolve')
  assert.equal(bare.remoteFallbackUrl('/dsh-ide-git/api/resolve'), '/remote/dsh-ide-git/api/resolve',
    'a leading slash is not doubled')
  // Only the auth fence trips the retry; real answers (200, 404, 422…) are
  // never masked by a second request.
  for (const status of [401, 403]) assert.equal(bare.isAuthRejection(status), true)
  for (const status of [200, 400, 404, 422, 500]) assert.equal(bare.isAuthRejection(status), false)
  // The retry is sticky: once the proxy answered, later calls skip the doomed
  // direct round trip; a retry that is ITSELF an auth rejection never flips
  // the switch (a genuine cross-site refusal cannot be masked).
  const request = client.slice(client.indexOf('async function request(method, payload)'), client.indexOf('/* ============================== storage'))
  assert.match(request, /viaRemoteChannel === true/, 'sticky mode short-circuits the direct call')
  assert.match(request, /if \(isAuthRejection\(retried\.status\) !== true\) \{\n\s+viaRemoteChannel = true/, 'only a non-rejection from the proxy flips the sticky switch')
  assert.match(request, /const retried = await fetch\(remoteFallbackUrl\(direct\), init\)/, 'the retry reuses the same init (method, headers, body)')
})

/** One rule out of the client half's injected stylesheet, by exact selector. */
function cssRule(selector) {
  const start = client.indexOf("'" + selector + '{')
  assert.ok(start >= 0, 'stylesheet rule missing: ' + selector)
  const end = client.indexOf("'", start + 1)
  return client.slice(start + 1, end)
}

test('the rc.2 surface contract: theme-owned menu material on its own layer', () => {
  // dsh 0.1.7-rc.2 (docs/web-styling.md "Component rules") made the menu material
  // theme-owned: dropdown/context/selection menus take `--dsw-menu-surface-fill`
  // plus `--dsw-menu-backdrop-filter` (or, without MenuSurface's macOS backing,
  // `--dsw-specific-menu`, whose darwin fill is 94% opaque), and feature/platform
  // CSS must not override either. The old rule painted its own opaque layer fill,
  // borrowed `--dsh-any-blur-card-panels` as the filter and re-added a neutral
  // border under a hand-rolled shadow — all three are now guarded.
  const menu = cssRule('.dig-menu')
  assert.match(menu, /border:0/, 'an elevated surface carries the hairline inside its shadow, not a border')
  assert.doesNotMatch(menu, /background:var\(--dsw-alias-bg-layer-/, 'the menu must not override the theme material')
  assert.doesNotMatch(menu, /--dsh-any-/, 'platform CSS must not override the theme material')
  // Filtering stays on an isolated layer: on the card itself it would become the
  // backdrop root and the containing block of every descendant.
  const material = cssRule('.dig-menu::before')
  assert.match(material, /z-index:-1/, 'the material must paint on its own layer behind the rows')
  assert.match(material, /border-radius:inherit/)
  assert.match(material, /background:var\(--dsw-specific-menu,/)
  assert.match(material, /backdrop-filter:var\(--dsw-menu-backdrop-filter,/)
  assert.match(material, /pointer-events:none/)
  // Invariant 13 (panel-internal overlays) survives the restructure: the PANEL
  // anchor moved to the new `.dig-menu-wrap` (the submenu needs a shared
  // positioning parent), the card itself no longer carries position — but the
  // wrapper is still absolute inside `.dig-root`, the scroller is a separate
  // box, and the theme's dark-menu stroke hook rides the card exactly as
  // MenuSurface sets it.
  assert.match(cssRule('.dig-menu-wrap'), /position:absolute/)
  assert.match(menu, /isolation:isolate/)
  // border-box so `max-height: calc(100% - 8px)` caps the WHOLE card: content-box
  // sizing let the 8px of padding escape the cap, and a tall context menu in a
  // short bottom workbench (185px) stuck 4px past the panel edge. Measured with a
  // HEAD (v0.7.2) baseline tarball in the same instance: 187px of menu in a 185px
  // panel. The clamp only holds while BOTH declarations are present — border-box
  // alone would still let a 16px menu escape an 8px inset, and the 8px inset alone
  // only balances against `left/top >= 4` in ContextMenu.
  assert.match(menu, /box-sizing:border-box/)
  assert.match(menu, /max-height:calc\(100% - 8px\)/)
  assert.match(cssRule('.dig-menu-wrap'), /max-width:calc\(100% - 8px\)/)
  assert.match(client, /className: 'dig-menu-scroll'/)
  assert.match(client, /'data-menu-material': 'translucent'/)
  assert.doesNotMatch(client, /createPortal/, 'overlays must stay inside .dig-root')
})

test('the rc.2 surface contract: elevation instead of border plus shadow', () => {
  // "Never pair a `--dsw-alias-border-*` border with an lv/elevation shadow"
  // (docs/web-styling.md) — the 0.5px hairline is the first elevation layer.
  // Dialogs take the panel radius; the menu keeps the compact tier (outer R12,
  // 4px padding, R8 rows) from docs/ui-radius.md.
  for (const selector of ['.dig-menu', '.dig-dialog', '.dig-toast']) {
    const text = cssRule(selector)
    assert.match(text, /box-shadow:var\(--dsw-elevation-(prominent|panel)/, selector + ' must take a shared elevation')
    assert.doesNotMatch(text, /border:1px solid var\(--dsw-alias-border-/, selector + ' must not pair a neutral border with elevation')
  }
  assert.match(cssRule('.dig-menu'), /border-radius:var\(--dsw-radius-md,/)
  assert.match(cssRule('.dig-dialog'), /border-radius:var\(--dsw-radius-panel,/)
  // Modal masks keep the translucent dark fill and take their blur from the
  // theme (`--dsw-mask-blur` is `none`, so the declaration is a no-op today).
  assert.match(cssRule('.dig-overlay'), /backdrop-filter:var\(--dsw-mask-blur,/)
})

test('the rc.2 surface contract: one focus colour, radius tokens, round capsules', () => {
  // The theme owns `--dsw-focus-ring-color` / `--dsw-focus-ring-width` and blanks
  // the colour under `html[data-input-modality='pointer']` for everything that is
  // not `:read-write` (ui-theme/src/styles/focus.css), so a component may own its
  // offset and width but never its colour. The old rule used `:focus` with its own
  // colour, which painted a ring on pointer clicks too.
  assert.match(client, /\.dig-select:focus-visible\{outline:1px solid var\(--dsw-focus-ring-color,/)
  assert.doesNotMatch(client, /\.dig-select:focus\{outline:/, 'focus feedback must follow the input modality')
  // Text controls keep their own feedback (the shipped Input.module.css pattern:
  // outline:none plus a focus-within border colour) and use the shared colour.
  assert.match(client, /\.dig-input:focus\{border-color:var\(--dsw-alias-state-business-primary,/)
  assert.match(client, /\.dig-textarea:focus\{border-color:var\(--dsw-alias-state-business-primary,/)

  const css = client.slice(client.indexOf('const CSS = ['), client.indexOf('].join('))
  // docs/ui-radius.md: consume the named scale instead of local values, except
  // deliberate full-round shapes, which pair `corner-shape: round` in-rule so the
  // superellipse does not deform them.
  const radii = [...css.matchAll(/border-radius:([^;'}]+)/g)].map((match) => match[1].trim())
  assert.ok(radii.length >= 12, 'expected the radius scale to be consumed throughout, saw ' + radii.length)
  for (const value of radii) {
    assert.match(
      value,
      /^(var\(--dsw-radius-|calc\(var\(--dsw-radius-|inherit$|50%$|999px$)/,
      'off-scale radius literal (use a --dsw-radius-* token): ' + value,
    )
  }
  const capsules = [...css.matchAll(/border-radius:999px;([^}]*)/g)]
  assert.ok(capsules.length >= 3, 'expected the pill chips to survive, saw ' + capsules.length)
  for (const capsule of capsules) {
    assert.match(capsule[1], /corner-shape:round/, 'a full-round radius must pair corner-shape: round')
  }
  // Double-era posture: every rc.2 token needs a fallback, because the plugin
  // still installs on hosts that predate the scale (engines.dsh >= 0.1.2-0).
  for (const match of css.matchAll(/var\((--dsw-(?:radius|elevation|focus-ring|menu|mask|specific-menu)[a-z0-9-]*)\s*(,|\))/g)) {
    assert.equal(match[2], ',', 'rc.2 token without a fallback: ' + match[1])
  }
})

test('client half has three doors: better-sidebar, native right sidebar, conversation view tab', () => {
  assert.match(client, /const TAB_ID = 'dsh-ide-git:panel'/)
  assert.match(client, /single: true/)
  // Door 1 — dsh-better-sidebar, waited for through ctx.inject so a host that
  // loads it late still gets the tab (and the bottom workbench with it).
  assert.match(client, /ctx\.inject\(\['betterSidebar'\]/)
  assert.match(client, /betterSidebar\.registerTab\(\{/)
  // Door 2 — DSH's own right-sidebar seats, for a host running this plugin
  // alone. Both doors can never be open at once.
  // The native seats WAIT for their services (v0.5.3): the old synchronous
  // ctx.get() probe ran before ui-sidebar-right provided the registry on the
  // desktop app and on clean instances, then returned silently — no Git card,
  // no error. ctx.inject() re-registers the moment the services appear.
  assert.match(client, /ctx\.inject\(\['sidebarRightTabs', 'slots'\]/, 'native seats wait for their services')
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab'/)
  assert.match(client, /hostedByBetterSidebar/)
  // The base can be disabled AT RUNTIME: cordis unloads the inject effect,
  // and the cleanup must fall back to the native seats (v0.5.2 — the panel
  // used to vanish until the next reload when better-sidebar was toggled
  // off in the plugin panel).
  assert.match(client, /return \(\) => \{/)
  assert.match(client, /hostedByBetterSidebar = false/)
  assert.match(client, /hostNatively\(\)\n\s*\}/)
  assert.match(client, /inject: \[\], apply/)
  // Door 3 — the conversation-area view tab (issue #8), beside 对话/轨迹: the
  // ui-conversation `conversation.view` slot, the same contract dsh-context
  // rides. ON by default; the row Config's `conversationTab` switch in the
  // settings card drives it live (register/unregister, no reload), and a host
  // without the row Config keeps the tab (no editor surface exists there).
  assert.match(client, /const CONVERSATION_VIEW_ID = 'ide-git'/)
  assert.match(client, /const conversationTabEnabled = \(\) => \{/)
  assert.match(client, /return value !== false/, 'an absent or true field means the tab is shown')
  assert.match(client, /slots\.inject\('conversation\.view', \(\) => slots\.register\(/)
  assert.match(client, /name: 'conversation\.view', id: CONVERSATION_VIEW_ID, order: 30, locale: LOCALE_NS/)
  // The seat follows the setting live through the rail-config watchers.
  assert.match(client, /const unsubscribe = subscribeRailConfig\(sync\)/)
  const registrations = client.match(/registerTab\(/g) || []
  assert.equal(registrations.length, 1)
  // v0.14: TWO native tab types — the main panel (with its guide entry) and
  // the preview tab (guide-less by design: it opens itself from a diff verb,
  // it is not a start-page destination).
  const nativeTypes = client.match(/tabs\.register\(\{/g) || []
  assert.equal(nativeTypes.length, 2, 'two native tab types: the main panel and the preview tab')
  assert.match(client, /const NATIVE_PREVIEW_ID = 'dsh-ide-git-preview'/)
  assert.match(client, /keepMounted: true/, 'the preview tab keeps its body across tab switches')
  assert.doesNotMatch(client, /NATIVE_PREVIEW_ID,\n\s*kind: NATIVE_PREVIEW_KIND,\n\s*title: \(\) => t\('preview\.title'\),\n\s*keepMounted: true,\n\s*guide:/,
    'the preview tab carries no guide entry (it is not a start-page destination)')
  const slotSeats = client.match(/slots\.register\(/g) || []
  assert.equal(slotSeats.length, 4, 'four keyed-slot seats: native pane, preview pane, settings card, conversation view')
})

test('host half is an ESM cordis plugin with argv-only git calls', () => {
  assert.match(host, /export const name = 'dsh-ide-git'/)
  assert.match(host, /export const inject = \['webServer', 'connection', 'workspaceRegistry'\]/)
  assert.match(host, /export function apply\(ctx\)/)
  assert.match(host, /ctx\.webServer\.register\(\{ kind: 'prefix', path: ROUTE_PREFIX/)
  assert.match(host, /spawn\(gitBinary\(\), args, \{ cwd/)
  assert.doesNotMatch(host, /(^|[^.\w])exec\(/m, 'no shell exec')
  assert.doesNotMatch(host, /execSync\(|shell:\s*true/, 'no shell exec / shell:true')
  assert.doesNotMatch(host, /from '(?!node:)/, 'host half may only import node: builtins')
})

test('host half keeps the destructive-confirm guards', () => {
  for (const needle of [
    'push requires confirm: true',
    'hard reset requires confirm: true',
    'force delete requires confirm: true',
    'discarding untracked files requires confirm: true',
    'dropping a stash requires confirm: true',
  ]) {
    assert.ok(host.includes(needle), 'missing guard: ' + needle)
  }
})

test('host half exposes the method table the client calls', () => {
  const methods = ['summary', 'stats', 'branches', 'log', 'commitDetail', 'diff', 'compare', 'repos', 'roots', 'stage', 'unstage', 'discard', 'commit', 'checkout', 'branchCreate', 'branchRename', 'branchDelete', 'merge', 'rebase', 'cherryPick', 'revert', 'reset', 'fetch', 'pull', 'push', 'stashList', 'stashPush', 'stashApply', 'stashDrop', 'tagCreate', 'tagDelete', 'tagDeleteRemote', 'pushTags', 'clone', 'gitLogs', 'remoteAdd', 'remoteRemove', 'branchDeleteRemote', 'rebaseAbort', 'stashClear', 'undoList', 'undoApply', 'version']
  for (const method of methods) {
    assert.match(host, new RegExp('^  ' + method + ',$', 'm'), 'host method missing: ' + method)
  }
  for (const call of client.match(/request\('([a-zA-Z]+)'/g) || []) {
    const method = call.slice(call.indexOf("'") + 1, call.length - 1)
    assert.ok(methods.includes(method), 'client calls an unregistered method: ' + method)
  }
})

test('host half serialises writes and refuses the dangerous cases', () => {
  for (const needle of [
    'const WRITE_METHODS = new Set([',
    'function withRepoLock(key, work) {',
    "const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk'])",
    "refusing to delete the checked-out branch",
    "'deleting \"' + name + '\" requires confirm: true'",
    'function pushUndo(root, entry) {',
    'async function operationOf(root) {',
  ]) {
    assert.ok(host.includes(needle), 'missing safety guard: ' + needle)
  }
  // '.' would wipe every untracked file at once; the panel only ever discards
  // explicit paths, so the root is filtered out before git sees it.
  assert.ok(host.includes("entry !== '.' && entry !== './'"), 'discard must not accept the repository root')
})

test('client half offers an undo toast and a safe confirm', () => {
  for (const needle of [
    'function ToastStack(props) {',
    "actionLabel: t('toast.undo'),",
    "request('undoApply'",
    'function isProtectedBranch(name) {',
    'requireText: guarded ? dialog.name : undefined,',
  ]) {
    assert.ok(client.includes(needle), 'missing client guard: ' + needle)
  }
  // Destructive dialogs must not open with focus on the red button.
  assert.match(client, /cancelRef\.current\.focus\(\)/, 'confirm dialog must focus cancel')
})

test('a discard is reversible through the same undo stack', () => {
  // Overwriting the working tree is a destructive action like any other: the
  // host snapshots the bytes first, and says so honestly when it cannot.
  for (const needle of [
    'function snapshotForUndo(root, paths) {',
    'function snapshotState(root, files) {',
    "kind: 'discard'",
    'undoBlocked: true',
    'UNDO_MAX_SNAPSHOT_BYTES',
  ]) {
    assert.ok(host.includes(needle), 'missing host guard: ' + needle)
  }
  for (const needle of [
    "t('toast.discarded')",
    'data.undoBlocked === true',
    "'undo.discard'",
    'void discardChanges(item, group)',
  ]) {
    assert.ok(client.includes(needle), 'missing client guard: ' + needle)
  }
})

test('the dock actions exist only where the right sidebar can perform them', () => {
  // The official right sidebar is read at RENDER time: ctx.get('sidebarRight')
  // returns undefined while ui-sidebar-right has not mounted yet (measured on
  // 0.1.7-rc.2), and a host running dsh-better-sidebar or an old host has none at
  // all. Missing service = no buttons, no error.
  const start = client.indexOf('/* ---- dock action core')
  const end = client.indexOf('/* ---- end dock action core')
  assert.ok(start >= 0 && end > start, 'the dock action core must keep its markers')
  const core = new Function(client.slice(start, end)
    + '\nreturn { dockFaceOf: dockFaceOf, dockActionState: dockActionState }')()

  const service = { float: () => {}, dock: () => {}, split: () => {}, toggleFullscreen: () => {} }
  assert.equal(core.dockFaceOf(null), null, 'no ctx means no dock actions')
  assert.equal(core.dockFaceOf({ get: () => undefined }), null, 'a host without sidebarRight degrades silently')
  assert.equal(core.dockFaceOf({ get: () => { throw new Error('late service') } }), null, 'a throwing ctx.get must not escape')
  assert.equal(core.dockFaceOf({ get: () => ({ float: () => {} }) }), null, 'half a service is not a service')
  assert.equal(core.dockFaceOf({ get: () => service }), service)

  const off = core.dockActionState(null, null)
  assert.deepEqual([off.wired, off.float, off.split, off.fullscreen], [false, false, false, false],
    'an unwired panel offers none of the dock actions')
  const docked = core.dockActionState({ service: service, tabId: 'tab3', paneId: 'pane1' }, null)
  assert.deepEqual([docked.wired, docked.float, docked.split, docked.fullscreen, docked.floating], [true, true, true, true, false])
  const floating = core.dockActionState({ service: service, tabId: 'tab3', paneId: 'float4' }, 'float4')
  assert.deepEqual([floating.float, floating.split, floating.floating], [true, false, true],
    'a floating panel can be docked back, but not split again')
  assert.equal(core.dockActionState({ service: service, tabId: '' }, null).wired, false, 'a tab without an id is not floatable')
})

test('the tree toggle is reachable again after it was folded', () => {
  // treeOpen is persisted, so a header button that only rendered while the tree
  // was OPEN left a folded tree with no way back (a workspace could only be
  // repaired by clearing localStorage). The header button is two-way now, and the
  // rail carries the action for the chromes that have no header button.
  const bar = client.slice(client.indexOf("className: 'dig-compact-bar'"), client.indexOf("className: 'dig-compact-bar'") + 1400)
  assert.match(bar, /'data-action': 'tree'/, 'the compact header keeps a tree control')
  assert.match(bar, /onClick: \(\) => foldTree\(!treeOpen\)/, 'and it toggles BOTH ways')
  assert.match(bar, /'aria-pressed': treeOpen \? 'true' : 'false'/)
  assert.match(bar, /E\(Icon, \{ name: treeOpen \? 'eye' : 'eyeOff' \}\)/, 'the icon distinguishes the two states')
  assert.doesNotMatch(client, /treeOpen \? E\('button'/, 'no chrome may render its tree control only while the tree is open')

  const specs = client.slice(client.indexOf('const RAIL_SPECS = ['), client.indexOf('const RAIL_IDS ='))
  for (const id of ['tree', 'float', 'split', 'fullscreen']) {
    assert.match(specs, new RegExp("\\{ id: '" + id + "'"), 'RAIL_SPECS must carry the ' + id + ' action')
  }
  assert.match(client, /const RAIL_VIEW_IDS = \['tree', 'float', 'split', 'fullscreen'\]/,
    'view actions must stay clickable while a git command runs')
  assert.match(client, /action\.available !== false/, 'an action this mount cannot perform is not rendered at all')
})

test('the dock actions are wired on the native seat only', () => {
  // Door 2 (the native right-sidebar seat) owns a sidebarRight tab id; door 1
  // (dsh-better-sidebar) does not, and floating a foreign tab id is not a thing.
  assert.match(client, /readDockInfo\(props\.useTabInfo, props\.ctx\)/, 'the native seat reads its own tab identity')
  const better = client.slice(client.indexOf('betterSidebar.registerTab({'), client.indexOf('dsh-ide-git: Git tab'))
  assert.doesNotMatch(better, /dock:/, 'the better-sidebar door must not wire dock actions')
  assert.match(client, /try \{ info = useTabInfo\(\) \} catch \(error\) \{ void error \}/,
    'the slot reader throws until the tab is committed; a missing answer is a missing button')
  assert.match(client, /node\.closest\('\[data-dockkit-float\]'\)/, 'the float state comes from the float layer marker')
})

test('every shipped dictionary carries the same key set as zh', () => {
  // A locale block is preceded by a /* locale: <tag> */ marker, so the blocks
  // can be sliced without parsing the file. Equality matters because a key
  // missing from a third language falls back to English at lookup time — a
  // silent half-translated panel, which is exactly what this catches.
  //
  // Each block is cut at its OWN closing brace: the text after the last
  // dictionary is ordinary code, and a perfectly innocent `'data-action': 'tree',`
  // in a component reads exactly like a dictionary entry to a line scanner.
  const keyLines = (segment) => [...segment.matchAll(/^ +'([^']+)': '/gm)].map((match) => match[1]).sort()
  const bodyOf = (segment) => {
    const start = segment.indexOf('{')
    let depth = 0
    for (let index = start; index < segment.length; index += 1) {
      if (segment[index] === '{') depth += 1
      else if (segment[index] === '}') {
        depth -= 1
        if (depth === 0) return segment.slice(start, index + 1)
      }
    }
    throw new Error('unterminated dictionary')
  }
  const zhSegment = client.slice(client.indexOf('const ZH = {'), client.indexOf('const EN = {'))
  const zhKeys = keyLines(zhSegment)
  assert.ok(zhKeys.length >= 140, 'the zh dictionary looks truncated: ' + zhKeys.length)

  const parts = client.split('/* locale: ')
  assert.ok(parts.length - 1 >= 3, 'expected at least three third-language dictionaries, saw ' + (parts.length - 1))
  for (let index = 1; index < parts.length; index += 1) {
    const tag = parts[index].slice(0, parts[index].indexOf(' */'))
    assert.deepEqual(keyLines(bodyOf(parts[index])), zhKeys, 'dictionary ' + tag + ' does not match the zh key set')
  }
})

test('changelog tracks the current version', () => {
  assert.match(changelog, new RegExp('^## v' + pkg.version.replace(/\./g, '\\.') + ' — \\d{4}-\\d{2}-\\d{2}$', 'm'))
  assert.ok(exists('README.md') && exists('README_EN.md') && exists('LICENSE'))
})

test('markdown stays well-formed: fences paired, files newline-terminated', () => {
  // 2026-09-14: README 的 8 个代码围栏被写成「反引号 + @」,GitHub 上「安装」整段错乱。
  // README 是别人看到的第一屏,在这之前没有任何测试看着它。
  const fence = '`'.repeat(3)
  for (const name of ['README.md', 'README_EN.md', 'CHANGELOG.md']) {
    const lines = read(name).split('\n')
    assert.ok(!lines.some((line) => line.startsWith('`@')), name + ' has a half-typed fence')
    assert.ok(read(name).endsWith('\n'), name + ' must end with a newline')
    const fences = lines.filter((line) => line.startsWith(fence))
    assert.equal(fences.length % 2, 0, name + ' has an unpaired code fence')
    for (const line of fences) {
      assert.match(line, /^`{3,4}[a-zA-Z0-9]*$/, name + ' has a malformed fence: ' + line)
    }
  }
})
test('client half exposes t(key), never the raw dictionary object', () => {
  assert.match(client, /const t = translatorOf\(ctx\)/, 't must be a live lookup function')
  assert.match(client, /function translatorOf\(ctx\) \{/, 'the live lookup itself must exist')
  assert.match(client, /function dictionaryFor\(active\)/, 'locale tags must resolve through dictionaryFor')
  assert.match(client, /locale\.subscribe\(/, 'the panel must repaint on a live language switch')
  assert.doesNotMatch(client, /const t = dictionaryOf\(/, 't must not be the dictionary itself')
  assert.doesNotMatch(client, /const dict = dictionaryOf\(ctx\)/, 'the dictionary must not be captured once at activation')

  const block = (name) => {
    const start = client.indexOf('const ' + name + ' = {')
    assert.ok(start >= 0, name + ' dictionary missing')
    let depth = 0
    for (let index = client.indexOf('{', start); index < client.length; index += 1) {
      if (client[index] === '{') depth += 1
      else if (client[index] === '}') {
        depth -= 1
        if (depth === 0) return client.slice(start, index + 1)
      }
    }
    throw new Error('unterminated ' + name)
  }

  const keys = new Set()
  for (const match of client.matchAll(/\bt\('([^']+)'\)/g)) keys.add(match[1])
  assert.ok(keys.size >= 30, 'expected many looked-up keys, saw ' + keys.size)
  for (const name of ['ZH', 'EN']) {
    const text = block(name)
    for (const key of keys) {
      assert.ok(text.includes("'" + key + "':"), name + ' is missing the key ' + key)
    }
  }
})

/* ---------------------------------------------------------------------------
 * Draggable panes (issue #5).
 *
 * The sizing core sits between two markers as a PURE block (no window, no DOM,
 * no React), so these tests slice it out and drive the real implementation —
 * a re-implemented clamp in the test would only ever agree with itself.
 * ------------------------------------------------------------------------- */

function paneCore() {
  const start = client.indexOf('/* ---- pane sizing core')
  const end = client.indexOf('/* ---- end pane sizing core')
  assert.ok(start >= 0 && end > start, 'the pane sizing core must keep its markers')
  const exported = 'return { PANES_KEY: PANES_KEY, PANE_LIMITS: PANE_LIMITS, PANE_DEFAULTS: PANE_DEFAULTS,'
    + ' PANE_CHROME_KEYS: PANE_CHROME_KEYS, PANE_BUCKETS: PANE_BUCKETS, PANE_GUTTER_PX: PANE_GUTTER_PX,'
    + ' PANE_MAIN_FLOOR_PX: PANE_MAIN_FLOOR_PX,'
    + ' panBucket: panBucket, normalizePanes: normalizePanes, withPaneRatio: withPaneRatio, paneGeometry: paneGeometry }'
  return new Function(client.slice(start, end) + '\n' + exported)()
}

test('pane sizes are stored per surface under one versioned key', () => {
  assert.match(client, /const PANES_KEY = 'dsh-ide-git\.panes\.v1'/)
  assert.match(client, /localStorage\.getItem\(PANES_KEY\)/, 'reads must go through the versioned key')
  assert.match(client, /localStorage\.setItem\(PANES_KEY, JSON\.stringify\(normalizePanes\(config\)\)\)/,
    'writes must be normalised too, and wrapped in try/catch')

  const core = paneCore()
  // Six buckets: the bottom workbench and the right sidebar must never share a
  // remembered size, even when they run the same chrome.
  assert.deepEqual(core.PANE_BUCKETS, [
    'columns:wide', 'columns:tall', 'stack:wide', 'stack:tall', 'compact:wide', 'compact:tall',
  ])
  assert.equal(core.panBucket('stack', { width: 500, height: 900 }), 'stack:tall')
  assert.equal(core.panBucket('stack', { width: 900, height: 500 }), 'stack:wide')
  assert.equal(core.panBucket('compact', { width: 300, height: 300 }), 'compact:wide', 'a square panel is not tall')
})

test('normalizePanes drops unknown buckets, unknown keys and out-of-range ratios', () => {
  const core = paneCore()
  assert.deepEqual(core.normalizePanes(null), { treeOpen: true, panes: {} }, 'the tree stays open by default')
  assert.deepEqual(core.normalizePanes('nope'), { treeOpen: true, panes: {} })
  assert.deepEqual(core.normalizePanes({ panes: 7 }), { treeOpen: true, panes: {} })

  const clean = core.normalizePanes({
    treeOpen: false,
    panes: {
      'stack:tall': { tree: 0.3, changes: 'wide', diff: 0, ghost: 0.5 },
      'stack:wide': { tree: 1.2, changes: -0.1, diff: Number.NaN },
      'stack:tallish': { tree: 0.5 },
      bogus: { tree: 0.5 },
    },
  })
  assert.equal(clean.treeOpen, false, 'a folded tree is remembered')
  assert.deepEqual(clean.panes, { 'stack:tall': { tree: 0.3 } },
    'only finite ratios in (0, 1] on known keys survive')

  const one = core.withPaneRatio(clean, 'stack:tall', 'diff', 0.44)
  assert.deepEqual(one.panes['stack:tall'], { tree: 0.3, diff: 0.44 })
  assert.equal(one.treeOpen, false, 'the tree state rides along with the sizes')
  assert.deepEqual(core.withPaneRatio(one, 'stack:tall', 'diff', null).panes['stack:tall'], { tree: 0.3 },
    'a double-click reset removes the override')
  const emptied = core.withPaneRatio(core.withPaneRatio(one, 'stack:tall', 'tree', null), 'stack:tall', 'diff', null)
  assert.equal(emptied.panes['stack:tall'], undefined, 'an emptied bucket is not stored at all')
  assert.deepEqual(clean.panes['stack:tall'], { tree: 0.3 }, 'the update must not mutate its input')
})

test('the pane clamps hold at both ends and never shrink a pane below its own box', () => {
  const core = paneCore()
  const tall = { width: 500, height: 900 }

  // Nothing stored → no inline override at all: the stylesheet default (200px
  // tree, 290px changes, the percentage caps) keeps rendering as before.
  const fresh = core.paneGeometry('stack', tall, core.normalizePanes(null))
  assert.deepEqual(fresh.overrides, {})
  assert.equal(fresh.bucket, 'stack:tall')

  // Stored ratios become px, and every one of them obeys its own limits. With
  // 0.9 asked for all three, the two stacked panes stop exactly where the middle
  // pane's hard floor begins: 900 - 16 (gutters) - 120 = 764 for tree + changes.
  const stored = core.normalizePanes({ panes: { 'stack:tall': { tree: 0.9, changes: 0.9, diff: 0.9 } } })
  const geo = core.paneGeometry('stack', tall, stored)
  assert.equal(geo.overrides.changes, 440, 'the changes pane stops where the middle pane begins')
  assert.equal(geo.overrides.tree, 324, 'the tree gives way to the pane it shares the column with')
  assert.equal(geo.overrides.diff, 120, 'the diff can never eat the history list')
  assert.equal(geo.limits.diff.max, 120)
  assert.equal(tall.height - geo.overrides.tree - geo.overrides.changes - 2 * core.PANE_GUTTER_PX, core.PANE_MAIN_FLOOR_PX,
    'the middle pane keeps exactly its hard floor when both stacked panes are maxed')

  // Tiny stored ratios clamp UP to the minimums, never to 0.
  const tiny = core.paneGeometry('stack', tall, core.normalizePanes({ panes: { 'stack:tall': { tree: 0.001, changes: 0.001 } } }))
  assert.equal(tiny.overrides.tree, core.PANE_LIMITS['stack:tree'].min)
  assert.equal(tiny.overrides.changes, core.PANE_LIMITS['stack:changes'].min)

  // A huge container still stops at the absolute maxima...
  const roomy = core.paneGeometry('columns', { width: 3000, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { tree: 1, changes: 1 } } }))
  assert.equal(roomy.overrides.tree, core.PANE_LIMITS['columns:tree'].max)
  assert.equal(roomy.overrides.changes, core.PANE_LIMITS['columns:changes'].max)
  // ...and a container that cannot hold every default at once hands out what is
  // left, still leaving the middle pane its floor — no overflow.
  const fit = core.paneGeometry('columns', { width: 700, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { tree: 1, changes: 1 } } }))
  assert.equal(700 - fit.overrides.tree - fit.overrides.changes - 2 * core.PANE_GUTTER_PX, core.PANE_MAIN_FLOOR_PX)

  // The 674px column of the reported bug (issue #5 follow-up): 200 + 290 + 240
  // cannot all hold, and the OLD ceiling (140) came out below the tree's own 201.
  // The ceiling now never goes below the box a pane already occupies, so the
  // first drag to the right can only GROW it.
  const boxes = { tree: 201, changes: 291 }
  const pinned = core.paneGeometry('columns', { width: 674, height: 482 }, core.normalizePanes(null), boxes)
  assert.equal(pinned.bucket, 'columns:wide')
  assert.ok(pinned.limits.tree.max > boxes.tree, 'the tree keeps room to grow (max ' + pinned.limits.tree.max + ' vs ' + boxes.tree + ')')
  assert.ok(pinned.limits.tree.max - boxes.tree >= 20, 'and it is a usable step, not a token pixel')
  assert.ok(pinned.limits.tree.max >= core.PANE_DEFAULTS['columns:tree'].px, 'the ceiling is never below the pane\'s own default')
  assert.ok(pinned.limits.tree.now === undefined || pinned.limits.tree.now <= pinned.limits.tree.max)
  assert.equal(674 - 2 * core.PANE_GUTTER_PX - pinned.limits.tree.max - boxes.changes, core.PANE_MAIN_FLOOR_PX,
    'the relaxed tier still keeps the middle pane its floor')

  // A folded tree frees its room instead of reserving it, and has no override.
  const folded = core.paneGeometry('stack', tall, core.normalizePanes({ treeOpen: false, panes: { 'stack:tall': { changes: 1 } } }))
  assert.equal(folded.overrides.tree, undefined)
  assert.equal(folded.overrides.changes, core.PANE_LIMITS['stack:changes'].max)
})

test('the pane dividers are draggable, touch-safe and keyboard reachable', () => {
  const gutter = cssRule('.dig-gutter')
  assert.match(gutter, /touch-action:none/, 'a touch drag must resize the pane, not scroll the panel')
  assert.match(cssRule('.dig-gutter-v'), /width:8px/, 'the hit area is wider than the hairline it paints')
  assert.match(cssRule('.dig-gutter-h'), /height:8px/)
  assert.match(cssRule('.dig-gutter::after'), /var\(--dsw-alias-hairline,/, 'the hairline keeps the theme token')
  assert.match(client, /setPointerCapture/, 'the drag must survive leaving the hit area')
  assert.match(client, /\.dig-pane-dragging,\.dig-pane-dragging \*\{user-select:none\}/, 'no text selection while dragging')
  assert.match(client, /onLostPointerCapture/, 'a dropped capture must still finish the gesture')
  // Double-click resets and the arrow keys nudge (Shift = 4x).
  assert.match(client, /onDoubleClick: \(\) => props\.onReset\(\)/)
  assert.match(client, /const step = event\.shiftKey === true \? 32 : 8/)
  assert.match(client, /role: 'separator'/)
})

test('a divider only exists when it can move something', () => {
  // v0.8.0 shipped the history↔diff divider as a dead control: it wrote storage
  // and moved its own aria while the diff pane never got the inline size (the
  // render ignored it). That part stays locked below. The second half used to
  // lock the OPPOSITE of today's behaviour: the columns chrome's key set had no
  // diff pane, so its diff window (fixed max-height:55%) could not be resized
  // at all — user report. Every chrome now hands out a real diff window; the
  // diff keeps measuring HEIGHT even where the chrome runs sideways.
  assert.match(client, /className: 'dig-diff-pane', 'data-pane': 'diff', style: paneStyle\('diff'\)/,
    'the diff pane must actually consume the stored size')
  assert.match(client, /if \(limit === undefined \|\| limit\.max <= limit\.min\) return null/,
    'no pane in this chrome, or no travel in either direction, means no divider element')
  assert.match(client, /value: Math\.min\(Math\.max\(Math\.round\(paneLayout\.effective\[key\]/, 'aria-valuenow is clamped into the window it announces')
  const core = paneCore()
  assert.deepEqual(core.PANE_CHROME_KEYS.columns, ['tree', 'changes', 'diff'])
  assert.ok(core.PANE_LIMITS['columns:diff'] !== undefined, 'the columns chrome has a diff window to hand out')
  const columns = core.paneGeometry('columns', { width: 700, height: 400 }, core.normalizePanes(null), { diff: 150 })
  assert.ok(columns.limits.diff !== undefined && columns.limits.diff.max > columns.limits.diff.min,
    'the columns chrome hands out a real diff window')
  const stacked = core.paneGeometry('stack', { width: 700, height: 800 }, core.normalizePanes(null), { diff: 150 })
  assert.ok(stacked.limits.diff !== undefined && stacked.limits.diff.max > stacked.limits.diff.min,
    'while the stacked chrome hands out a real diff window')

  // The columns diff divides the body HEIGHT, not the chrome's own width
  // dimension: 0.5 of a 400px-tall body lands at 200px even in a 1000px-wide
  // panel (and the history list keeps its 120px floor: ceiling 280).
  const wide = core.paneGeometry('columns', { width: 1000, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { diff: 0.5 } } }), { diff: 150 })
  assert.equal(wide.overrides.diff, 200, 'a columns diff ratio converts against the body height')
})

test('a rail switch writes exactly its own field, and a refused write rolls back', () => {
  // task-30. Three shapes are locked here because each one produced a switch
  // that lied about the Host's document:
  //  1. one field per write — a whole-config write derived from a stale render
  //     clobbers a sibling toggled a moment earlier (measured: 4 of 16 rapid
  //     toggles never reached the row Config);
  //  2. the user's intent is kept SYNCHRONOUSLY — two clicks inside one frame
  //     both read the pre-click snapshot, so the second click recomputed the
  //     same target and the toggle was lost (a fast double click netted one step);
  //  3. a refused/failed write puts the switch back and says so — never a switch
  //     that stays flipped while the Host still holds the old value.
  const core = client.slice(client.indexOf('/* ---- rail config core'), client.indexOf('/* ---- end rail config core'))
  const helpers = new Function('RAIL_IDS', core
    + '\nreturn { railFieldOf: railFieldOf, railIdOfField: railIdOfField }')(['refresh', 'tree', 'float', 'newBranch'])
  for (const id of ['refresh', 'tree', 'float', 'newBranch']) {
    assert.equal(helpers.railIdOfField(helpers.railFieldOf(id)), id, 'railIdOfField must invert railFieldOf for ' + id)
  }
  assert.equal(helpers.railIdOfField('railNope'), null, 'a field no action owns must not become a row-Config key')
  assert.equal(helpers.railIdOfField('rail'), null)

  const writer = client.slice(client.indexOf('function writeRailFields('), client.indexOf('/* One-shot move of the pre-settings rail config'))
  assert.ok(writer.length > 300, 'writeRailFields must exist')
  assert.match(writer, /active\.mutate\(ops\)/, 'a burst is submitted as ONE atomic mutation')
  assert.match(writer, /if \(ready\.writable !== true \|\| typeof active\.mutate !== 'function'\) return \{ sent: false, reason: 'read-only' \}/,
    'a read-only document must refuse instead of pretending')
  assert.match(writer, /if \(railForm !== null\) return \{ sent: false, reason: 'not-ready' \}/,
    'a config surface that has not answered yet must refuse rather than fall through to the legacy home')
  assert.match(writer, /railIdOfField\(String\(op\.path\[0\]\)\)/, 'the legacy branch addresses ids through the inverse map')
  assert.match(client, /function writeRailField\(field, value, form\) \{\n\s+return writeRailFields\(\[\{ op: 'set', path: \[field\], value: value \}\], form\)/,
    'the single-field writer is a wrapper over the batched one')

  const card = client.slice(client.indexOf('function RailSettingsCard('), client.indexOf('function RailSettings('))
  assert.match(card, /const intent = useRef\(\{\}\)/, 'the intent map must live in a ref (synchronous, survives re-render)')
  assert.match(card, /Object\.prototype\.hasOwnProperty\.call\(intent\.current, field\)/,
    'both shown() and toggle() must read the synchronous intent before the snapshot')
  assert.match(card, /const FLUSH_MS = 250|FLUSH_MS/, 'the write window is a named constant')
  assert.match(card, /const dirty = useRef\(new Map\(\)\)/, 'the card collects touched fields WITH their target')
  assert.match(card, /dirty\.current\.set\(field, wanted\)/, 'the target is recorded per field')
  // The accepted document can already agree with the user's new value, which
  // clears the optimistic intent before the flush runs; a flush reading the
  // render-time intent would then submit the OPPOSITE of the click (measured: a
  // fast double click wrote the switch back to false).
  assert.match(card, /const targets = new Map\(dirty\.current\)/, 'the flush reads the recorded targets, not the render-time intent')
  assert.match(card, /value: targets\.get\(field\) === true/, 'the submitted value comes from the recorded target')
  assert.match(card, /scheduleFlush\(\)/, 'a toggle schedules a flush instead of writing immediately')
  assert.match(card, /const outcome = writeRailFields\(ops, scope\)/, 'the flush submits the whole burst at once')
  assert.match(card, /const rollbackFields = \(fields\) => \{/, 'a refused or failed batch has a rollback')
  assert.match(card, /delete intent\.current\[field\]/, 'the rollback clears the optimistic intent')
  assert.match(card, /if \(accepted !== true\) \{/, 'the settled promise decides whether to roll back')
  assert.match(card, /const reconcile = \(field, want, attempt\) => \{/, 'the card reconciles against the accepted document')
  assert.match(card, /if \(hostValue === want\) return/, 'a converged field needs no further work')
  assert.match(card, /if \(attempt === 0\) \{/, 'a lost write is re-issued exactly once')
  // The control's own answer is the TARGET; inverting it writes the opposite.
  assert.match(card, /const wanted = fromControl !== null/, 'the control value is the target when available')
  assert.match(card, /\? fromControl\n/, 'fromControl is used as-is, never inverted')
  assert.match(card, /typeof event\.target\.checked === 'boolean'/, 'the control is read through the event, with a fallback for the label span')
  assert.match(card, /reconcile\(field, targets\.get\(field\) === true, 0\)/, 'every accepted batch schedules the check against its target')
  assert.match(card, /for \(const timer of Array\.from\(timers\.current\)\) clearTimeout\(timer\)/, 'unmount clears pending checks')
  assert.match(card, /t\('settings\.rail\.writeFailed'\)/, 'a refused write is told to the user')
  assert.match(card, /t\('settings\.rail\.readonly'\)/, 'a read-only host is told to the user')
  assert.match(card, /disabled: readOnly === true/, 'read-only switches are disabled, not dead controls')

  // Both new sentences exist in every dictionary (the key-set test would also
  // catch a missing one, but a named guard says WHY it must stay).
  for (const key of ['settings.rail.writeFailed', 'settings.rail.readonly']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 22, key + ' must ship in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }

  // The placement switch (issue #8) rides the same optimistic-write contract.
  assert.match(card, /'data-placement-row': field/, 'the placement row is addressable')
  assert.match(card, /const field = 'conversationTab'/, 'one row-Config field backs the switch')
  assert.match(card, /values\[field\] !== false/, 'an absent value means the default: shown')
  assert.match(host, /shape\.conversationTab = live\(schema\.boolean\(\)\.default\(true\)\)/,
    'the host schema declares the field with default true')
  // The immersive switch (issue #8 round 3): the SAME contract, and the SAME
  // trap — a client-side field the host schema does not declare is rejected by
  // the Host's volatility check ("Config field … is not volatile"), the mutate
  // fails without any console noise, and the switch silently rolls back. Both
  // halves must declare the field; both defaults must be true.
  assert.match(card, /const field = 'immersive'/, 'the immersive switch is backed by its own row-Config field')
  assert.match(host, /shape\.immersive = live\(schema\.boolean\(\)\.default\(true\)\)/,
    'the host schema declares the immersive field with default true')
  for (const key of ['settings.placement.title', 'settings.placement.tab', 'settings.placement.tabHint',
    'settings.placement.immersive', 'settings.placement.immersiveHint']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 22, key + ' must ship in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }
})

test('the font scale rides the row Config, scales every font rule, and keeps row math exact', () => {
  // Appearance group: one percent value (100 = default), a stepper in the
  // settings card, the SAME volatility trap as the placement switches — the
  // Host rejects writes to paths the schema does not declare, so both halves
  // must carry the field.
  assert.match(host, /shape\.fontScale = live\(schema\.number\(\)\.default\(100\)\)/,
    'the host schema declares the fontScale field with default 100')
  const card = client.slice(client.indexOf('function RailSettingsCard('), client.indexOf('function RailSettings('))
  assert.match(card, /fold\('settings\.appearance\.title'/, 'the stepper lives in its own fold section')
  assert.match(card, /path: \[field\], value: clamped/, 'the stepper writes one clamped field per commit')
  assert.match(card, /applyFontScale\(clamped\)/, 'the panel re-scales optimistically, before the Host echoes')
  for (const key of ['settings.appearance.title', 'settings.font.label', 'settings.font.decrease',
    'settings.font.increase', 'settings.font.reset', 'settings.font.hint']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 22, key + ' must ship in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }

  const css = client.slice(client.indexOf('const CSS = ['), client.indexOf('].join('))
  assert.doesNotMatch(css, /font-size:\d+px/, 'every font-size literal rides the --dig-fs multiplier')
  // The virtualised lists window by EXACT pixel heights: the CSS pins read the
  // --dig-rh-* integers applyFontScale() publishes, and the JS math calls the
  // same helpers — a calc() on the raw multiplier would drift sub-pixel per
  // row and desynchronise the spacers over a long history.
  for (const pin of ['--dig-rh-commit', '--dig-rh-group', '--dig-rh-folder', '--dig-rh-row']) {
    assert.ok(css.indexOf('var(' + pin + ',') >= 0, 'the CSS pins the row to ' + pin)
  }
  assert.match(client, /function historyRowH\(scale\) \{ return fontRowsOf\(scale\)\.commit \+ 2 \}/,
    'the history row height comes from the shared helper')
  assert.match(client, /const rowH = historyRowH\(fontScale\)/, 'HistoryList windows by the scaled height')
  assert.match(client, /prev\.rowH === next\.rowH/, 'the memoised commit row re-renders on a scale change')
  assert.match(client, /const heights = itemHeights\(fontScale\)/, 'the changes list windows by the scaled heights')
  assert.match(client, /root\.style\.setProperty\('--dig-fs', String\(value \/ 100\)\)/,
    'applyFontScale publishes the multiplier')
  assert.match(client, /subscribeRailConfig\(\(\) => applyFontScale\(\)\)/,
    'a config change re-applies the scale live')
})

test('the settings card folds into collapsible sections, collapsed by default', () => {
  // The card's controls group into three functional domains behind fold headers
  // (action rail / placement / AI commit), all collapsed until clicked. The
  // component is HAND-DRAWN on purpose: the official disclosure row is not
  // reachable through this plugin's restricted require — dsh-gitbash-shell
  // v0.38.0-0.38.3 watched it silently degrade to a flat title+stack pile on a
  // real machine. The readonly/error notes stay OUTSIDE the folds: they are
  // status, not settings, and a collapsed section must never hide them.
  const card = client.slice(client.indexOf('function RailSettingsCard('), client.indexOf('function RailSettings('))
  assert.match(card, /const \[folds, setFolds\] = useState\(\{\}\)/,
    'the fold state is a hook, declared above every early return')
  assert.match(card, /className: 'dig-foldHead'/, 'each section header is a real button')
  assert.match(card, /'aria-expanded': open \? 'true' : 'false'/, 'the header announces its state to assistive tech')
  assert.match(card, /open \? E\('div', \{ className: 'dig-stack' \}, body\) : null/,
    'a collapsed section renders no body at all')
  for (const key of ['settings.rail.title', 'settings.placement.title', 'settings.appearance.title', 'settings.commit.title']) {
    assert.match(card, new RegExp("fold\\('" + key.replace(/\./g, '\\.') + "'"),
      'the ' + key + ' section header comes from the dictionary')
  }
  const titleOccurrences = client.split("'settings.rail.title'").length - 1
  assert.ok(titleOccurrences >= 22, 'settings.rail.title must ship in ZH + EN + every LOCALES entry (saw ' + titleOccurrences + ')')
  assert.doesNotMatch(card, /className: 'dig-settings-sub'/,
    'the flat section titles are gone, replaced by fold headers')
})

test('the ai commit message keeps the model honest and the input bounded', async () => {
  // Issue #6. Four shapes are locked here because each one has produced (or could
  // produce) a "false success" in this repository before:
  //  1. an adapter failure arrives as a terminal `finish`, NOT as a throw — so the
  //     collector must surface the finish and the caller must refuse to treat
  //     "no text" as "the model said nothing";
  //  2. the change set is bounded (per file, total, lock files, binaries) and the
  //     accounting is returned so the UI can say what the model did NOT see;
  //  3. the user's own instructions are DATA in the user message, never the system
  //     prompt, and they are capped;
  //  4. the reply is cleaned of the wrappers models habitually add.
  const start = host.indexOf('const COMMIT_MAX_PROMPT_CHARS')
  const end = host.indexOf('const METHODS = {')
  assert.ok(start >= 0 && end > start, 'the ai commit block must keep its bounds')
  const block = host.slice(start, end)
  const api = new Function(block + '\nreturn { collectCommitStream, commitInputOf, commitMessagesOf, cleanupCommitMessage, COMMIT_MAX_PROMPT_CHARS, COMMIT_TOTAL_BYTES, COMMIT_FILE_BYTES, COMMIT_FILE_LINES, COMMIT_MAX_FILES }')()

  // 1 — the finish is reported, whichever way the adapter failed.
  const ok = await api.collectCommitStream((async function* generate() {
    yield { type: 'text-delta', index: 0, text: 'feat: x' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  assert.equal(ok.text, 'feat: x')
  assert.equal(ok.finish.kind, 'stop')
  const failed = await api.collectCommitStream((async function* generate() {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'NO_CREDENTIAL', message: 'no API key' } } }
  })())
  assert.equal(failed.text, '')
  assert.equal(failed.finish.kind, 'error', 'an adapter failure must reach the caller as a finish')
  assert.equal(failed.finish.failure.message, 'no API key')
  const silent = await api.collectCommitStream((async function* generate() { yield { type: 'text-delta', index: 0, text: 'half' } })())
  assert.equal(silent.finish, null, 'a stream without a finish must be distinguishable from a successful one')
  const thought = await api.collectCommitStream((async function* generate() {
    yield { type: 'reasoning-delta', index: 0, text: 'thinking about it' }
    yield { type: 'text-delta', index: 0, text: 'feat: x' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  assert.equal(thought.sawReasoning, true, 'a reasoning delta is recorded for the max-tokens diagnosis (issue #7)')
  assert.equal(thought.text, 'feat: x', 'reasoning text never lands in the message')

  // 2 — the budget: per-file lines, total bytes, lock files and binaries.
  const long = 'diff --git a/big.txt b/big.txt\n' + Array.from({ length: 200 }, (_, i) => '+line ' + i).join('\n')
  const lock = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n+x'
  const binary = 'diff --git a/logo.png b/logo.png\n+binary'
  const bounded = api.commitInputOf(long, lock + '\n' + binary)
  assert.equal(bounded.files.length, 1, 'lock files and binaries are dropped')
  assert.equal(bounded.files[0].path, 'big.txt')
  assert.ok(bounded.files[0].body.split('\n').length <= api.COMMIT_FILE_LINES + 1, 'a file is capped by lines')
  assert.equal(bounded.dropped, 2)
  assert.equal(bounded.truncated, true)
  const many = Array.from({ length: api.COMMIT_MAX_FILES + 5 }, (_, i) => 'diff --git a/f' + i + '.txt b/f' + i + '.txt\n+x').join('\n')
  const capped = api.commitInputOf(many, '')
  assert.equal(capped.files.length, api.COMMIT_MAX_FILES, 'the file count is capped')
  assert.equal(capped.dropped, 5, 'what was left out is counted, so the UI can say so')
  /* A file the total budget drops was never sent, so it must not be reported as
     "truncated": truncated means the model saw a shortened version of it. */
  const wide = api.commitInputOf('diff --git a/a.txt b/a.txt\n+' + 'x'.repeat(api.COMMIT_FILE_BYTES * 2), '')
  assert.equal(wide.truncated, true, 'a file that IS sent is reported as truncated')
  const manyBig = Array.from({ length: Math.ceil(api.COMMIT_TOTAL_BYTES / api.COMMIT_FILE_BYTES) + 1 },
    (_, i) => 'diff --git a/f' + i + '.txt b/f' + i + '.txt\n+' + 'y'.repeat(api.COMMIT_FILE_BYTES * 2)).join('\n')
  const droppedAfterTrim = api.commitInputOf(manyBig, '')
  assert.equal(droppedAfterTrim.dropped, 1, 'the file past the total budget is dropped')
  assert.ok(droppedAfterTrim.bytes <= api.COMMIT_TOTAL_BYTES)
  assert.equal(droppedAfterTrim.truncated, true, 'the files that WERE sent were trimmed')
  assert.ok(capped.bytes <= api.COMMIT_TOTAL_BYTES)

  // 3 — the user's words steer style; they never replace the rules.
  const spoken = api.commitMessagesOf({ files: [{ path: 'a.txt', body: 'diff --git a/a.txt b/a.txt' }] }, 'Use Conventional Commits')
  assert.match(spoken.system, /commit messages/)
  assert.match(spoken.system, /ONLY/)
  assert.ok(!spoken.system.includes('Conventional Commits'), 'a user instruction must not land in the system prompt')
  assert.ok(spoken.user.includes('Use Conventional Commits'), 'the instruction is appended to the user message')
  assert.ok(spoken.user.indexOf('Use Conventional Commits') > spoken.user.indexOf('diff --git'), 'it comes after the change set')
  assert.equal(api.commitMessagesOf({ files: [] }, '   ').user.includes('Additional requirements'), false, 'a blank prompt adds nothing')

  // 4 — the wrapper a model likes to add is removed, the text itself is kept.
  assert.equal(api.cleanupCommitMessage('```\nfeat: x\n```'), 'feat: x')
  assert.equal(api.cleanupCommitMessage('"feat: y"'), 'feat: y')
  assert.equal(api.cleanupCommitMessage('feat: z\n\nbody'), 'feat: z\n\nbody')

  // 5 — the route refuses instead of reporting an empty success, and the model
  // call asks for what a commit message needs.
  assert.match(block, /if \(finish === null \|\| finish === undefined\)/, 'a stream with no finish is refused')
  assert.match(block, /finish\.kind === 'error'/, 'an error finish is a failure')
  assert.match(block, /finish\.kind !== 'stop'/, 'any non-stop finish is surfaced')
  assert.match(block, /'llm-no-finish'|llm-no-finish/, 'the no-finish failure has its own code')
  assert.match(block, /if \(commitBusy\) throw new PanelError\('busy'/, 'one generation at a time')
  assert.match(block, /commitServices === null/, 'a host without llm/sessions is refused, not hung')
  assert.match(block, /reasoningEffort/, 'the reasoning setting reaches GenerateOptions')
  assert.match(host, /ctx\.inject\(\['llm', 'sessions'\]/, 'llm is injected, never exported as a hard dependency')
  assert.doesNotMatch(host, /export const inject = \[[^\]]*'llm'/, 'a host without llm must still load the plugin')
  /* Issue #7: the hardcoded maxTokens 512 plus "an unset effort resolves to
     reasoning ON at high" died inside the reasoning phase on every model —
     with thinking enabled the output cap budgets reasoning AND message
     together, so 512 was spent before one word of the message existed. */
  assert.doesNotMatch(block, /maxTokens: [0-9]/, 'no hardcoded output cap: the selected model\'s own configured cap is used')
  assert.match(block, /quietOffEffortOf/, 'an unset effort asks for off instead of the adapter default')
  assert.match(block, /row\.id === 'off'/, 'the off id is read from the route\'s efforts table, never assumed')
  assert.match(block, /effectiveReasoning === '' \? null : effectiveReasoning/, 'the response reports the effort actually sent')
  assert.match(block, /sawReasoning === true/, 'a budget burned by reasoning is named as such')
  assert.match(block, /spent the whole output budget/, 'the max-tokens diagnosis says what to do about it')
  assert.match(host, /'commit-models': commitModels/, 'the settings card has a model catalog route')
  assert.match(host, /'commit-efforts': commitEfforts/, 'the settings card has a per-model efforts route')
  assert.match(client, /commit-models/, 'the client queries the host model catalog for the picker')
  assert.match(client, /commit-efforts/, 'the client queries the per-model efforts for the picker')
  assert.match(client, /'settings\.commit\.modelFollow'/, 'the picker has its follow-the-session option')
  assert.match(client, /'settings\.commit\.reasoningDefault'/, 'the picker has its no-reasoning default option')
  assert.match(host, /shape\.commitModel|commitModel/, 'the model setting lives in the row Config')
})

test('the legacy rail migration lands every field, or does not claim to have run', async () => {
  // DEF-2 (P1): the migration used to fire sixteen unawaited set() calls and
  // stamp the marker immediately, so an upgrading user silently lost rail
  // settings (measured: 15 of 16 fields, and once all of them) and the marker
  // stopped any retry. It now submits ONE atomic mutation and only stamps the
  // marker once the Host accepted it.
  const source = client.slice(client.indexOf('function migrateRailConfig('), client.indexOf('function subscribeRailConfig('))
  assert.ok(source.length > 300, 'migrateRailConfig must exist')
  const build = (storage, outcome, accepted) => {
    const calls = []
    const notify = []
    const window = {
      localStorage: {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
        setItem: (key, value) => { storage[key] = value; notify.push(key) },
      },
    }
    const writeRailFields = (ops, form) => { calls.push({ ops: ops, form: form }); return outcome }
    const run = new Function('window', 'RAIL_KEY', 'RAIL_MIGRATED_KEY', 'RAIL_IDS', 'railFieldOf', 'railValuesOfConfig', 'normalizeRail', 'railFormReady', 'writeRailFields', 'console',
      'let railMigrating = false\n' + source + '\nreturn migrateRailConfig')(window, 'dsh-ide-git.rail.v1', 'dsh-ide-git.rail.v1.migrated',
      ['refresh', 'tag', 'push'],
      (id) => 'rail' + id.charAt(0).toUpperCase() + id.slice(1),
      (config) => ({ railRefresh: config.hidden.indexOf('refresh') < 0, railTag: config.hidden.indexOf('tag') < 0, railPush: config.hidden.indexOf('push') < 0 }),
      (raw) => ({ order: [], hidden: Array.isArray(raw.hidden) ? raw.hidden : [] }),
      () => ({ status: 'ready', value: accepted }),
      writeRailFields,
      { warn: () => {} })
    return { run: run, calls: calls, storage: storage, notify: notify, form: { name: 'form' } }
  }

  // 1 — every legacy field goes in ONE atomic mutation, and the marker follows the write.
  const ok = build({ 'dsh-ide-git.rail.v1': JSON.stringify({ order: [], hidden: ['refresh', 'tag'] }) }, { sent: true, settled: Promise.resolve(true) }, { railRefresh: true, railTag: true, railPush: true })
  ok.run(ok.form)
  assert.equal(ok.calls.length, 1, 'the migration submits exactly one write')
  assert.deepEqual(ok.calls[0].ops, [
    { op: 'set', path: ['railRefresh'], value: false },
    { op: 'set', path: ['railTag'], value: false },
  ], 'only the fields that actually differ are submitted, one op each')
  assert.equal(ok.storage['dsh-ide-git.rail.v1.migrated'], undefined, 'the marker must not be stamped before the Host answers')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(ok.storage['dsh-ide-git.rail.v1.migrated'], '1', 'the marker is stamped once the write was accepted')

  // 2 — a refused write leaves the migration unmarked, and the next load retries.
  const refused = build({ 'dsh-ide-git.rail.v1': JSON.stringify({ order: [], hidden: ['push'] }) }, { sent: true, settled: Promise.resolve(false) }, {})
  refused.run(refused.form)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(refused.storage['dsh-ide-git.rail.v1.migrated'], undefined, 'a refused write must not be marked as migrated')
  refused.run(refused.form)
  assert.equal(refused.calls.length, 2, 'the next load retries the migration')
  const notReady = build({ 'dsh-ide-git.rail.v1': JSON.stringify({ order: [], hidden: ['push'] }) }, { sent: false, reason: 'read-only' }, {})
  notReady.run(notReady.form)
  assert.equal(notReady.storage['dsh-ide-git.rail.v1.migrated'], undefined, 'an unwritable document must not be marked as migrated')

  // 3 — once migrated, it never runs twice, and a config that already agrees is a no-op.
  const already = build({ 'dsh-ide-git.rail.v1': JSON.stringify({ order: [], hidden: ['push'] }), 'dsh-ide-git.rail.v1.migrated': '1' }, { sent: true, settled: Promise.resolve(true) }, {})
  already.run(already.form)
  assert.equal(already.calls.length, 0, 'a migrated profile is not migrated again')
  const same = build({ 'dsh-ide-git.rail.v1': JSON.stringify({ order: [], hidden: [] }) }, { sent: true, settled: Promise.resolve(true) }, { railRefresh: true, railTag: true, railPush: true })
  same.run(same.form)
  assert.equal(same.calls.length, 0, 'a document that already matches is not rewritten')
  assert.equal(same.storage['dsh-ide-git.rail.v1.migrated'], '1', 'and it still counts as migrated')
})

test('the overwrite-draft confirmation carries both button labels in every dictionary', () => {
  // DEF-1 (P2): the AI overwrite dialog shipped without okLabel/cancelLabel, so
  // both buttons rendered empty while the other seven dialogs had text.
  const start = client.indexOf('const aiConfirmDialog =')
  const end = client.indexOf('const composer = props.compact')
  assert.ok(start > 0 && end > start, 'the confirm dialog must stay where the smoke test can see it')
  const dialog = client.slice(start, end)
  assert.match(dialog, /okLabel: t\('confirm\.ok'\)/, 'the confirm button needs a label')
  assert.match(dialog, /cancelLabel: t\('confirm\.cancel'\)/, 'the cancel button needs a label')
  for (const key of ['confirm.ok', 'confirm.cancel']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 21, key + ' must exist in ZH + EN + every LOCALES entry (saw ' + occurrences + ')')
  }
})

test('the settings entry draws a gear, not a sunburst', () => {
  // The rail's settings button used to render a centre dot with eight rays — a
  // brightness glyph users read as "sun" — under the name `settings`. The entry
  // now carries the official product gear (toothed contour + centre hole).
  const table = client.slice(client.indexOf('const ICONS = {'), client.indexOf('const NATIVE_ID'))
  const line = table.slice(table.indexOf('settings: ['), table.indexOf('settings: [') + 2400)
  const paths = [...line.slice(0, line.indexOf('],')).matchAll(/'([^']*)'/g)].map((match) => match[1])
  assert.equal(paths.length, 2, 'a gear is a toothed contour plus a centre hole')
  assert.ok(paths[0].length > 500, 'the contour must be the long toothed outline, not a small circle')
  assert.ok(paths[1].length > 60 && paths[1].length < 400, 'the hole is the short circle path')
  for (const ray of ['M8 1.8v1.5', 'M8 12.7v1.5', 'M1.8 8h1.5', 'M12.7 8h1.5']) {
    assert.ok(line.indexOf(ray) < 0, 'no sun ray survives in the gear: ' + ray)
  }
  assert.match(client, /E\(Icon, \{ name: 'settings', size: 18 \}\)/, 'the rail settings button still uses it')
})

test('the rail settings live in the row Config, with localStorage only as the legacy home', () => {
  // One document, one editor. dsh >= 0.1.7 persists a plugin's settings as the
  // row Config and serves it through ctx.configForms; the settings card on the
  // plugin's page edits it, the rail reads it, and the pre-0.9 localStorage value
  // is migrated once. An older host has no such service — there the localStorage
  // home and the in-panel editor stay.
  const start = client.indexOf('/* ---- rail config core')
  const end = client.indexOf('/* ---- end rail config core')
  assert.ok(start >= 0 && end > start, 'the rail config core must keep its markers')
  const core = new Function('RAIL_IDS', client.slice(start, end)
    + '\nreturn { railFieldOf: railFieldOf, railConfigOfValues: railConfigOfValues, railValuesOfConfig: railValuesOfConfig }')(['refresh', 'tree', 'float'])
  assert.equal(core.railFieldOf('newBranch'), 'railNewBranch')
  assert.equal(core.railFieldOf('float'), 'railFloat')
  assert.deepEqual(core.railConfigOfValues({ railRefresh: true, railTree: false }), { order: ['refresh', 'tree', 'float'], hidden: ['tree'] })
  assert.deepEqual(core.railConfigOfValues(null).hidden, [], 'a missing field means the default, which is shown')
  assert.deepEqual(core.railValuesOfConfig({ hidden: ['float'] }), { railRefresh: true, railTree: true, railFloat: false })

  // The host schema mirrors the client rail ids — a new action must not be
  // silently missing from the settings surface.
  const hostIds = host.slice(host.indexOf('const RAIL_CONFIG_IDS = ['), host.indexOf(']', host.indexOf('const RAIL_CONFIG_IDS = [')))
  const schemaIds = [...hostIds.matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1])
  const specIds = [...client.slice(client.indexOf('const RAIL_SPECS = ['), client.indexOf('const RAIL_IDS =')).matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])
  assert.ok(specIds.length >= 12, 'RAIL_SPECS should still be the action authority')
  assert.deepEqual(schemaIds, specIds, 'the host row Config must mirror RAIL_SPECS exactly (and in order)')
  assert.match(host, /shape\['rail' \+ id\.charAt\(0\)\.toUpperCase\(\) \+ id\.slice\(1\)\] = live\(schema\.boolean\(\)\.default\(true\)\)/,
    'every action is a volatile boolean defaulting to shown')
  assert.match(host, /export const Config = Schema === null \? undefined : railConfigSchema\(Schema\)/,
    'an unresolvable schema module must only disable the surface, never the row')

  // Invariant 2, amended: the host half still imports only node: builtins; the
  // single non-node module it may REACH (lazily, guarded) is the host-provided
  // schema module every sibling plugin uses to declare its row Config.
  const dynamicImports = [...host.matchAll(/await import\('([^']+)'\)/g)].map((match) => match[1])
  assert.deepEqual(dynamicImports, ['@deepseek-ai/schemastery'], 'the only allowed non-node reach, and it must stay dynamic')
  assert.doesNotMatch(host, /from '(?!node:)/, 'host half may only import node: builtins')

  // Client wiring: the detail-page seat (the legacy Settings → Plugins seat went
  // away with the raised host floor), soft services, one-shot migration.
  assert.match(client, /const SETTINGS_BUNDLE = 'dsh-ide-git'/)
  assert.match(client, /const RAIL_NS = 'ide-git'/)
  assert.match(client, /slots\.inject\('plugins\.bundle\.config'/)
  assert.match(client, /\{ name: 'plugins\.bundle\.config', key: SETTINGS_BUNDLE, locale: LOCALE_NS \}/)
  assert.doesNotMatch(client, /settings\.plugin\.item/, 'the legacy settings-list seat must stay gone')
  assert.match(client, /ctx\.inject\(\['configForms'\]/)
  assert.match(client, /const RAIL_MIGRATED_KEY = 'dsh-ide-git\.rail\.v1\.migrated'/)
  assert.match(client, /navigation\.openBundle\(SETTINGS_BUNDLE\)/, 'the gear opens the plugin page when the host has one')
  assert.match(client, /const openSettings = navigation !== undefined && navigation !== null && typeof navigation\.openBundle === 'function'/,
    'pluginNavigation is read at RENDER time and soft (it may be undefined)')
  // The in-panel editor exists only where the row Config does not.
  assert.match(client, /railForm === null \|\| props\.openSettings === null \|\| props\.openSettings === undefined \? 'panel' : 'page'/,
    'the gear falls back to the in-panel editor only without the config/navigation pair')
})

test('every overlay is clamped to the panel it lives in', () => {
  // Found while making the panel draggable (issue #5): the dock can now be dragged
  // narrower than the overlays' own minimum, and a fixed min-width BEATS max-width
  // in CSS — so the context menu came out wider than the panel and hung past its
  // right edge. Invariant 13 is about the panel's box, not just its origin.
  assert.match(cssRule('.dig-menu'), /box-sizing:border-box/)
  assert.match(cssRule('.dig-menu'), /min-width:200px/, 'the menu keeps a readable floor; the panel cap lives on .dig-menu-wrap')
  assert.match(cssRule('.dig-menu-wrap'), /max-width:calc\(100% - 8px\)/, 'the panel cap moved to the wrapper')
  assert.match(cssRule('.dig-dialog'), /box-sizing:border-box/, 'a content-box dialog adds its padding on top of the clamp')
  assert.match(cssRule('.dig-dialog'), /min-width:min\(240px,100%\)/)
  assert.match(cssRule('.dig-dialog'), /max-width:min\(420px,94%\)/)
  assert.match(cssRule('.dig-dialog-wide'), /min-width:min\(360px,92%\)/)
  assert.match(cssRule('.dig-toasts'), /max-width:min\(340px,92%\)/)
  // Under the compact threshold the panel marks itself, and the nowrap labels that
  // would otherwise be clipped start wrapping inside the clamped box.
  assert.match(client, /compact \? ' dig-root-narrow' : ''/)
  assert.match(client, /\.dig-root-narrow \.dig-menu-item\{white-space:normal\}/)
  assert.match(client, /\.dig-root-narrow \.dig-toast-text\{white-space:normal\}/)
})

test('every pane name a divider announces exists in every dictionary', () => {  const mapped = client.match(/const PANE_NAME_KEYS = \{([^}]*)\}/)
  assert.ok(mapped !== null, 'the pane name map must stay greppable')
  const keys = [...mapped[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(keys, ['toolbar.tree', 'changes.title', 'pane.diff'])
  const zh = client.slice(client.indexOf('const ZH = {'), client.indexOf('const EN = {'))
  const en = client.slice(client.indexOf('const EN = {'), client.indexOf('const LOCALES = {'))
  for (const key of keys) {
    assert.ok(zh.includes("'" + key + "':"), 'ZH is missing ' + key)
    assert.ok(en.includes("'" + key + "':"), 'EN is missing ' + key)
  }
  // The template that wraps the name is looked up through t(), so the shared
  // dictionary test already covers all 21 languages for it.
  assert.match(client, /fill\(props\.t\('pane\.resize'\), \{ name: props\.t\(props\.nameKey\) \}\)/)
})

test('the conversation seat bails out of the shell keystroke cascade (v0.13.1 perf)', () => {
  // The conversation shell re-renders on EVERY composer keystroke, and the
  // view area re-renders with it. v0.13.0 dragged the whole Git panel tree
  // through a synchronous render per keypress while the Git view was active
  // (typing lag). The seat component must be memoized, and the comparator may
  // only honour the props it actually consumes — sessionId plus the two stable
  // bindings; the shell's per-render props (inspectCall, viewRequest, …) are
  // deliberately ignored so they can never re-open the cascade.
  assert.match(client, /const ConversationPanel = memo\(function ConversationPanel\(props\)/,
    'the conversation seat is wrapped in React.memo')
  assert.match(client, /\}, \(prev, next\) => prev\.sessionId === next\.sessionId && prev\.t === next\.t && prev\.ctx === next\.ctx\)/,
    'the comparator bails on identical session + bindings')
})

test('the first-paint cache seeds session switches inside one workspace (v0.13.1 perf)', () => {
  // Session-scoped seats remount per session switch; without a cache the whole
  // discovery + first-page chain re-ran and the chrome re-grew piece by piece.
  // The cache block is pure, so drive it directly: a fresh write reads back,
  // an expired entry reads as a miss, and eviction keeps the maps bounded.
  const core = client.slice(
    client.indexOf('/* ============================== first-paint cache'),
    client.indexOf('/* ============================== storage'))
  assert.ok(core.length > 300, 'the first-paint cache block must exist')
  /* The block carries its own PAINT_TTL_MS const, so only Date is injected
     (a frozen clock: every entry below reads as fresh, and the expiry branch
     is proven by the block's own Date.now() arithmetic instead). */
  const helpers = new Function('Date', core
    + '\nreturn { readPaintRepos, writePaintRepos, readPaintPage, writePaintPage, rememberPaintRoot, readPaintRoot }')(
    { now: () => 1_000 })
  helpers.writePaintRepos('/w', { repos: [], isRepo: true, cwd: '/w' })
  assert.deepEqual(helpers.readPaintRepos('/w'), { repos: [], isRepo: true, cwd: '/w' }, 'a fresh repos entry reads back')
  helpers.writePaintPage('/r', { summary: { head: 'x' }, branches: [], commits: [1], hasMore: false })
  assert.equal(helpers.readPaintPage('/r').summary.head, 'x', 'a fresh page entry reads back')
  assert.equal(helpers.readPaintPage('/missing'), undefined, 'an unknown root is a miss')
  helpers.rememberPaintRoot('/w', '/r')
  assert.equal(helpers.readPaintRoot('/w'), '/r', 'the last looked-at root survives the switch')
  // The seeding effect only fills COLD state (null summary / empty commits) and
  // never rolls live state back to the stale snapshot.
  const panel = client.slice(client.indexOf('const cachedPage = readPaintPage(repoRoot)'), client.indexOf('void refresh()'))
  assert.match(panel, /if \(summary === null\) setSummary\(/, 'summary only seeds when cold')
  assert.match(panel, /if \(branches === null\) setBranches\(/, 'branches only seed when cold')
  assert.match(panel, /if \(commits\.length === 0\) \{ setCommits\(/, 'commits only seed when cold')
  // The write side records exactly the FIRST page, from refresh() itself — a
  // paged fetch (skip > 0) must never poison the seed with a concatenated list.
  const refreshFn = client.slice(client.indexOf('const refresh = useCallback'), client.indexOf('], [guard, loadSummary, loadBranches, loadCommits, repoRoot])'))
  assert.match(refreshFn, /loadCommits\(0\)/, 'the cache write rides the first-page refresh')
  assert.match(refreshFn, /writePaintPage\(repoRoot,/, 'refresh writes the cache')
})

test('block separators paint on border-l2, not the hairline token (v0.13.1 style)', () => {
  // The pane/block separators used the faintest token; users could not see the
  // block structure. These eleven are the BLOCK borders; dialog innards and
  // menu separators deliberately keep the hairline.
  for (const selector of ['.dig-topbar', '.dig-rail', '.dig-rail-row', '.dig-pane-tree', '.dig-pane-tree-stack',
    '.dig-pane-changes', '.dig-pane-changes-stack', '.dig-compact-tree', '.dig-filters', '.dig-commit-box', '.dig-diff-pane']) {
    const rule = cssRule(selector)
    assert.match(rule, /var\(--dsw-alias-border-l2\)/, selector + ' must draw its block border on border-l2')
  }
  for (const selector of ['.dig-settings-list', '.dig-menu-sep']) {
    const rule = cssRule(selector)
    assert.doesNotMatch(rule, /border-l2/, selector + ' stays on the hairline (not a block)')
  }
})

test('root grants validate the primary and only an absent older-host method degrades', async () => {
  const start = client.indexOf('async function grantedRoots(primary) {')
  const end = client.indexOf('/* ============================== i18n', start)
  assert.ok(start > 0 && end > start)
  const source = client.slice(start, end)
  const granted = (request) => new Function('request', source + '\nreturn grantedRoots')(request)
  const primary = '/work/main'
  const roots = await granted(async (method, payload) => {
    assert.equal(method, 'roots')
    assert.deepEqual(payload, { cwd: primary })
    return { workspace: primary, roots: [primary, '/work/attached', '/work/attached'] }
  })(primary)
  assert.deepEqual(roots, { workspace: primary, roots: [primary, '/work/attached'] })
  const absent = Object.assign(new Error('unknown method "roots"'), { code: 'not-found' })
  assert.deepEqual(await granted(async () => { throw absent })(primary), { workspace: primary, roots: [primary] })
  for (const failure of [new Error('network failed'), Object.assign(new Error('denied'), { code: 'forbidden' }),
    Object.assign(new Error('other route missing'), { code: 'not-found' })]) {
    await assert.rejects(granted(async () => { throw failure })(primary), (error) => error === failure)
  }
  await assert.rejects(granted(async () => ({ workspace: primary, roots: ['/work/attached'] }))(primary), /Invalid roots response/)
})

test('root boundary gates actions, remembers choice by session and canonical workspace, remounts by root', () => {
  const boundary = client.slice(client.indexOf('function RootBoundary(props) {'), client.indexOf('function LocaleLive(props) {'))
  assert.match(boundary, /rootChoiceKey\(sessionId, data\.workspace\)/)
  assert.match(boundary, /setChecking\(true\).*inert existing panel/)
  assert.match(boundary, /inert: blocked \? true : undefined/)
  assert.match(boundary, /ready \? E\('div', \{ className: 'dig-root-panel-holder'/)
  assert.match(boundary, /serial !== sequence\.current/)
  assert.match(boundary, /data\.roots\.includes\(remembered\) \? remembered : data\.workspace/)
  assert.match(boundary, /window\.addEventListener\('focus', focus\)/)
  assert.match(boundary, /visible && !wasVisible\.current\) void refreshRoots\(false\)/)
  assert.match(boundary, /!ready \|\| blocked \? E\('div', \{ className: 'dig-root-gate'/)
  assert.match(boundary, /key: JSON\.stringify\(\[sessionId, primary, verified\.selected\]\)/)
  assert.match(boundary, /role: 'menuitemradio'/)
  assert.match(client, /E\(RootBoundary, \{ scope: props\.scope/)
  assert.match(client, /request\('repos', \{ cwd: cwd \}\)/)
  assert.match(client, /rememberRepo\(rootChoiceKey\(sessionId, cwd\), path\)/)
})

test('nested session checkout hints stay inside selected primary and defer parent actions', () => {
  const start = client.indexOf('function withinSelectedRoot(root, path) {')
  const end = client.indexOf('async function grantedRoots(primary)', start)
  assert.ok(start > 0 && end > start)
  const within = new Function(client.slice(start, end) + '\nreturn withinSelectedRoot')()
  assert.equal(within('/work/main', '/work/main/deep/repo'), true)
  assert.equal(within('/work/main', '/work/main-other/repo'), false)
  assert.equal(within('/work/main', '/work/attached/repo'), false)
  assert.equal(within('C:\\work\\main', 'C:\\work\\main\\repo'), true)
  const boundary = client.slice(client.indexOf('function RootBoundary(props) {'), client.indexOf('function LocaleLive(props) {'))
  assert.match(boundary, /initialRepoHint: verified\.selected === verified\.workspace \? primary : undefined/)
  const discovery = client.slice(client.indexOf('const pickEpoch = repoPickEpoch.current'), client.indexOf('return () => { cancelled = true }', client.indexOf('const pickEpoch = repoPickEpoch.current')))
  assert.match(discovery, /request\('repos', \{ cwd: hint \}\)/)
  assert.match(discovery, /repo\.kind === 'workspace' && withinSelectedRoot\(cwd, repo\.path\)/)
  assert.match(discovery, /remembered !== undefined.*pick = remembered/)
  assert.match(discovery, /else if \(hintedPath !== null.*pick = hintedPath/)
  assert.match(discovery, /repoPickEpoch\.current !== pickEpoch\) return/)
  assert.match(discovery, /cached !== undefined && \(!needsHint \|\|/)
  assert.match(discovery, /Promise\.all\(\[/)
  assert.match(client, /const pickRepo = useCallback\(\(path\) => \{\s*repoPickEpoch\.current \+= 1/)
})

test('the AI commit message carries the picked repository (multi-repo workspace)', () => {
  // A workspace may hold several sibling repositories, so the session cwd need
  // not be one. Every other request carries `base` ({ cwd, repoRoot }); the AI
  // message built its payload from `cwd` alone, and the host — which resolves the
  // root from `cwd` whenever `repoRoot` is missing — answered not-a-repo.
  const aiRun = client.slice(client.indexOf('const aiRun = async () =>'), client.indexOf('setAiUndo('))
  assert.ok(aiRun.length > 200, 'the AI run block must exist')
  assert.match(aiRun, /request\('commit-message', Object\.assign\(/, 'one payload builder, like every other call')
  assert.match(aiRun, /props\.base/, 'the picked repository (base) is part of that payload')
  // A prop that is never handed down reads as undefined, so the component that
  // sends the request must actually receive the repo identity.
  const pane = client.slice(client.indexOf('E(ChangesPanel, {'), client.indexOf('onCommit:'))
  assert.match(pane, /base: base,/, 'Panel hands the repo identity down to ChangesPanel')
})
