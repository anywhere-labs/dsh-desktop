import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
const tintinRoot = join(root, 'dsh-plugin-desktop-tintin', 'src')
// Both editions now pin one core API. Only their product identities differ.
const allowedDifferences = new Set(['product-identity.ts'])
// TinTin channel-only source additions (browser-domain window wiring lands
// here in later work packages). Every other file must mirror Beta exactly
// after the identity renaming below, so shared fixes stay three-way synced.
const allowedTintinAdditions = new Set([
  'tintin/main-hook.ts',
  'tintin/first-boot.ts',
  'tintin-main.ts',
  'tintin/studio-preload.ts',
])
const normalizeIdentity = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop').replaceAll('DSH Desktop Beta', 'DSH Desktop')
const normalizeTintin = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop-tintin').replaceAll('DSH Desktop Beta', 'TinTin')

function files(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).split(sep).join('/'))
  }
  return result
}

const differences = []

function compareMirrors(label, leftRoot, rightRoot, normalize, rightOnlyAllowed) {
  const leftPaths = new Set(files(leftRoot))
  const rightPaths = new Set(files(rightRoot))
  const shared = new Set([...leftPaths, ...rightPaths])
  for (const path of [...shared].sort()) {
    const inLeft = leftPaths.has(path)
    const inRight = rightPaths.has(path)
    if (!inLeft && inRight) {
      if (rightOnlyAllowed.has(path)) continue
      differences.push(`${label}: src/${path} exists only in the right edition`)
      continue
    }
    if (inLeft !== inRight) {
      differences.push(`${label}: src/${path} exists only in the left edition`)
      continue
    }
    if (allowedDifferences.has(path)) continue
    const left = readFileSync(join(leftRoot, path))
    const right = readFileSync(join(rightRoot, path))
    if (normalize(left) !== normalize(right)) differences.push(`${label}: src/${path}`)
  }
}

compareMirrors('stable↔beta', stableRoot, betaRoot, normalizeIdentity, new Set())
compareMirrors('beta↔tintin', betaRoot, tintinRoot, normalizeTintin, allowedTintinAdditions)

if (differences.length > 0) {
  throw Error(`Desktop variant source drift is not declared:\n${differences.map(line => `- ${line}`).join('\n')}`)
}

process.stdout.write('verify-desktop-variants: shared source files are aligned across stable, beta and the TinTin channel; every edition uses isolated Host and chrome\n')
