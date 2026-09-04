export function resolvePlatformConfig(input, env = process.env) {
    const token = env[input.tokenEnv]?.trim() || undefined;
    return { platform: input.platform, baseUrl: input.baseUrl, token, state: token ? 'READY' : 'NOT_CONFIGURED', redacted: { platform: input.platform, baseUrl: input.baseUrl, tokenConfigured: Boolean(token) } };
}
