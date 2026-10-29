import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const nextRoot = join(root, 'dsh-desktop-next')
const betaRoot = join(root, 'dsh-plugin-desktop-beta')

const SYNCED_FILES = [
  'package.json',
  'cordis.patch.yml',
  'host.cordis.patch.yml',
  'tsconfig.json',
  'tsconfig.packaging.json',
  'tsdown.config.ts',
  'vite.client.config.ts',
  'vite.native-ui.config.ts',
  'vitest.config.ts',
]

const SYNCED_DIRECTORIES = [
  'assets',
  'scripts',
  'src',
  'tests',
]

const OBSOLETE_BETA_FILES = [
  'components.json',
  'tsconfig.client.json',
  'tsconfig.native-ui.json',
  'tsconfig.tests.client.json',
  'tsconfig.tests.json',
]

// Beta and Next may follow different upstream releases (the beta and next channels in
// upstream.json). While they do, each keeps its own upstream-family dependency pins in
// package.json, and the API differences live only in these files.
const UPSTREAM_FAMILY_FILES = [
  'src/upstream-family.ts',
  'src/upstream-family-labels.ts',
  'tests/upstream-family.ts',
]

const UPSTREAM_FAMILY_DEPENDENCY = /^@deepseek-ai\/(?:dsh|dsh-.+|cordis|cordis-plugin-.+|schemastery|cosmokit)$/u
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

function withoutUpstreamFamily(manifest) {
  const copy = { ...manifest }
  for (const field of DEPENDENCY_FIELDS) {
    if (copy[field] === undefined) continue
    const rest = Object.entries(copy[field]).filter(([name]) => !UPSTREAM_FAMILY_DEPENDENCY.test(name))
    if (rest.length > 0) copy[field] = Object.fromEntries(rest)
    else delete copy[field]
  }
  return copy
}

/**
 * Compare two manifests, ignoring upstream-family dependency pins.
 * @param left - one variant's package.json text.
 * @param right - the other variant's package.json text.
 * @returns whether everything but those pins is identical.
 */
export function sameOutsideUpstreamFamily(left, right) {
  return JSON.stringify(withoutUpstreamFamily(JSON.parse(left))) === JSON.stringify(withoutUpstreamFamily(JSON.parse(right)))
}

/**
 * Keep the target's own upstream-family pins in a manifest synced from the other variant.
 * @param synced - the source manifest after the variant transform.
 * @param target - the target manifest before the sync.
 * @returns the synced manifest text with the target's pins, each dependency map sorted by name.
 */
export function keepUpstreamFamily(synced, target) {
  const manifest = JSON.parse(synced)
  const own = JSON.parse(target)
  for (const field of DEPENDENCY_FIELDS) {
    if (manifest[field] === undefined && own[field] === undefined) continue
    const entries = [
      ...Object.entries(manifest[field] ?? {}).filter(([name]) => !UPSTREAM_FAMILY_DEPENDENCY.test(name)),
      ...Object.entries(own[field] ?? {}).filter(([name]) => UPSTREAM_FAMILY_DEPENDENCY.test(name)),
    ].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    manifest[field] = Object.fromEntries(entries)
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

const BINARY_EXTENSIONS = new Set(['.png', '.webp', '.ico', '.icns'])

function isBinaryPath(relativePath) {
  return BINARY_EXTENSIONS.has(extname(relativePath).toLowerCase())
}

const FILE_SPECIFIC_PAIRS = {
  'package.json': [
    [
      '"description": "Experimental upstream-inspired DSH Desktop with Profiles, recovery, remote control and Community Market"',
      '"description": "Desktop Beta integration for the DeepSeek Harness"',
    ],
    ['--channel next', '--channel beta'],
    [
      'Agentic coding desktop for the DeepSeek Harness (Next)',
      'Agentic coding desktop for the DeepSeek Harness (Beta)',
    ],
    ['"desktopName": "dsh-desktop-next.desktop"', '"desktopName": "dsh-desktop-beta.desktop"'],
    ['"executableName": "dsh-desktop-next"', '"executableName": "dsh-desktop-beta"'],
    ['"packageName": "dsh-desktop-next"', '"packageName": "dsh-desktop-beta"'],
  ],
  'src/data-directory.ts': [
    ["join(userHome, '.dsh')", "join(userHome, '.dsh-beta')"],
  ],
  'tests/data-directory.spec.ts': [
    ["join(user, '.dsh')", "join(user, '.dsh-beta')"],
  ],
  'src/native-ui/onboarding.tsx': [
    ['<span>NEXT</span>', '<span>BETA</span>'],
  ],
}

const GLOBAL_PAIRS = [
  ['linux-unpacked/dsh-desktop-next', 'linux-unpacked/dsh-desktop-beta'],
  ["'linux-unpacked', 'dsh-desktop-next'", "'linux-unpacked', 'dsh-desktop-beta'"],
  ['ai.deepseek.dsh.desktop.next', 'ai.deepseek.dsh.desktop.beta'],
  ['dsh-desktop-next', 'dsh-plugin-desktop-beta'],
  ['DSH NEXT', 'DSH Desktop Beta'],
  ['DSH-NEXT-', 'DSH-Desktop-Beta-'],
  ["sanitizedName: 'DSH-NEXT'", "sanitizedName: 'DSH-Desktop-Beta'"],
  ['DSH_NEXT_BUILD_VERSION', 'DSH_BETA_BUILD_VERSION'],
  ['-next(?:\\.[0-9]+)?', '-beta(?:\\.[0-9]+)?'],
  ['x.y.z-next or x.y.z-next.N', 'x.y.z-beta or x.y.z-beta.N'],
  ["channel: 'next'", "channel: 'beta'"],
  ["'X-DSH-Desktop-Channel': 'next'", "'X-DSH-Desktop-Channel': 'beta'"],
  ["toBe('next')", "toBe('beta')"],
  [
    "desktopUpdateFilename(platform, result.latestVersion, 'next')",
    "desktopUpdateFilename(platform, result.latestVersion, 'beta')",
  ],
]

// Next and Beta may follow different upstream DSH runtimes. While they do, the runtime version is a
// declared difference, the upstream family above may differ, and lines between `// next-lead:start`
// and `// next-lead:end` exist only in Next. Once both follow one runtime, remove the markers so those
// lines become shared; the upstream-family files must then mirror as well.
const { channels } = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const runtimesDiffer = channels.next.runtimePackageVersion !== channels.beta.runtimePackageVersion
const RUNTIME_PAIRS = runtimesDiffer ? [[channels.next.runtimePackageVersion, channels.beta.runtimePackageVersion]] : []
const NEXT_LEAD_REGION = /^[ \t]*\/\/ next-lead:start\n[\s\S]*?^[ \t]*\/\/ next-lead:end\n/gmu

function withoutNextLead(text) {
  return text.replace(NEXT_LEAD_REGION, '')
}

export function toBetaContent(relativePath, sourceText) {
  let text = withoutNextLead(sourceText)
  for (const [nextStr, betaStr] of FILE_SPECIFIC_PAIRS[relativePath] ?? []) {
    text = text.replaceAll(nextStr, betaStr)
  }
  for (const [nextStr, betaStr] of [...GLOBAL_PAIRS, ...RUNTIME_PAIRS]) {
    text = text.replaceAll(nextStr, betaStr)
  }
  return text
    .replace(
      /(\b\d+\.\d+\.\d+)-next(?:\.(\d+))?\b/gu,
      (_, ver, rev) => `${ver}-beta.${rev ? String(Number(rev) + 1) : '1'}`,
    )
    .replace(
      /(\b\d+\\\.\d+\\\.\d+)-next(?:\\\.(\d+))?\b/gu,
      (_, ver, rev) => `${ver}-beta\\.${rev ? String(Number(rev) + 1) : '1'}`,
    )
    .replace(
      /(\b\d+\\\\\.\d+\\\\\.\d+)-next(?:\\\\\.(\d+))?\b/gu,
      (_, ver, rev) => `${ver}-beta\\\\.${rev ? String(Number(rev) + 1) : '1'}`,
    )
}

export function toNextContent(relativePath, sourceText) {
  let text = sourceText
    .replace(
      /(\b\d+\\\\\.\d+\\\\\.\d+)-beta\\\\\.(\d+)\b/gu,
      (_, ver, rev) => (Number(rev) <= 1 ? `${ver}-next` : `${ver}-next\\\\.${String(Number(rev) - 1)}`),
    )
    .replace(
      /(\b\d+\\\.\d+\\\.\d+)-beta\\\.(\d+)\b/gu,
      (_, ver, rev) => (Number(rev) <= 1 ? `${ver}-next` : `${ver}-next\\.${String(Number(rev) - 1)}`),
    )
    .replace(
      /(\b\d+\.\d+\.\d+)-beta\.(\d+)\b/gu,
      (_, ver, rev) => (Number(rev) <= 1 ? `${ver}-next` : `${ver}-next.${String(Number(rev) - 1)}`),
    )
  for (const [nextStr, betaStr] of [...GLOBAL_PAIRS, ...RUNTIME_PAIRS].reverse()) {
    text = text.replaceAll(betaStr, nextStr)
  }
  for (const [nextStr, betaStr] of [...(FILE_SPECIFIC_PAIRS[relativePath] ?? [])].reverse()) {
    text = text.replaceAll(betaStr, nextStr)
  }
  return text
}

function listDirectoryFiles(baseDir, subDir) {
  const dir = join(baseDir, subDir)
  if (!existsSync(dir)) return []
  const result = []
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile()) result.push(relative(baseDir, fullPath).split(sep).join('/'))
    }
  }
  walk(dir)
  return result
}

function collectSyncedPaths() {
  const paths = new Set(SYNCED_FILES)
  for (const dir of SYNCED_DIRECTORIES) {
    for (const file of listDirectoryFiles(nextRoot, dir)) paths.add(file)
    for (const file of listDirectoryFiles(betaRoot, dir)) paths.add(file)
  }
  return [...paths].sort()
}

export function syncVariants(direction = 'beta-to-next') {
  for (const obsolete of OBSOLETE_BETA_FILES) {
    rmSync(join(betaRoot, obsolete), { force: true })
    rmSync(join(nextRoot, obsolete), { force: true })
  }
  const isBetaToNext = direction === 'beta-to-next'
  const sourceRoot = isBetaToNext ? betaRoot : nextRoot
  const targetRoot = isBetaToNext ? nextRoot : betaRoot
  const sourceName = isBetaToNext ? 'dsh-plugin-desktop-beta' : 'dsh-desktop-next'
  const targetName = isBetaToNext ? 'dsh-desktop-next' : 'dsh-plugin-desktop-beta'
  const transform = isBetaToNext ? toNextContent : toBetaContent
  const ownedByTarget = relPath => runtimesDiffer && UPSTREAM_FAMILY_FILES.includes(relPath)

  const sourcePaths = new Set(SYNCED_FILES)
  for (const dir of SYNCED_DIRECTORIES) {
    for (const file of listDirectoryFiles(sourceRoot, dir)) sourcePaths.add(file)
  }
  for (const dir of SYNCED_DIRECTORIES) {
    for (const targetFile of listDirectoryFiles(targetRoot, dir)) {
      if (!sourcePaths.has(targetFile) && !ownedByTarget(targetFile)) {
        rmSync(join(targetRoot, ...targetFile.split('/')), { force: true })
      }
    }
  }
  for (const relPath of [...sourcePaths].sort()) {
    if (ownedByTarget(relPath)) continue
    const sourceFile = join(sourceRoot, ...relPath.split('/'))
    const targetFile = join(targetRoot, ...relPath.split('/'))
    mkdirSync(dirname(targetFile), { recursive: true })
    if (isBinaryPath(relPath)) {
      writeFileSync(targetFile, readFileSync(sourceFile))
    } else {
      const transformed = transform(relPath, readFileSync(sourceFile, 'utf8'))
      const kept = runtimesDiffer && relPath === 'package.json' && existsSync(targetFile)
        ? keepUpstreamFamily(transformed, readFileSync(targetFile, 'utf8'))
        : transformed
      const current = isBetaToNext && existsSync(targetFile) ? readFileSync(targetFile, 'utf8') : undefined
      if (current !== undefined && current !== withoutNextLead(current)) {
        // Beta cannot reproduce Next-lead lines; keep Next's copy when its shared lines already match.
        if (withoutNextLead(current) === kept) continue
        throw new Error(`${relPath} carries Next-lead lines; edit it in Next and sync with --from=next`)
      }
      writeFileSync(targetFile, kept, 'utf8')
    }
    chmodSync(targetFile, statSync(sourceFile).mode)
  }
  process.stdout.write(`verify-desktop-variants: synced ${String(sourcePaths.size)} files from ${sourceName} to ${targetName}${runtimesDiffer ? ', keeping the target\'s upstream family' : ''}\n`)
}

export function verifyVariants() {
  const differences = []
  for (const obsolete of OBSOLETE_BETA_FILES) {
    if (existsSync(join(betaRoot, obsolete))) differences.push(`${obsolete} (obsolete file must be removed)`)
  }
  const allPaths = collectSyncedPaths()
  for (const relPath of [...new Set([...allPaths, ...UPSTREAM_FAMILY_FILES])].sort()) {
    const nextFile = join(nextRoot, ...relPath.split('/'))
    const betaFile = join(betaRoot, ...relPath.split('/'))
    if (!existsSync(nextFile) || !existsSync(betaFile)) {
      differences.push(relPath)
      continue
    }
    if (process.platform !== 'win32') {
      const nextExec = (statSync(nextFile).mode & 0o111) !== 0
      const betaExec = (statSync(betaFile).mode & 0o111) !== 0
      if (nextExec !== betaExec) {
        differences.push(`${relPath} (executable permission mismatch)`)
        continue
      }
    }
    if (runtimesDiffer && UPSTREAM_FAMILY_FILES.includes(relPath)) continue
    if (isBinaryPath(relPath)) {
      if (!readFileSync(nextFile).equals(readFileSync(betaFile))) differences.push(relPath)
    } else {
      const actualNext = readFileSync(nextFile, 'utf8')
      const actualBeta = readFileSync(betaFile, 'utf8')
      const expectedBeta = toBetaContent(relPath, actualNext)
      const expectedNext = toNextContent(relPath, actualBeta)
      const aligned = runtimesDiffer && relPath === 'package.json'
        ? sameOutsideUpstreamFamily(expectedBeta, actualBeta) && sameOutsideUpstreamFamily(expectedNext, actualNext)
        : expectedBeta === actualBeta && expectedNext === withoutNextLead(actualNext)
      if (!aligned) {
        differences.push(relPath)
      } else if (!runtimesDiffer && actualNext !== withoutNextLead(actualNext)) {
        differences.push(`${relPath} (Beta now uses Next's runtime; remove the next-lead markers and share their lines)`)
      }
    }
  }

  if (differences.length > 0) {
    throw new Error(`Desktop variant source drift between Next and Beta is not declared:\n${differences.map(path => `- ${path}`).join('\n')}`)
  }

  const declared = runtimesDiffer
    ? `; Beta follows upstream ${channels.beta.runtimePackageVersion} and Next ${channels.next.runtimePackageVersion}, so their upstream-family pins, ${UPSTREAM_FAMILY_FILES.join(', ')} and Next-lead lines differ`
    : ''
  process.stdout.write(`verify-desktop-variants: ${String(allPaths.length)} files are aligned between Next and Beta${declared}\n`)
}

const args = new Set(process.argv.slice(2))
if (args.has('--from=next') || args.has('--sync=beta') || args.has('--next-to-beta')) {
  syncVariants('next-to-beta')
} else if (args.has('--sync') || args.has('--from=beta') || args.has('--sync=next') || args.has('--beta-to-next')) {
  syncVariants('beta-to-next')
} else {
  verifyVariants()
}
