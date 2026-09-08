/** Resolve the DSH version from the runtime package actually installed with Desktop. */

import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseSemVer } from './update-checker.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
const MAX_MANIFEST_BYTES = 1024 * 1024

/** Read and validate the installed `@deepseek-ai/dsh` package version. */
export function dshProductVersion(moduleUrl: string | URL = import.meta.url): string {
  const manifestPath = createRequire(moduleUrl).resolve(`${DSH_PACKAGE_NAME}/package.json`)
  const size = statSync(manifestPath).size
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${BIN_NAME}: installed DSH package manifest is too large`)
  }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  } catch (cause) {
    throw new Error(
      `${BIN_NAME}: cannot read installed DSH package manifest: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (value as { name?: unknown }).name !== DSH_PACKAGE_NAME) {
    throw new Error(`${BIN_NAME}: installed DSH package manifest has an invalid identity`)
  }
  const version = (value as { version?: unknown }).version
  if (typeof version !== 'string') {
    throw new Error(`${BIN_NAME}: installed DSH package manifest has no version`)
  }
  const parsed = parseSemVer(version)
  if (parsed === null || parsed.version !== version) {
    throw new Error(`${BIN_NAME}: installed DSH package version is not canonical Semantic Versioning`)
  }
  return version
}
