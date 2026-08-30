import { prerelease, valid } from 'semver'
import type { CatalogHttpClient, NormalizedGitHubInstallSource } from '../contracts/index.js'

const RAW_GITHUB_ORIGIN = 'https://raw.githubusercontent.com'
const GITHUB_API_ORIGIN = 'https://api.github.com'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/iu
const REPOSITORY_PATTERN = /^[a-z0-9._-]{1,100}$/iu
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const MAX_MANIFEST_BYTES = 1024 * 1024
const BLOCKED_PACKAGES = new Set(['dsh-plugin-desktop', 'dsh-community-market'])
/** The `github:owner/repo[#ref][&path:/subdir]` spec accepted for upgrades. */
const GITHUB_SPEC_PATTERN = /^github:([a-z0-9][a-z0-9-]{0,99})\/([a-z0-9._-]{1,100})(?:#([^&\s]+))?(?:&path:\/([^&\s]+))?$/iu
/** Refs that pnpm treats specially (commit hashes, tags, branch names). */
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u

export interface GitHubPackageVerification {
  readonly packageName: string
  readonly version: string
  readonly bundlePatch: string
  readonly source: NormalizedGitHubInstallSource
}

function fail(message: string): never {
  throw new Error(`GitHub package verification failed: ${message}`)
}

function stableExactVersion(value: unknown): value is string {
  return typeof value === 'string'
    && valid(value, { loose: false }) === value
    && prerelease(value, { loose: false }) === null
}

function safeBundlePatch(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) return false
  const path = value.startsWith('./') ? value.slice(2) : value
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'))
}

function packageName(value: unknown): value is string {
  return typeof value === 'string' && PACKAGE_NAME_PATTERN.test(value) && !BLOCKED_PACKAGES.has(value)
}

function assertSource(source: NormalizedGitHubInstallSource): void {
  if (
    source.kind !== 'github'
    || !OWNER_PATTERN.test(source.owner)
    || !REPOSITORY_PATTERN.test(source.repo)
    || !COMMIT_PATTERN.test(source.commit)
  ) fail('source identity is invalid')
}

export function githubPackageTarget(source: NormalizedGitHubInstallSource): string {
  assertSource(source)
  const path = source.subdirectory === undefined ? '' : `&path:/${source.subdirectory}`
  return `github:${source.owner}/${source.repo}#${source.commit}${path}`
}

export function githubPackageManifestUrl(source: NormalizedGitHubInstallSource): string {
  assertSource(source)
  const subdirectory = source.subdirectory === undefined ? '' : `${source.subdirectory}/`
  return `${RAW_GITHUB_ORIGIN}/${source.owner}/${source.repo}/${source.commit}/${subdirectory}package.json`
}

function readManifest(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('package.json is not an object')
  return value as Record<string, unknown>
}

export function createGitHubPackageVerifier(http: CatalogHttpClient) {
  return {
    async verify(source: NormalizedGitHubInstallSource, signal: AbortSignal): Promise<GitHubPackageVerification> {
      const url = githubPackageManifestUrl(source)
      let response
      try {
        response = await http.getJson(url, signal, { allowedOrigin: RAW_GITHUB_ORIGIN, allowTextPlain: true })
      } catch {
        fail('package.json could not be fetched from the pinned commit')
      }
      if (response.finalUrl !== url) fail('package.json request redirected or changed path')
      const manifest = readManifest(response.value)
      const packageNameValue = manifest.name
      const versionValue = manifest.version
      if (!packageName(packageNameValue)) fail('package name is invalid')
      if (!stableExactVersion(versionValue)) fail('package version must be an exact stable semver')
      const dsh = manifest.dsh
      const bundle = dsh !== null && typeof dsh === 'object' && !Array.isArray(dsh)
        ? (dsh as Record<string, unknown>).bundle
        : undefined
      const patch = bundle !== null && typeof bundle === 'object' && !Array.isArray(bundle)
        ? (bundle as Record<string, unknown>).patch
        : undefined
      if (!safeBundlePatch(patch)) fail('package does not declare a valid DSH bundle')
      return { packageName: packageNameValue, version: versionValue, bundlePatch: patch, source }
    },
  }
}

export const githubPackageManifestLimits = Object.freeze({ maxBytes: MAX_MANIFEST_BYTES })

export interface ParsedGitHubDependencySpec {
  readonly owner: string
  readonly repo: string
  /** Pinned 40-hex commit when the spec carried one; a moving ref otherwise. */
  readonly commit?: string
  /** Non-commit ref (branch or tag) written by a CLI install. */
  readonly ref?: string
  readonly subdirectory?: string
}

/** Reject any subdirectory that could escape the repository root. */
function normalizeSpecSubdirectory(value: string): string | undefined {
  const path = value.startsWith('./') ? value.slice(2) : value
  if (
    path.length === 0
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'))
  ) return undefined
  return path
}

/**
 * Parse the GitHub dependency spec pnpm stores for a `github:owner/repo`
 * install: commit-pinned specs written by this Host (`#commit[&path:/subdir]`)
 * as well as branch, tag, or ref-less specs written by CLI installs. Online
 * upgrades always re-pin to a verified default-branch HEAD commit.
 */
export function parseGitHubDependencySpec(spec: string): ParsedGitHubDependencySpec | undefined {
  if (typeof spec !== 'string' || spec.length === 0 || spec.length > 512) return undefined
  const match = GITHUB_SPEC_PATTERN.exec(spec)
  if (match === null) return undefined
  const owner = match[1]!
  const repo = match[2]!
  const rawRef = match[3]
  const rawSubdirectory = match[4]
  if (rawSubdirectory !== undefined) {
    const subdirectory = normalizeSpecSubdirectory(rawSubdirectory)
    if (subdirectory === undefined) return undefined
    if (rawRef === undefined) return { owner, repo, subdirectory }
    if (COMMIT_PATTERN.test(rawRef)) return { owner, repo, commit: rawRef, subdirectory }
    if (!REF_PATTERN.test(rawRef)) return undefined
    return { owner, repo, ref: rawRef, subdirectory }
  }
  if (rawRef === undefined) return { owner, repo }
  if (COMMIT_PATTERN.test(rawRef)) return { owner, repo, commit: rawRef }
  if (!REF_PATTERN.test(rawRef)) return undefined
  return { owner, repo, ref: rawRef }
}

/**
 * Resolve the default-branch HEAD commit of a repository. The commits/HEAD
 * endpoint follows renamed-repository redirects within api.github.com, so the
 * allowed-origin check keeps passing on the final URL.
 */
export function createGitHubHeadResolver(http: CatalogHttpClient) {
  return {
    async resolve(owner: string, repo: string, signal: AbortSignal): Promise<string> {
      const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/HEAD`
      let response
      try {
        response = await http.getJson(url, signal, { allowedOrigin: GITHUB_API_ORIGIN })
      } catch {
        throw new Error('GitHub repository HEAD resolution failed')
      }
      let finalOrigin: string
      try { finalOrigin = new URL(response.finalUrl).origin }
      catch { throw new Error('GitHub repository HEAD resolution redirected to an invalid URL') }
      if (finalOrigin !== GITHUB_API_ORIGIN) {
        throw new Error('GitHub repository HEAD resolution redirected away from GitHub')
      }
      const value = response.value
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('GitHub repository HEAD response was invalid')
      }
      const commit = (value as Record<string, unknown>).sha
      if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
        throw new Error('GitHub repository HEAD commit was invalid')
      }
      return commit
    },
  }
}
