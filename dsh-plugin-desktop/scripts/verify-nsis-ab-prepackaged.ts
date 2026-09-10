/** Guarded afterAll hook for NSIS-only builds that consume an already verified app. */

import { existsSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NSIS_AB_HOOK_TOKEN_ENV = 'DSH_NSIS_AB_PREPACKAGED_HOOK_TOKEN'
export const NSIS_AB_HOOK_AUTHORIZATION_FILE = '.dsh-nsis-ab-after-all.json'

interface NsisAbHookAuthorization {
  readonly schemaVersion: 1
  readonly token: string
  readonly variant: 'direct' | 'staged'
  readonly prepackaged: string
}

export interface NsisAbPrepackagedBuildResult {
  readonly outDir: string
}

export interface NsisAbPrepackagedHookOptions {
  readonly desktopRoot?: string
  readonly env?: NodeJS.ProcessEnv
}

/**
 * The shared `--dir` build has already run the normal post-fuse runtime gate.
 * NSIS `--prepackaged` runs produce only an installer, so they must not try to
 * rediscover a `win-unpacked` directory below their distinct artifact folder.
 * Keep this escape hatch narrowly bound to dist/nsis-ab/<label>/{direct,staged}.
 */
export default function verifyNsisAbPrepackagedBuild(
  result: NsisAbPrepackagedBuildResult,
  options: NsisAbPrepackagedHookOptions = {},
): string[] {
  const desktopRoot = realpathSync(options.desktopRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  const allowedRoot = realpathSync(join(desktopRoot, 'dist', 'nsis-ab'))
  const output = realpathSync(resolve(result.outDir))
  const outputRelation = relative(allowedRoot, output)
  const outputParts = outputRelation.split(sep)
  const variant = basename(output)
  if (
    outputRelation === ''
    || outputRelation === '..'
    || outputRelation.startsWith(`..${sep}`)
    || isAbsolute(outputRelation)
    || outputParts.length !== 2
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(outputParts[0] ?? '')
    || !['direct', 'staged'].includes(variant)
  ) {
    throw new Error(`refusing to skip the packaged-runtime gate outside an NSIS A/B artifact build: ${output}`)
  }
  const authorizationPath = join(output, NSIS_AB_HOOK_AUTHORIZATION_FILE)
  const environmentToken = (options.env ?? process.env)[NSIS_AB_HOOK_TOKEN_ENV]
  if (environmentToken === undefined || !/^[0-9a-f]{32}$/u.test(environmentToken)) {
    throw new Error('NSIS A/B prepackaged hook authorization token is missing or malformed')
  }
  let authorization: NsisAbHookAuthorization
  try {
    authorization = JSON.parse(readFileSync(authorizationPath, 'utf8')) as NsisAbHookAuthorization
  } catch (cause) {
    throw new Error('NSIS A/B prepackaged hook authorization is missing or unreadable', { cause })
  }
  if (
    authorization.schemaVersion !== 1
    || authorization.token !== environmentToken
    || authorization.variant !== variant
  ) {
    throw new Error('NSIS A/B prepackaged hook authorization does not match this build')
  }
  const labelRoot = dirname(output)
  const expectedPrepackaged = join(labelRoot, 'prepackaged', 'win-unpacked')
  const prepackaged = realpathSync(resolve(authorization.prepackaged))
  if (
    prepackaged !== realpathSync(expectedPrepackaged)
    || !existsSync(join(prepackaged, 'resources', 'app.asar'))
  ) {
    throw new Error('NSIS A/B prepackaged hook authorization does not name the verified shared application')
  }
  const unpackedOutputs = readdirSync(output, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /-unpacked$/u.test(entry.name))
    .map(entry => entry.name)
  if (unpackedOutputs.length > 0) {
    throw new Error(
      `NSIS A/B installer-only output unexpectedly contains unpacked applications: ${unpackedOutputs.join(', ')}`,
    )
  }
  // Consuming the marker makes the bypass single-use. The builder verifies its
  // removal after the hook returns, so a missing hook cannot silently pass.
  unlinkSync(authorizationPath)
  return []
}
