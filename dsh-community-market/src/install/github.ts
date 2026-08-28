import { prerelease, valid } from 'semver'
import type { CatalogHttpClient, NormalizedGitHubInstallSource } from '../contracts/index.js'

const RAW_GITHUB_ORIGIN = 'https://raw.githubusercontent.com'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/iu
const REPOSITORY_PATTERN = /^[a-z0-9._-]{1,100}$/iu
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const MAX_MANIFEST_BYTES = 1024 * 1024
const BLOCKED_PACKAGES = new Set(['dsh-plugin-desktop', 'dsh-community-market'])

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
        response = await http.getJson(url, signal, { allowedOrigin: RAW_GITHUB_ORIGIN })
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
