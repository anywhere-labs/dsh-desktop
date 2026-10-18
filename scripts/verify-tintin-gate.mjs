import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TinTin porting gate (iron rules 4, 13, 15 in docs/tintin-iron-rules.md).
 *
 * Enforced today:
 * - governance documents keep their load-bearing anchors (rule 15),
 * - any dsh-tintin-* workspace package is registered in the root workspaces,
 * - handwritten TinTin source files stay under the 1000-line baseline that
 *   only ever decreases (rule 4).
 *
 * The registries live next to this script so the gate has no hidden state:
 * - scripts/tintin-anchors.json          grep anchors with minimum counts
 * - scripts/tintin-line-baseline.json    locked over-quota files (line ceilings)
 */

const TINTIN_WORKSPACE_GLOBS = [
  'dsh-tintin-bundle',
  'dsh-tintin-media-bundle',
  'dsh-tintin-creation-bundle',
  'dsh-tintin-ops-bundle',
  'dsh-tintin-browser',
  'dsh-plugin-desktop-tintin',
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue'])
// `tintin-resources/` holds fetched third-party runtime trees (OpenFilm, the
// browser extensions, Playwright browsers). Integration targets those as-is
// (2026-10-18 user ruling), so they are never counted against the handwritten
// source baseline; TinTin-authored code still must comply.
const SOURCE_EXCLUDED_PARTS = new Set(['node_modules', 'dist', 'coverage', 'test', 'tests', 'tintin-resources'])
// The channel package builds its handwritten src/ into lib/ (tsdown + vite
// bundles, tens of thousands of lines); the capability bundles instead keep
// their handwritten host logic under lib/. Only the channel's lib/ is output.
const BUILD_OUTPUT_PARTS_BY_PACKAGE = new Map([
  ['dsh-plugin-desktop-tintin', new Set(['lib'])],
])
const MAX_SOURCE_LINES = 1000
const MAX_BASELINE_LINES = 3528

const toPosix = path => path.replaceAll(sep, '/')

export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function listSourceFiles(root, directory) {
  const files = []
  const excluded = new Set([...SOURCE_EXCLUDED_PARTS, ...(BUILD_OUTPUT_PARTS_BY_PACKAGE.get(directory) ?? [])])
  // The channel package mirrors the Beta desktop source; mirrored files are
  // governed by the framework repository's own rules. The 1000-line iron rule
  // therefore applies only to channel-only additions (browser wiring etc.).
  const mirrorRoot = directory === 'dsh-plugin-desktop-tintin'
    ? resolve(root, 'dsh-plugin-desktop-beta')
    : undefined
  const walk = current => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const dotted = basename(entry.name)
      const extension = dotted.slice(dotted.lastIndexOf('.'))
      if (!SOURCE_EXTENSIONS.has(extension)) continue
      if (dotted.endsWith('.d.ts') || dotted.includes('.generated.')) continue
      if (mirrorRoot !== undefined && existsSync(join(mirrorRoot, relative(resolve(root, directory), full)))) continue
      files.push(full)
    }
  }
  walk(resolve(root, directory))
  return files
}

export function countSourceLines(content) {
  if (content === '') return 0
  const parts = content.split(/\r?\n/u)
  const trailingNewline = /\r?\n$/u.test(content)
  return parts.length - (trailingNewline ? 1 : 0)
}

export function checkAnchors({ root, anchors, readText }) {
  const violations = []
  for (const anchor of anchors) {
    if (typeof anchor?.comment !== 'string'
      || typeof anchor?.path !== 'string'
      || typeof anchor?.pattern !== 'string'
      || typeof anchor?.minCount !== 'number' || anchor.minCount < 1) {
      violations.push(`tintin anchors registry holds an invalid entry: ${JSON.stringify(anchor)}`)
      continue
    }
    let content
    try {
      content = readText(resolve(root, anchor.path))
    } catch {
      violations.push(`anchor target is missing: ${anchor.path}`)
      continue
    }
    const matches = content.split(anchor.pattern).length - 1
    if (matches < anchor.minCount) {
      violations.push(
        `anchor failed: ${anchor.path} must contain ${String(anchor.minCount)}x ${JSON.stringify(anchor.pattern)}, found ${String(matches)} (${anchor.comment})`,
      )
    }
  }
  return violations
}

export function checkLineGate({ root, baseline, listFiles, readText, fileExists = existsSync }) {
  const violations = []
  const ceilings = new Map(Object.entries(baseline ?? {}))
  if (ceilings.size > 64) violations.push('tintin line baseline lists too many files')
  for (const [file, ceiling] of ceilings) {
    if (typeof ceiling !== 'number' || ceiling < 0 || ceiling > MAX_BASELINE_LINES) {
      violations.push(`tintin line baseline ceiling for ${file} is invalid`)
    }
  }
  for (const directory of TINTIN_WORKSPACE_GLOBS) {
    for (const file of listFiles(root, directory)) {
      const key = toPosix(relative(root, file))
      let lines
      try {
        lines = countSourceLines(readText(file))
      } catch {
        violations.push(`tintin source file is unreadable: ${key}`)
        continue
      }
      if (lines <= MAX_SOURCE_LINES) continue
      const ceiling = ceilings.get(key)
      if (ceiling === undefined) {
        violations.push(
          `tintin source file exceeds ${String(MAX_SOURCE_LINES)} lines without a baseline entry: ${key} (${String(lines)})`,
        )
        continue
      }
      if (lines > ceiling) {
        violations.push(
          `tintin source file grew beyond its locked baseline: ${key} is ${String(lines)} lines, ceiling ${String(ceiling)}`,
        )
      }
    }
  }
  for (const key of ceilings.keys()) {
    if (!fileExists(resolve(root, key))) {
      violations.push(`tintin line baseline references a missing file: ${key}`)
    }
  }
  return violations
}

function checkWorkspaceRegistration({ root, readJson }) {
  const violations = []
  const workspace = readJson(resolve(root, 'package.json'))
  const declared = new Set(workspace?.workspaces ?? [])
  for (const directory of TINTIN_WORKSPACE_GLOBS) {
    const manifestPath = resolve(root, directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    if (!declared.has(directory)) {
      violations.push(`${directory} exists but is not registered in the root workspaces`)
    }
    const manifest = readJsonSafe(manifestPath)
    if (manifest?.packageManager !== undefined) {
      violations.push(`${directory} must inherit the root Yarn release`)
    }
    if (manifest?.name !== undefined && manifest.name !== directory) {
      violations.push(`${directory} must publish as ${directory}`)
    }
  }
  return violations
}

export function verifyTintinGate({ root, readText, readJson, listFiles, fileExists, anchors, lineBaseline }) {
  const violations = [
    ...checkAnchors({ root, anchors, readText }),
    ...checkLineGate({ root, baseline: lineBaseline, listFiles, readText, ...(fileExists === undefined ? {} : { fileExists }) }),
    ...checkWorkspaceRegistration({ root, readJson }),
  ]
  return violations
}

const root = resolve(import.meta.dirname, '..')
const run = (args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()

// Import-safe production entry: unit tests import this module for its check
// functions, so the gate itself only runs when executed as the main module.
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
const anchors = readJsonSafe(resolve(root, 'scripts/tintin-anchors.json'))
const lineBaseline = readJsonSafe(resolve(root, 'scripts/tintin-line-baseline.json'))
if (anchors === undefined) throw new Error('verify-tintin-gate: scripts/tintin-anchors.json is missing or invalid')
if (lineBaseline === undefined) throw new Error('verify-tintin-gate: scripts/tintin-line-baseline.json is missing or invalid')

const violations = verifyTintinGate({
  root,
  readText: path => readFileSync(path, 'utf8'),
  readJson: path => JSON.parse(readFileSync(path, 'utf8')),
  listFiles: listSourceFiles,
  anchors,
  lineBaseline,
})

if (violations.length > 0) {
  process.stderr.write(`verify-tintin-gate: FAILED\n- ${violations.join('\n- ')}\n`)
  process.exit(1)
}

const anchoredFiles = new Set(anchors.map(anchor => anchor.path))
process.stdout.write(
  `verify-tintin-gate: ${String(anchors.length)} anchors over ${String(anchoredFiles.size)} documents and ${String(Object.keys(lineBaseline).length)} baseline entries are consistent\n`,
)
}
