import { describe, expect, it, vi } from 'vitest'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager'
import type { CatalogSnapshot } from '../src/contracts/index.js'
import {
  createGitHubPackageVerifier,
  githubPackageManifestUrl,
  githubPackageTarget,
} from '../src/install/github.js'
import { manualInstallHint } from '../src/install/manual.js'
import { MarketInstallService, type MarketPluginManager } from '../src/install/service.js'

const source = {
  kind: 'github' as const,
  owner: 'example',
  repo: 'plugin',
  commit: '0123456789abcdef0123456789abcdef01234567',
  subdirectory: 'packages/plugin',
}

describe('GitHub package verification', () => {
  it('constructs a pinned target and raw manifest URL', () => {
    expect(githubPackageTarget(source)).toBe(
      'github:example/plugin#0123456789abcdef0123456789abcdef01234567&path:/packages/plugin',
    )
    expect(githubPackageManifestUrl(source)).toBe(
      'https://raw.githubusercontent.com/example/plugin/0123456789abcdef0123456789abcdef01234567/packages/plugin/package.json',
    )
  })

  it('verifies package identity, stable version, and DSH bundle metadata', async () => {
    const url = githubPackageManifestUrl(source)
    const http = {
      getJson: vi.fn(async () => ({
        finalUrl: url,
        value: {
          name: '@example/dsh-plugin',
          version: '1.2.3',
          dsh: { bundle: { patch: './patches/plugin.patch' } },
        },
      })),
    }
    await expect(createGitHubPackageVerifier(http).verify(source, new AbortController().signal)).resolves.toEqual({
      packageName: '@example/dsh-plugin',
      version: '1.2.3',
      bundlePatch: './patches/plugin.patch',
      source,
    })
    expect(http.getJson).toHaveBeenCalledWith(url, expect.any(AbortSignal), { allowedOrigin: 'https://raw.githubusercontent.com' })
  })

  it.each([
    ['a redirect', { finalUrl: 'https://evil.example/package.json', value: {} }],
    ['an invalid package name', { value: { name: 'bad name', version: '1.2.3', dsh: { bundle: { patch: './plugin.patch' } } } }],
    ['an invalid version', { value: { name: 'plugin', version: 'latest', dsh: { bundle: { patch: './plugin.patch' } } } }],
    ['a missing bundle patch', { value: { name: 'plugin', version: '1.2.3', dsh: { bundle: {} } } }],
  ])('rejects %s', async (_label, response) => {
    const http = { getJson: vi.fn(async () => ({ finalUrl: githubPackageManifestUrl(source), ...response })) }
    await expect(createGitHubPackageVerifier(http).verify(source, new AbortController().signal)).rejects.toThrow(/GitHub package verification failed/u)
  })
})

const manualBase = {
  id: 'example/plugin',
  name: 'Example Plugin',
  displayName: 'Example Plugin',
  summary: 'Example plugin',
  repository: { url: 'https://github.com/example/plugin', subdirectory: 'packages/plugin' },
  installSource: {
    kind: 'github' as const,
    commit: '0123456789abcdef0123456789abcdef01234567',
  },
  provenance: {
    sourceRecordId: 'source-1',
    providerId: 'provider.example',
    itemId: 'example/plugin',
  },
}

describe('manual install hints', () => {
  it('renders pinned GitHub sources as non-executable display commands', () => {
    expect(manualInstallHint(manualBase)).toMatchObject({
      kind: 'github',
      mutable: false,
      desktopVerification: 'not-verified',
      displayCommand: 'dsh plugin add github:example/plugin#0123456789abcdef0123456789abcdef01234567&path:/packages/plugin',
    })
  })

  it('does not expose malformed pinned sources', () => {
    expect(manualInstallHint({
      ...manualBase,
      installSource: { kind: 'github', commit: 'not-a-commit' },
    })).toBeUndefined()
  })
})

const target = 'github:example/plugin#0123456789abcdef0123456789abcdef01234567&path:/packages/plugin'
const profile = () => ({ name: 'desktop', dir: '/fixtures/profiles/desktop' })

function snapshot(): CatalogSnapshot {
  return {
    schemaVersion: '1.0.0',
    source: {
      sourceRecordId: 'source-1',
      providerId: 'provider.example',
      adapterId: 'market.standard-http-v1',
      registrationKind: 'user-added',
      fetchedAt: '2026-08-26T00:00:00.000Z',
      finalUrl: 'https://example.test/plugins',
    },
    items: [{
      id: 'example/plugin',
      name: 'Example Plugin',
      displayName: 'Example Plugin',
      summary: 'Pinned GitHub plugin',
      repository: { url: 'https://github.com/example/plugin', subdirectory: 'packages/plugin' },
      installSource: source,
      provenance: { sourceRecordId: 'source-1', providerId: 'provider.example', itemId: 'example/plugin' },
    }],
    page: {},
  }
}

function manager(installed: (spec: string) => ChangeResult) {
  const bundles: BundleInfo[] = []
  return {
    listBundles: vi.fn(async () => [...bundles]),
    listPlugins: vi.fn(async () => []),
    installBundle: vi.fn(async (spec: string) => {
      const result = installed(spec)
      if (result.bundle !== undefined) {
        bundles.push({
          name: result.bundle, official: false, availability: 'profile', enabled: true, installed: true,
          optional: false, removable: true, rows: [], overrides: [], ...(result.version === undefined ? {} : { version: result.version }),
        })
      }
      return result
    }),
    setBundleEnabled: vi.fn(),
    removeBundle: vi.fn(),
  } satisfies MarketPluginManager
}

describe('Market GitHub install target', () => {
  it('verifies the source first and installs the pinned, shell-free target through the official manager', async () => {
    const official = manager(spec => ({
      changed: true, application: 'applied', stage: 'enable', target: spec, bundle: 'dsh-plugin-git', version: '1.2.3',
    }))
    const verifier = {
      verify: vi.fn(async candidate => ({
        packageName: 'dsh-plugin-git',
        version: '1.2.3',
        source: candidate.source!,
      })),
    }
    const service = new MarketInstallService(profile, official, verifier)
    try {
      service.observeCatalog(snapshot())
      const preview = await service.previewInstall('source-1', 'example/plugin', new AbortController().signal)
      expect(preview).toMatchObject({ packageName: 'dsh-plugin-git', version: '1.2.3' })
      await expect(service.executePreview(preview.intent, new AbortController().signal)).resolves.toEqual({
        action: 'install', packageName: 'dsh-plugin-git', version: '1.2.3', application: 'applied',
      })
      expect(official.installBundle.mock.calls).toEqual([[target, { enabled: true, saveExact: true }]])
      expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({ source }), expect.any(AbortSignal))
      await expect(service.listInstallations(new AbortController().signal)).resolves.toMatchObject([
        { packageName: 'dsh-plugin-git', version: '1.2.3', enabled: true },
      ])
    } finally {
      service.dispose()
    }
  })

  it('reports a package whose manifest names something other than the verified plugin', async () => {
    const official = manager(spec => ({
      changed: true, application: 'applied', stage: 'enable', target: spec, bundle: 'dsh-plugin-impostor', version: '9.9.9',
    }))
    const service = new MarketInstallService(profile, official, {
      verify: vi.fn(async candidate => ({ packageName: 'dsh-plugin-git', version: '1.2.3', source: candidate.source! })),
    })
    try {
      service.observeCatalog(snapshot())
      const preview = await service.previewInstall('source-1', 'example/plugin', new AbortController().signal)
      await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
        code: 'operation-failed',
        details: 'expected dsh-plugin-git, installed dsh-plugin-impostor',
      })
    } finally {
      service.dispose()
    }
  })
})
