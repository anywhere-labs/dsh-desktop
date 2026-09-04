export interface PlatformConfigInput {
  readonly platform: string
  readonly baseUrl: string
  readonly tokenEnv: string
}

export interface ResolvedPlatformConfig {
  readonly platform: string
  readonly baseUrl: string
  readonly token: string | undefined
  readonly state: 'READY' | 'NOT_CONFIGURED'
  readonly redacted: { readonly platform: string; readonly baseUrl: string; readonly tokenConfigured: boolean }
}

export function resolvePlatformConfig(input: PlatformConfigInput, env: Record<string, string | undefined> = process.env): ResolvedPlatformConfig {
  const token = env[input.tokenEnv]?.trim() || undefined
  return { platform: input.platform, baseUrl: input.baseUrl, token, state: token ? 'READY' : 'NOT_CONFIGURED', redacted: { platform: input.platform, baseUrl: input.baseUrl, tokenConfigured: Boolean(token) } }
}
