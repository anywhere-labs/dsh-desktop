/**
 * dsh-ide-git — commit-graph layout test (the client's branch lane algorithm).
 *
 * The graph is drawn per row, but the lanes are decided by a single pass in
 * `buildRows`: a lane is a slot that carries one pending commit downwards
 * until that commit's own row consumes it. That makes the layout checkable
 * without a browser — the function is pure and depends on nothing but its
 * argument, so it is lifted straight out of the client half and driven here.
 *
 * The invariant that matters is "no ghost lane": whatever a row leaves on a
 * lane must be the commit that lane is holding, so the commit has to show up
 * later on THAT lane. v0.4.1 fixed the case where a branch merging back into a
 * lane to its left parked its first parent on its own lane anyway, leaving a
 * stub of a fork that never happened.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'client.js'), 'utf8')

/** Lift `buildRows` out of the client half (it closes over nothing). */
function liftedBuildRows() {
  const marker = 'function buildRows(commits) {'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'buildRows is gone from the client half')
  let depth = 0
  let end = -1
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  assert.ok(end > start, 'buildRows has unbalanced braces')
  return new Function(source.slice(start, end) + '; return buildRows;')()
}

const buildRows = liftedBuildRows()

/**
 * v0.5.4 near-miss: GraphCell was taught to read GRAPH_MAX_LANES but the
 * constant itself never made it into the file — the empty-state render and the
 * pure layout test both passed, while every real page died with a
 * ReferenceError that better-sidebar's error boundary swallowed. The graph is
 * not exercised by either of those, so the reference check lives here.
 */
function assertIdentifiersDeclared(functionName) {
  const start = source.indexOf('function ' + functionName + '(props) {')
  assert.ok(start >= 0, functionName + ' is gone from the client half')
  let depth = 0
  let end = -1
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  assert.ok(end > start, functionName + ' has unbalanced braces')
  const body = source.slice(start, end)
    // identifiers only: drop comments and string literals first, or 'HEAD' and
    // prose words inside a comment read as constant references.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '\'\'')
  const names = new Set()
  for (const match of body.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) names.add(match[1])
  for (const name of names) {
    assert.ok(
      source.indexOf('const ' + name + ' =') >= 0,
      functionName + ' reads ' + name + ', but nothing in the client half declares it',
    )
  }
}

test('every module-level constant GraphCell reads is actually declared', () => {
  assertIdentifiersDeclared('GraphCell')
})
const commit = (hash, parents) => ({ hash, parents, subject: hash, refs: [] })

/** Whatever a lane carries out of a row must be fulfilled by that lane later. */
function assertNoGhostLanes(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const after = rows[index].after
    for (let lane = 0; lane < after.length; lane += 1) {
      const hash = after[lane]
      if (hash === null || hash === undefined) continue
      const at = rows.findIndex((row, later) => later > index && row.commit.hash === hash)
      if (at === -1) continue // the parent is past this page's edge
      assert.equal(
        rows[at].lane, lane,
        'lane ' + lane + ' carries ' + hash + ' out of row ' + index + ', but ' + hash + ' lands on lane ' + rows[at].lane,
      )
    }
  }
}

test('a branch merging into a lane to its left ends its own lane', () => {
  // m is a merge: first parent c continues the trunk, second parent x opens
  // lane 1. x's own parent d is ALREADY on lane 0, so lane 1 must end at x
  // instead of carrying d — that leftover is the stub the user reported.
  const rows = buildRows([
    commit('m', ['c', 'x']),
    commit('c', ['d']),
    commit('x', ['d']),
    commit('d', []),
  ])
  assert.deepEqual(rows[2].parentLanes, [0], 'the merge edge points at the lane d already occupies')
  assert.equal(rows[2].after[1], null, 'lane 1 must end at x, not carry d onwards')
  assert.equal(rows[2].after[0], 'd', 'lane 0 keeps carrying d')
  assertNoGhostLanes(rows)
})

test('a straight line keeps its lane', () => {
  const rows = buildRows([
    commit('a', ['b']),
    commit('b', ['c']),
    commit('c', []),
  ])
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0])
  assert.equal(rows[0].after[0], 'b')
  assert.equal(rows[1].after[0], 'c')
  assert.equal(rows[2].after[0], null, 'a root commit leaves its lane empty')
  assertNoGhostLanes(rows)
})

test('a merge opens a lane for the second parent and closes it when it returns', () => {
  const rows = buildRows([
    commit('m', ['a', 'b']),
    commit('a', ['base']),
    commit('b', ['base']),
    commit('base', []),
  ])
  assert.deepEqual(rows[0].parentLanes, [1])
  assert.equal(rows[0].after[1], 'b')
  assert.equal(rows[2].after[1], null, 'the side lane closes when b merges back')
  assert.deepEqual(rows[2].parentLanes, [0])
  assertNoGhostLanes(rows)
})

test('a parent already on the board is never parked twice', () => {
  const rows = buildRows([
    commit('tip', ['left', 'right']),
    commit('left', ['shared']),
    commit('right', ['shared']),
    commit('shared', ['root']),
    commit('root', []),
  ])
  assertNoGhostLanes(rows)
  for (const row of rows) {
    const live = row.after.filter((value) => value !== null && value !== undefined)
    assert.equal(new Set(live).size, live.length, 'one lane per pending commit at row ' + row.commit.hash)
  }
})

/* v0.5.4 — the log is a window, and parents past its edge used to park their
   hash on a lane forever: the lane could never be consumed, every later branch
   tip claimed a fresh lane, and the graph turned into a bundle of independent
   parallel lines with dangling edges. An out-of-window parent now ends its
   lane at the commit instead. */
test('a parent beyond the loaded window ends its lane instead of parking a ghost', () => {
  const rows = buildRows([commit('a', ['ghost'])])
  assert.equal(rows[0].after[0], null, 'the lane must end at the commit, not carry a hash that can never arrive')
  assert.deepEqual(rows[0].parentLanes, [], 'no edge can land on an unloaded parent')
  assertNoGhostLanes(rows)
})

test('commits after an out-of-window parent reuse the freed lane', () => {
  const rows = buildRows([
    commit('a', ['ghost1']),
    commit('b', ['ghost2']),
    commit('c', ['b']),
  ])
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0], 'freed lanes stay reusable, the graph stays narrow')
  assert.equal(rows[2].after[0], 'b', 'an in-window parent still keeps its lane alive')
  assertNoGhostLanes(rows)
})

test('an out-of-window second parent opens no extra lane', () => {
  const rows = buildRows([
    commit('m', ['ghost', 'a']),
    commit('a', []),
  ])
  /* The ghost parent contributes nothing: no lane is opened for it and no
     edge points at it. The loaded second parent inherits the lane m was on,
     so its edge simply continues down the same column. */
  assert.equal(rows[0].after.length, 1, 'the ghost must not open a second lane')
  assert.deepEqual(rows[0].parentLanes, [0], 'the only edge points at the loaded parent, on the same lane')
  assert.deepEqual(rows[1].lane, 0, 'a consumes the lane on its own row')
  assertNoGhostLanes(rows)
})

/** Lift any factory-level function out of the client half (see buildRows above). */
function liftedFunction(functionName) {
  const marker = 'function ' + functionName + '('
  const start = source.indexOf(marker)
  assert.ok(start >= 0, functionName + ' is gone from the client half')
  let depth = 0
  let end = -1
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  assert.ok(end > start, functionName + ' has unbalanced braces')
  return new Function(source.slice(start, end) + '; return ' + functionName + ';')()
}

const laneSegments = liftedFunction('laneSegments')

/* v0.5.5 — the user reported the line "断开了" and a "无端点的多余分叉" twice.
   The cause was not the lane algorithm but the drawing: a lane OPENED by an edge
   curve in the same row was painted twice — the curve landed at the row bottom
   while a vertical segment was also started at the row centre, leaving a
   floating hook above the new line. The opened lane must be carried by the
   curve alone; the next row's segment starts at its top edge. */
test('a lane opened by an edge in the same row draws no vertical stub', () => {
  const rows = buildRows([
    commit('m', ['a', 'b']),
    commit('a', ['base']),
    commit('b', ['base']),
    commit('base', []),
  ])
  const opened = laneSegments(rows[0], 26)
  assert.deepEqual(opened.filter((segment) => segment.lane === 1), [], 'lane 1 is opened by the merge edge — the curve alone must draw it')
  assert.ok(opened.some((segment) => segment.lane === 0), 'the trunk still draws through the merge row')
  // The lane's own commit row DOES draw it, and it merges back into the trunk
  // there, so it rounds off at the row centre — where b's dot sits.
  const own = laneSegments(rows[2], 26)
  assert.ok(own.some((segment) => segment.lane === 1 && segment.y1 === 0 && segment.y2 === 13), 'b draws its lane down to its own dot')
  // A lane that merely passes through spans the whole row box.
  const through = laneSegments(rows[1], 26)
  assert.ok(through.some((segment) => segment.lane === 0 && segment.y1 === 0 && segment.y2 === 26), 'the trunk spans the full row box')
})

/* Lanes fill newest-first, and the CURRENT branch owns column 0 whenever it is
   on the board — a side branch created later must not push HEAD's line to the
   right (the ordering rule the user asked about). */
test('the current branch keeps the leftmost lane', () => {
  const headFirst = buildRows([
    Object.assign(commit('head', ['base']), { refs: ['HEAD -> main'] }),
    commit('side', ['base']),
    commit('base', []),
  ])
  assert.equal(headFirst[0].lane, 0)
  const headLater = buildRows([
    Object.assign(commit('side', ['base']), { refs: ['origin/side'] }),
    Object.assign(commit('head', ['base']), { refs: ['HEAD -> main'] }),
    commit('base', []),
  ])
  assert.equal(headLater[0].lane, 1, 'a newer side commit takes the next free lane')
  assert.equal(headLater[1].lane, 0, 'the current branch still gets column 0')
  assertNoGhostLanes(headLater)
})
