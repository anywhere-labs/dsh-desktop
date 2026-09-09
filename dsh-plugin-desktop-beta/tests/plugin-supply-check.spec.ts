import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkBundleSupply,
  checkProfileSupply,
  collectExpectedSupply,
  createProfileSupplyProbe,
  type ProfileSupplyProbe,
  type SupplyPresence,
} from '../src/plugin-supply-check.ts'

function probeOf(
  manifests: Record<string, unknown>,
  presence: Record<string, SupplyPresence>,
): ProfileSupplyProbe {
  return {
    readBundleManifest: packageName => manifests[packageName],
    presence: packageName => presence[packageName] ?? 'absent',
  }
}

describe('expected supply collected from a bundle manifest', () => {
  it('collects peer dependencies as names the runtime must supply', () => {
    expect(collectExpectedSupply({ peerDependencies: { 'host-a': '^1.0.0' } })).toEqual([
      { packageName: 'host-a', expectations: ['peer'] },
    ])
  })

  it('collects browser-side inject entries as names the runtime must supply', () => {
    expect(collectExpectedSupply({ dsh: { client: { inject: ['host-b'] } } })).toEqual([
      { packageName: 'host-b', expectations: ['client-inject'] },
    ])
  })

  it('records one entry when the same name is declared at both sites', () => {
    const collected = collectExpectedSupply({
      peerDependencies: { 'host-a': '^1.0.0' },
      dsh: { client: { inject: ['host-a'] } },
    })
    expect(collected).toEqual([{ packageName: 'host-a', expectations: ['peer', 'client-inject'] }])
  })

  it('ignores regular and optional dependencies, which the package manager fetches itself', () => {
    expect(collectExpectedSupply({
      dependencies: { 'carried-a': '^1.0.0' },
      optionalDependencies: { 'carried-b': '^1.0.0' },
    })).toEqual([])
  })

  it('ignores peer dependencies declared optional, whose absence is a supported state', () => {
    expect(collectExpectedSupply({
      peerDependencies: { 'host-a': '^1.0.0', 'host-b': '^1.0.0' },
      peerDependenciesMeta: { 'host-b': { optional: true } },
    })).toEqual([{ packageName: 'host-a', expectations: ['peer'] }])
  })

  it('rejects manifests whose declarations cannot be read as package names', () => {
    expect(() => collectExpectedSupply(null)).toThrow()
    expect(() => collectExpectedSupply({ peerDependencies: [] })).toThrow()
    expect(() => collectExpectedSupply({ dsh: { client: { inject: 'host-a' } } })).toThrow()
    expect(() => collectExpectedSupply({ dsh: { client: { inject: [7] } } })).toThrow()
    expect(() => collectExpectedSupply({ peerDependencies: { '../escape': '*' } })).toThrow()
  })
})

describe('supply reading for one bundle', () => {
  it('passes a bundle whose every expected name is installed', () => {
    const probe = probeOf({ plug: { peerDependencies: { 'host-a': '*' } } }, { 'host-a': 'present' })
    expect(checkBundleSupply('plug', probe)).toEqual({
      packageName: 'plug',
      verdict: 'supplied',
      missing: [],
    })
  })

  it('fails a bundle whose expected name is not installed, and names it', () => {
    const probe = probeOf(
      { plug: { peerDependencies: { 'host-a': '*', 'host-b': '*' } } },
      { 'host-a': 'present', 'host-b': 'absent' },
    )
    expect(checkBundleSupply('plug', probe)).toEqual({
      packageName: 'plug',
      verdict: 'unsupplied',
      missing: ['host-b'],
    })
  })

  it('passes a bundle missing only a regular dependency, which it carries itself', () => {
    const probe = probeOf({ plug: { dependencies: { 'carried-a': '*' } } }, {})
    expect(checkBundleSupply('plug', probe).verdict).toBe('supplied')
  })

  it('reports undecidable rather than supplied when the manifest cannot be read', () => {
    const probe: ProfileSupplyProbe = {
      readBundleManifest: () => { throw new Error('manifest is not valid UTF-8') },
      presence: () => 'present',
    }
    const report = checkBundleSupply('plug', probe)
    expect(report.verdict).toBe('undecidable')
    expect(report.reason).toBe('manifest is not valid UTF-8')
  })

  it('reports undecidable when the Profile declares a bundle nothing is installed for', () => {
    expect(checkBundleSupply('plug', probeOf({}, {})).verdict).toBe('undecidable')
  })

  it('reports undecidable, never supplied, when one name could not be decided', () => {
    const probe = probeOf(
      { plug: { peerDependencies: { 'host-a': '*' } } },
      { 'host-a': 'undecidable' },
    )
    const report = checkBundleSupply('plug', probe)
    expect(report.verdict).toBe('undecidable')
    expect(report.missing).toEqual([])
  })

  it('lets a name known to be absent stand even when another could not be decided', () => {
    const probe = probeOf(
      { plug: { peerDependencies: { 'host-a': '*', 'host-b': '*' } } },
      { 'host-a': 'absent', 'host-b': 'undecidable' },
    )
    expect(checkBundleSupply('plug', probe)).toEqual({
      packageName: 'plug',
      verdict: 'unsupplied',
      missing: ['host-a'],
    })
  })
})

describe('supply reading across a Profile', () => {
  it('keeps the three outcomes apart and preserves the order it was given', () => {
    const probe = probeOf(
      {
        good: { peerDependencies: { 'host-a': '*' } },
        broken: { peerDependencies: { 'host-z': '*' } },
      },
      { 'host-a': 'present' },
    )
    const report = checkProfileSupply(['good', 'broken', 'missing'], probe)
    expect(report.bundles.map(bundle => bundle.packageName)).toEqual(['good', 'broken', 'missing'])
    expect(report.unsupplied.map(bundle => bundle.packageName)).toEqual(['broken'])
    expect(report.undecidable.map(bundle => bundle.packageName)).toEqual(['missing'])
  })
})

describe('supply probe backed by an installed tree', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
  })

  async function tree(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-supply-'))
    roots.push(root)
    return root
  }

  function install(dir: string, packageName: string, manifest: Record<string, unknown>): void {
    const target = join(dir, 'node_modules', ...packageName.split('/'))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export default {}\n')
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', main: 'index.js', ...manifest }))
  }

  it('refuses to run without a directory to resolve from', () => {
    expect(() => createProfileSupplyProbe([])).toThrow()
  })

  it('reads an installed bundle manifest and decides its expected names', async () => {
    const root = await tree()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'profile', version: '1.0.0' }))
    install(root, '@scope/plug', { peerDependencies: { '@scope/host-a': '*', '@scope/host-b': '*' } })
    install(root, '@scope/host-a', {})

    const report = checkBundleSupply('@scope/plug', createProfileSupplyProbe([root]))
    expect(report.verdict).toBe('unsupplied')
    expect(report.missing).toEqual(['@scope/host-b'])
  })

  it('counts a package resolvable from the Profile but installed higher up as present', async () => {
    const root = await tree()
    const profileDir = join(root, 'profile')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', version: '1.0.0' }))
    install(root, 'hoisted-host', {})

    expect(createProfileSupplyProbe([profileDir]).presence('hoisted-host')).toBe('present')
  })

  it('reports nothing installed under a name as an absent package', async () => {
    const root = await tree()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'profile', version: '1.0.0' }))
    expect(createProfileSupplyProbe([root]).presence('never-installed')).toBe('absent')
    expect(createProfileSupplyProbe([root]).readBundleManifest('never-installed')).toBeUndefined()
  })
})
