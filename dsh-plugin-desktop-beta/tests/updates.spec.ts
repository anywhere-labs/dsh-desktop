import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { NextUpdateSettings } from '../src/client/updates.tsx'
import { DEFAULT_PREFERENCES, type DesktopState } from '../src/desktop-contract.ts'
import { NextUpdates, type NextUpdateOptions } from '../src/updates.ts'
import { serveMacUpdate } from '../src/mac-update-feed.ts'
import { releaseNotesUrl, updateAction, updateLabel, type NextUpdateState } from '../src/update-state.ts'
import type { UpdateRequest } from '../../dsh-plugin-desktop/src/update-checker.ts'
import type { UpdateArtifactRequest } from '../../dsh-plugin-desktop/src/update-download.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => createElement('button', props, children as never),
}))

const roots: string[] = []
const owners: NextUpdates[] = []
afterEach(async () => { for (const owner of owners.splice(0)) await owner.dispose(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); vi.useRealTimers() })
async function fixture(overrides: Partial<NextUpdateOptions> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'next-updates-test-')); roots.push(home)
  const artifact = Buffer.alloc(1024); artifact.write('koly', 512)
  const request = vi.fn<UpdateRequest>(async url => url.includes('/version')
    ? Response.json({ version: '2.0.20-beta.2', channel: 'beta' }) : new Response(artifact, { headers: { 'content-length': '1024' } }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async (url, init) => ({ response: await request(url, init), finalUrl: url }))
  const options: NextUpdateOptions = { userData: home, version: '2.0.14-beta.1', platform: 'darwin', packaged: true,
    request, artifactRequest, prepare: vi.fn(async path => { expect(await readFile(path)).toEqual(artifact) }), install: vi.fn(async () => {}),
    changed: vi.fn(), log: vi.fn(), ...overrides }
  const updates = new NextUpdates(options); owners.push(updates)
  return { updates, options, request, artifactRequest }
}

it('checks without downloading; download completion waits for an explicit installation', async () => {
  const { updates, options, request } = await fixture()
  await updates.check()
  expect(updates.snapshot().phase).toBe('available')
  expect(request).toHaveBeenCalledTimes(1)
  await Promise.all([updates.download(), updates.download()])
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', received: 1024, total: 1024 })
  expect(options.prepare).toHaveBeenCalledOnce()
  expect(options.install).not.toHaveBeenCalled()
  await updates.install()
  expect(options.install).toHaveBeenCalledOnce()
  expect(updates.snapshot().phase).toBe('installing')
})
it('does not confuse an unpublished channel, invalid response or network failure with up to date', async () => {
  for (const response of [new Response('', { status: 400 }), new Response('', { status: 503 }), Response.json({ version: '2.0.20', channel: 'stable' })]) {
    const { updates } = await fixture({ request: async () => response })
    await updates.check()
    expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'service' })
  }
})
it('names the CPU of this Mac on the version check and on the first download request', async () => {
  const { updates, request, artifactRequest } = await fixture({ arch: 'arm64' })
  await updates.download()
  expect(updates.snapshot().phase).toBe('ready')
  const [versionUrl, versionInit] = request.mock.calls[0]!
  expect(versionUrl).toContain('/version')
  expect(new Headers(versionInit.headers).get('X-DSH-Desktop-Arch')).toBe('arm64')
  expect(new Headers(versionInit.headers).get('X-DSH-Desktop-Channel')).toBe('beta')
  const downloadInit = artifactRequest.mock.calls[0]![1]
  expect(new Headers(downloadInit.headers).get('X-DSH-Desktop-Arch')).toBe('arm64')
  expect(new Headers(downloadInit.headers).get('X-DSH-Desktop-Target-Version')).toBe('2.0.20-beta.2')
})
it('leaves requests without a CPU header where the platform names none', async () => {
  const { updates, request, artifactRequest } = await fixture({ platform: 'win32' })
  await updates.check()
  expect(new Headers(request.mock.calls[0]![1].headers).has('X-DSH-Desktop-Arch')).toBe(false)
  expect(artifactRequest).not.toHaveBeenCalled()
})
it('allows checks in development, but never downloads or replaces the development application', async () => {
  const { updates, options, request } = await fixture({ packaged: false })
  await updates.check(); await updates.download()
  expect(updates.snapshot()).toMatchObject({ installable: false, error: 'development' })
  expect(request).toHaveBeenCalledOnce(); expect(options.prepare).not.toHaveBeenCalled()
})
it('polls on Linux without the installation UUID, notifies once and leaves the download to the release page', async () => {
  const mac = await fixture()
  await mac.updates.check()
  expect(new Headers(mac.request.mock.calls[0]![1].headers).get('X-DSH-Desktop-Installation-Id')).toMatch(/^[0-9a-f-]{36}$/)
  vi.useFakeTimers()
  const available = vi.fn()
  const { updates, options, request } = await fixture({ platform: 'linux', packaged: true, available })
  updates.start()
  await vi.advanceTimersByTimeAsync(30_000)
  await vi.waitFor(() => expect(updates.snapshot().phase).toBe('available'))
  expect(request).toHaveBeenCalledOnce()
  const headers = new Headers(request.mock.calls[0]![1].headers)
  expect(headers.get('X-DSH-Desktop-Channel')).toBe('beta')
  expect(headers.has('X-DSH-Desktop-Installation-Id')).toBe(false)
  expect(existsSync(join(options.userData, 'identity'))).toBe(false)
  expect(updates.snapshot()).toMatchObject({ version: '2.0.20-beta.2', installable: false })
  expect(available).toHaveBeenCalledExactlyOnceWith('2.0.20-beta.2')
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported' })
  expect(request).toHaveBeenCalledOnce()
})
it('rechecks the selected version before downloading, and preserves preparation failures for retry', async () => {
  const { updates, options } = await fixture({ prepare: async () => { throw new Error('Signature mismatch') } })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'prepare' })
  await updates.install(); expect(options.install).not.toHaveBeenCalled()
  expect(updateAction(updates.snapshot())).toBe('download-update')
})
it('stops polling and aborts an active request on shutdown', async () => {
  const request = vi.fn<UpdateRequest>(async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
  const { updates } = await fixture({ request, packaged: false })
  const check = updates.check()
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  await updates.dispose(); await check
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
})
it('shows progress and an actionable downloaded state in both languages', () => {
  expect(updateLabel({ phase: 'downloading', installable: true, received: 25, total: 100 }, 'zh-CN')).toContain('25%')
  expect(updateLabel({ phase: 'downloading', installable: true, received: 2 * 1048576 }, 'en')).toContain('2 MB')
  expect(updateAction({ phase: 'preparing', installable: true })).toBeUndefined()
  expect(updateAction({ phase: 'ready', installable: true })).toBe('install-update')
})
it('downloads a Next installer through the injected artifact transport', async () => {
  const cdn = 'https://cdn-lfs-cn-1.modelscope.cn/prod/lfs-objects/next.dmg'
  const artifact = Buffer.alloc(1024); artifact.write('koly', 512)
  const request = vi.fn<UpdateRequest>(async () => Response.json({ version: '2.0.20-beta.2', channel: 'beta' }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async () => ({ response: new Response(artifact), finalUrl: cdn }))
  const { updates, options } = await fixture({ request, artifactRequest })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', version: '2.0.20-beta.2' })
  expect(artifactRequest).toHaveBeenCalledOnce()
  expect(options.prepare).toHaveBeenCalledOnce()
})
it('serves only the private archive to the native updater and closes its loopback listener', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-feed-test-')); roots.push(root)
  const path = join(root, 'update.zip'); await writeFile(path, 'test archive')
  const feed = await serveMacUpdate(path, '2.0.20-beta.2')
  try {
    const metadata = await (await fetch(feed.url)).json() as { url: string; name: string }
    expect(metadata.name).toBe('2.0.20-beta.2')
    expect(await (await fetch(metadata.url)).text()).toBe('test archive')
    expect((await fetch(new URL('/update.zip', feed.url))).status).toBe(404)
    expect((await fetch(feed.url, { method: 'POST' })).status).toBe(404)
  } finally { await feed.close() }
  await expect(fetch(feed.url)).rejects.toThrow()
})
it('notifies once per newly discovered background update version and persists notifiedVersion across restarts', async () => {
  let latestVersion = '2.0.20-beta.2'
  const available = vi.fn()
  const { updates, options } = await fixture({
    available,
    request: async () => Response.json({ version: latestVersion, channel: 'beta' }),
  })
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)
  expect(available).toHaveBeenCalledWith('2.0.20-beta.2')

  // Subsequent background poll of the same version does not re-notify.
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)

  // A new NextUpdates instance reading the same userData also skips duplicate notification.
  const secondAvailable = vi.fn()
  const restarted = new NextUpdates({ ...options, available: secondAvailable })
  owners.push(restarted)
  await restarted.check(true)
  expect(secondAvailable).not.toHaveBeenCalled()

  // When a newer version is published, background check notifies once for the new version.
  latestVersion = '2.0.21-beta.2'
  await restarted.check(true)
  expect(secondAvailable).toHaveBeenCalledTimes(1)
  expect(secondAvailable).toHaveBeenCalledWith('2.0.21-beta.2')
})
const baseState: DesktopState = {
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
  features: { market: false, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture',
  platform: 'linux', version: '2.0.20-beta.1', trayAvailable: true, notificationsAvailable: true,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
  updates: { phase: 'idle', installable: false },
}
it('shows update status and controls on every platform, and sends Linux to the release page to download', () => {
  const render = (platform: string, updates: NextUpdateState) =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform, updates }, language: 'zh-CN', run: vi.fn() }))
  const linuxHtml = render('linux', { phase: 'idle', installable: false })
  expect(linuxHtml).toContain('应用更新')
  expect(linuxHtml).toContain('DSH Desktop Beta · 2.0.20-beta.1')
  expect(linuxHtml).toMatch(/<button[^>]*>检查更新<\/button>/)
  expect(linuxHtml).not.toMatch(/<button[^>]*disabled/)
  expect(linuxHtml).toContain('Linux 版需要手动更新：在发布页下载与当前安装方式相同的安装包（deb、AppImage 或 tar.gz）。')
  expect(linuxHtml).not.toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  const linuxAvailable = render('linux', { phase: 'available', version: '2.0.21-beta.1', installable: false })
  expect(linuxAvailable).toContain('发现新版本 2.0.21-beta.1')
  expect(linuxAvailable).toMatch(/<button[^>]*>前往下载<\/button>/)
  expect(linuxAvailable).not.toMatch(/<button[^>]*disabled/)

  const macHtml = render('darwin', { phase: 'idle', installable: false })
  expect(macHtml).toContain('应用更新')
  expect(macHtml).toContain('DSH Desktop Beta · 2.0.20-beta.1')
  expect(macHtml).toContain('检查更新')
  expect(macHtml).toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  expect(macHtml).not.toContain('Linux 版需要手动更新')
  // A development build cannot download, but it is not sent elsewhere either.
  expect(render('darwin', { phase: 'available', version: '2.0.21-beta.1', installable: false })).toMatch(/<button[^>]*disabled=""[^>]*>下载更新<\/button>/)
})
it('names the release notes page after the latest channel version reported by the update service', () => {
  const releases = 'https://github.com/anywhere-labs/dsh-desktop/releases'
  expect(releaseNotesUrl()).toBe(releases)
  for (const version of ['2.0.19-beta.1', '2.0.20-beta.2']) expect(releaseNotesUrl(version)).toBe(`${releases}/tag/v${version}`)
  // The version comes from a remote response and must not be able to leave the tag path.
  const hostile = new URL(releaseNotesUrl('9.9.9/../../x?y#z'))
  expect([hostile.search, hostile.hash]).toEqual(['', ''])
  expect(hostile.pathname).toMatch(/^\/anywhere-labs\/dsh-desktop\/releases\/tag\/v[^/]+$/)
})
it('links the release notes beside the update controls in both languages', () => {
  const releases = 'https://github.com/anywhere-labs/dsh-desktop/releases'
  const installed = baseState.version
  // An installed build ahead of the last release (a source run) is reported the older, published version.
  const current: NextUpdateState = { phase: 'current', version: '2.0.19-beta.1', installable: true }
  const ready: NextUpdateState = { phase: 'ready', version: '2.0.21-beta.1', installable: true }
  const render = (platform: string, language: string, updates: NextUpdateState) =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform, updates }, language, run: vi.fn() }))
  const cases: [string, string, NextUpdateState, string, string][] = [
    // Until the service has reported a version, and after a failed check cleared it, the installed version names the page.
    ['darwin', 'zh-CN', { phase: 'idle', installable: true }, '更新公告', `${releases}/tag/v${installed}`],
    ['darwin', 'zh-CN', { phase: 'error', error: 'service', installable: true }, '更新公告', `${releases}/tag/v${installed}`],
    // A reported version wins over the installed one, whether it is older or newer.
    ['darwin', 'zh-CN', current, '更新公告', `${releases}/tag/v${current.version}`],
    ['win32', 'en', ready, 'Release notes', `${releases}/tag/v${ready.version}`],
    // Linux downloads every package from the same page.
    ['linux', 'zh-CN', { ...ready, phase: 'available', installable: false }, '更新公告', `${releases}/tag/v${ready.version}`],
  ]
  for (const [platform, language, updates, label, href] of cases) {
    const anchor = render(platform, language, updates).match(/<a [^>]*>[^<]*<\/a>/)?.[0]
    expect(anchor).toContain(`href="${href}"`)
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('rel="noopener noreferrer"')
    expect(anchor).toContain(`>${label}</a>`)
  }
})
