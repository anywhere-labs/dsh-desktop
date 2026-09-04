import { describe, expect, it } from 'vitest'
import { resolvePlatformConfig } from '../src/connectors/platform-config.js'

describe('platform configuration', () => {
  it('resolves credentials from environment references without storing secret values', () => {
    const config = resolvePlatformConfig({ platform: 'taobao', baseUrl: 'https://api.example.invalid', tokenEnv: 'TEST_TAOBAO_TOKEN' }, { TEST_TAOBAO_TOKEN: 'secret' })
    expect(config.state).toBe('READY')
    expect(config.token).toBe('secret')
    expect(config.redacted.tokenConfigured).toBe(true)
    expect(JSON.stringify(config.redacted)).not.toContain('secret')
  })
})
