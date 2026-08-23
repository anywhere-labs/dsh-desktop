/** Process-scoped AERA Gateway credential bootstrap for normal Finder launches. */

import { execFileSync } from 'node:child_process'
import { AERA_CODE_PRODUCT } from './product-brand.ts'

export type AeraGatewayCredentialBootstrap =
  | 'not-required'
  | 'already-present'
  | 'loaded-from-keychain'

export interface AeraGatewayKeychainOptions {
  readonly platform?: NodeJS.Platform
  readonly environment?: NodeJS.ProcessEnv
  readonly activeProfile: string
  readonly readPassword?: (service: string, account: string) => string
}

function readMacKeychainPassword(service: string, account: string): string {
  return execFileSync('/usr/bin/security', [
    'find-generic-password',
    '-a', account,
    '-s', service,
    '-w',
  ], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/**
 * Resolve the existing governed credential only for the accepted Gateway
 * profile. The value exists solely in this process environment and is never
 * written to app data, configuration, diagnostics, or the application bundle.
 */
export function bootstrapAeraGatewayCredential(options: AeraGatewayKeychainOptions): AeraGatewayCredentialBootstrap {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  if (options.activeProfile !== AERA_CODE_PRODUCT.gatewayProfileName || platform !== 'darwin') return 'not-required'
  const name = AERA_CODE_PRODUCT.gatewayCredentialEnvironmentName
  if (typeof environment[name] === 'string' && environment[name]!.length > 0) return 'already-present'
  const value = (options.readPassword ?? readMacKeychainPassword)(
    AERA_CODE_PRODUCT.gatewayKeychainService,
    AERA_CODE_PRODUCT.gatewayKeychainAccount,
  )
  if (value.length === 0) throw new Error('Aera Code could not resolve the governed AERA Gateway credential from Keychain')
  environment[name] = value
  return 'loaded-from-keychain'
}
