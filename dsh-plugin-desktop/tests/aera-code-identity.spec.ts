import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { migrateAeraCodeUserData } from '../src/aera-code-state-migration.ts'
import { bootstrapAeraGatewayCredential } from '../src/aera-gateway-keychain.ts'
import { AERA_CODE_PRODUCT } from '../src/product-brand.ts'

describe('Aera Code native identity', () => {
  it('centralizes the owner-facing product profile', () => {
    expect(AERA_CODE_PRODUCT).toMatchObject({
      productName: 'Aera Code',
      bundleIdentifier: 'dev.aerastudios.code',
      userDataDirectoryName: 'Aera Code',
      legacyUserDataDirectoryName: 'DSH Desktop',
      gatewayProfileName: 'aera-gateway-eval',
    })
  })

  it('makes Gateway standard and removes upstream model branding from the projection', () => {
    const overlay = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
    const conversationPatch = readFileSync(join(
      process.cwd(),
      '..',
      '.yarn',
      'patches',
      '@deepseek-ai-dsh-client-ui-conversation-npm-0.1.1-rc.2-941ef6a7f5.patch',
    ), 'utf8')

    expect(overlay).toContain('provider: aera-gateway')
    expect(overlay).toContain('model: aera/active')
    expect(overlay).toMatch(/id: llm-deepseek[\s\S]*disabled: true/)
    expect(conversationPatch).toContain('Aera Code system context')
  })

  it('migrates only allowlisted non-secret launcher state', () => {
    const root = mkdtempSync(join(tmpdir(), 'aera-code-migration-'))
    const legacy = join(root, 'DSH Desktop')
    const target = join(root, 'Aera Code')
    mkdirSync(join(legacy, 'profile-selection'), { recursive: true })
    mkdirSync(join(legacy, 'Local Storage'), { recursive: true })
    writeFileSync(join(legacy, 'profile-selection', 'state.json'), '{"version":1,"active":"aera-gateway-eval","lastKnownGood":"aera-gateway-eval"}')
    writeFileSync(join(legacy, 'Cookies'), 'must-not-migrate')
    writeFileSync(join(legacy, 'Local Storage', 'credential.json'), 'must-not-migrate')

    const result = migrateAeraCodeUserData(legacy, target)

    expect(result).toEqual({ status: 'migrated', migrated: ['profile-selection/state.json'] })
    expect(readFileSync(join(target, 'profile-selection', 'state.json'), 'utf8')).toContain('aera-gateway-eval')
    expect(existsSync(join(target, 'Cookies'))).toBe(false)
    expect(existsSync(join(target, 'Local Storage'))).toBe(false)
  })

  it('never overwrites already-established Aera Code state', () => {
    const root = mkdtempSync(join(tmpdir(), 'aera-code-existing-'))
    const legacy = join(root, 'DSH Desktop')
    const target = join(root, 'Aera Code')
    for (const base of [legacy, target]) mkdirSync(join(base, 'profile-selection'), { recursive: true })
    writeFileSync(join(legacy, 'profile-selection', 'state.json'), 'legacy')
    writeFileSync(join(target, 'profile-selection', 'state.json'), 'current')

    expect(migrateAeraCodeUserData(legacy, target)).toEqual({ status: 'not-needed', migrated: [] })
    expect(readFileSync(join(target, 'profile-selection', 'state.json'), 'utf8')).toBe('current')
  })

  it('loads the existing Gateway credential only into the process environment', () => {
    const environment: NodeJS.ProcessEnv = {}
    const readPassword = vi.fn(() => 'process-only-value')

    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment,
      activeProfile: 'aera-gateway-eval',
      readPassword,
    })).toBe('loaded-from-keychain')
    expect(readPassword).toHaveBeenCalledWith('com.aera.gateway.canary.execution', 'Allyd')
    expect(environment.AERA_GATEWAY_DSH_EVAL_KEY).toBe('process-only-value')
  })

  it('does not read Keychain for another profile or replace an inherited credential', () => {
    const readPassword = vi.fn(() => 'unexpected')
    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment: {},
      activeProfile: 'desktop',
      readPassword,
    })).toBe('not-required')
    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment: { AERA_GATEWAY_DSH_EVAL_KEY: 'already-present' },
      activeProfile: 'aera-gateway-eval',
      readPassword,
    })).toBe('already-present')
    expect(readPassword).not.toHaveBeenCalled()
  })
})
