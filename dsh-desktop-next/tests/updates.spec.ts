import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { NextUpdateSettings } from '../src/client/updates.tsx'
import { DEFAULT_PREFERENCES, type DesktopState } from '../src/desktop-contract.ts'
import { NextUpdates, type NextUpdateOptions } from '../src/updates.ts'
import { updateDownloadDirectory } from '../src/update-downloads.ts'
import { isWindowsPortableCopy } from '../src/update-portable.ts'
import { manualUpdate, manualUpdateHint, releaseNotesUrl, updateAction, updateLabel, type NextUpdateState } from '../src/update-state.ts'
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
    ? Response.json({ version: '2.0.20-next.1', channel: 'next' }) : new Response(artifact, { headers: { 'content-length': '1024' } }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async (url, init) => ({ response: await request(url, init), finalUrl: url }))
  const options: NextUpdateOptions = { userData: home, version: '2.0.14-next', platform: 'darwin', packaged: true,
    request, artifactRequest, prepare: vi.fn(async path => { expect(await readFile(path)).toEqual(artifact) }), install: vi.fn(async () => {}),
    changed: vi.fn(), log: vi.fn(), ...overrides }
  const updates = new NextUpdates(options); owners.push(updates)
  return { updates, options, request, artifactRequest }
}

it('routes an ARM64 update through the release service and keeps its digest through installer preparation', async () => {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async url => ({ response: new Response(bytes), finalUrl: url }))
  const prepare = vi.fn(async (path: string) => { expect(await readFile(path)).toEqual(bytes); expect(path).toContain('-arm64-Setup.exe') })
  const request = vi.fn<UpdateRequest>(async () => Response.json({ version: '2.0.20-next.1', channel: 'next', sha256: { windows: 'a'.repeat(64), windowsArm64: digest } }))
  const { updates } = await fixture({ platform: 'win32', arch: 'arm64', artifactRequest, prepare, request })
  await updates.download()
  expect(updates.snapshot().phase).toBe('ready')
  expect(prepare).toHaveBeenCalledOnce()
  expect(new Headers(request.mock.calls[0]![1].headers).get('X-DSH-Desktop-Arch')).toBe('arm64')
  expect(new Headers(artifactRequest.mock.calls[0]![1].headers).get('X-DSH-Desktop-Arch')).toBe('arm64')
  expect(artifactRequest.mock.calls[0]?.[0]).toBe('https://www.dshdesktop.cn/api/downloads/windows')
})

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
  expect(new Headers(versionInit.headers).get('X-DSH-Desktop-Channel')).toBe('next')
  const downloadInit = artifactRequest.mock.calls[0]![1]
  expect(new Headers(downloadInit.headers).get('X-DSH-Desktop-Arch')).toBe('arm64')
  expect(new Headers(downloadInit.headers).get('X-DSH-Desktop-Target-Version')).toBe('2.0.20-next.1')
})
it.each(['x64', 'arm64'] as const)('names the Windows %s CPU on the version check', async arch => {
  const { updates, request, artifactRequest } = await fixture({ platform: 'win32', arch })
  await updates.check()
  expect(new Headers(request.mock.calls[0]![1].headers).get('X-DSH-Desktop-Arch')).toBe(arch)
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
  expect(headers.get('X-DSH-Desktop-Channel')).toBe('next')
  expect(headers.has('X-DSH-Desktop-Installation-Id')).toBe(false)
  expect(existsSync(join(options.userData, 'identity'))).toBe(false)
  expect(updates.snapshot()).toMatchObject({ version: '2.0.20-next.1', installable: false })
  expect(available).toHaveBeenCalledExactlyOnceWith('2.0.20-next.1')
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported' })
  expect(request).toHaveBeenCalledOnce()
})
it('recognizes a packaged Windows copy without the uninstaller Setup writes beside it as portable', () => {
  const executable = 'D:\\Tools\\DSH NEXT\\DSH NEXT.exe'
  const probe = vi.fn((_path: string) => false)
  expect(isWindowsPortableCopy('win32', true, executable, probe)).toBe(true)
  expect(probe).toHaveBeenCalledExactlyOnceWith('D:\\Tools\\DSH NEXT\\Uninstall DSH NEXT.exe')
  const installed = 'C:\\Users\\user\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.EXE'
  expect(isWindowsPortableCopy('win32', true, installed, path => path === 'C:\\Users\\user\\AppData\\Local\\Programs\\DSH NEXT\\Uninstall DSH NEXT.exe')).toBe(false)
  // Development runs and the other platforms are never portable copies, and nothing is probed for them.
  for (const [platform, packaged] of [['win32', false], ['darwin', true], ['linux', true]] as const) {
    expect(isWindowsPortableCopy(platform, packaged, executable, probe)).toBe(false)
  }
  expect(probe).toHaveBeenCalledOnce()
})
it('leaves the update of a portable Windows copy to the release page, but identifies its checks like any Windows build', async () => {
  const { updates, options, request, artifactRequest } = await fixture({ platform: 'win32', portable: true })
  expect(updates.snapshot()).toEqual({ phase: 'idle', installable: false, portable: true })
  await updates.check()
  expect(updates.snapshot()).toMatchObject({ phase: 'available', version: '2.0.20-next.1', installable: false, portable: true })
  expect(manualUpdate(updates.snapshot(), 'win32')).toBe(true)
  // PRIVACY.md: packaged macOS and Windows builds send the installation UUID with the version check.
  expect(new Headers(request.mock.calls[0]![1].headers).get('X-DSH-Desktop-Installation-Id')).toMatch(/^[0-9a-f-]{36}$/)
  // Setup would install a second copy instead of replacing this one, so nothing is downloaded.
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported', portable: true })
  expect(artifactRequest).not.toHaveBeenCalled(); expect(options.prepare).not.toHaveBeenCalled()
  const installed = await fixture({ platform: 'win32' })
  expect(installed.updates.snapshot()).toEqual({ phase: 'idle', installable: true })
  expect(manualUpdate(installed.updates.snapshot(), 'win32')).toBe(false)
  expect(manualUpdate({ phase: 'idle', installable: false }, 'linux')).toBe(true)
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
  const request = vi.fn<UpdateRequest>(async () => Response.json({ version: '2.0.20-next.1', channel: 'next' }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async () => ({ response: new Response(artifact), finalUrl: cdn }))
  const { updates, options } = await fixture({ request, artifactRequest })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', version: '2.0.20-next.1' })
  expect(artifactRequest).toHaveBeenCalledOnce()
  expect(options.prepare).toHaveBeenCalledOnce()
})
it('keeps Windows installers in the system temporary directory, which no sandbox workspace may contain', () => {
  expect(updateDownloadDirectory('win32')).toBe(join(tmpdir(), 'dsh-desktop-next-updates'))
  expect(updateDownloadDirectory('darwin')).toBeUndefined()
  expect(updateDownloadDirectory('linux')).toBeUndefined()
})
it('downloads into the configured directory and removes earlier downloads there and beside the update state', async () => {
  const downloads = await mkdtemp(join(tmpdir(), 'next-update-downloads-')); roots.push(downloads)
  const installer = Buffer.alloc(1024); installer.write('MZ', 0, 'latin1'); installer.writeUInt32LE(64, 0x3c); installer.write('PE\0\0', 64, 'latin1')
  const request = vi.fn<UpdateRequest>(async () => Response.json({ version: '2.0.20-next.1', channel: 'next' }))
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async url => ({ response: new Response(installer), finalUrl: url }))
  const { updates, options } = await fixture({ platform: 'win32', downloads, request, artifactRequest, prepare: vi.fn(async () => {}) })
  const state = join(options.userData, 'next-updates')
  for (const directory of [join(state, 'download-earlier'), join(downloads, 'download-earlier'), join(downloads, 'unrelated')]) {
    await mkdir(directory, { recursive: true })
  }
  await updates.download()
  expect(updates.snapshot().phase).toBe('ready')
  const [path, , directory] = vi.mocked(options.prepare).mock.calls[0]!
  expect(dirname(directory)).toBe(downloads)
  expect(dirname(path)).toBe(directory)
  expect(existsSync(join(state, 'download-earlier'))).toBe(false)
  expect(existsSync(join(downloads, 'download-earlier'))).toBe(false)
  expect(existsSync(join(downloads, 'unrelated'))).toBe(true)
  // The notification state stays with the rest of the application data.
  expect(existsSync(join(state, 'state.json'))).toBe(true)
})
it('notifies once per newly discovered background update version and persists notifiedVersion across restarts', async () => {
  let latestVersion = '2.0.20-next.1'
  const available = vi.fn()
  const { updates, options } = await fixture({
    available,
    request: async () => Response.json({ version: latestVersion, channel: 'next' }),
  })
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)
  expect(available).toHaveBeenCalledWith('2.0.20-next.1')

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
  latestVersion = '2.0.21-next.1'
  await restarted.check(true)
  expect(secondAvailable).toHaveBeenCalledTimes(1)
  expect(secondAvailable).toHaveBeenCalledWith('2.0.21-next.1')
})
const baseState: DesktopState = {
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
  features: { market: false, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture',
  platform: 'linux', version: '2.0.20-next', trayAvailable: true, notificationsAvailable: true,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
  updates: { phase: 'idle', installable: false },
}
it('shows update status and controls on every platform, and sends Linux to the release page to download', () => {
  const render = (platform: string, updates: NextUpdateState) =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform, updates }, language: 'zh-CN', run: vi.fn() }))
  const linuxHtml = render('linux', { phase: 'idle', installable: false })
  expect(linuxHtml).toContain('应用更新')
  expect(linuxHtml).toContain('DSH NEXT · 2.0.20-next')
  expect(linuxHtml).toMatch(/<button[^>]*>检查更新<\/button>/)
  expect(linuxHtml).not.toMatch(/<button[^>]*disabled/)
  expect(linuxHtml).toContain('Linux 版需要手动更新：在发布页下载与当前安装方式相同的安装包（deb、AppImage 或 tar.gz）。')
  expect(linuxHtml).not.toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  const linuxAvailable = render('linux', { phase: 'available', version: '2.0.21-next', installable: false })
  expect(linuxAvailable).toContain('发现新版本 2.0.21-next')
  expect(linuxAvailable).toMatch(/<button[^>]*>前往下载<\/button>/)
  expect(linuxAvailable).not.toMatch(/<button[^>]*disabled/)

  const macHtml = render('darwin', { phase: 'idle', installable: false })
  expect(macHtml).toContain('应用更新')
  expect(macHtml).toContain('DSH NEXT · 2.0.20-next')
  expect(macHtml).toContain('检查更新')
  expect(macHtml).toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  expect(macHtml).not.toContain('Linux 版需要手动更新')
  // A development build cannot download, but it is not sent elsewhere either.
  expect(render('darwin', { phase: 'available', version: '2.0.21-next', installable: false })).toMatch(/<button[^>]*disabled=""[^>]*>下载更新<\/button>/)
})
it('sends a portable Windows copy to the release page with instructions for replacing its folder', () => {
  const render = (updates: NextUpdateState, language = 'zh-CN') =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform: 'win32', updates }, language, run: vi.fn() }))
  const portable: NextUpdateState = { phase: 'available', version: '2.0.21-next', installable: false, portable: true }
  const html = render(portable)
  expect(html).toContain('便携版需要手动更新：在发布页下载新的便携版 ZIP，退出应用后解压到新文件夹，用它替换当前文件夹。')
  expect(html).toMatch(/<button[^>]*>前往下载<\/button>/)
  expect(html).not.toMatch(/<button[^>]*disabled/)
  expect(html).not.toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  expect(render(portable, 'en')).toContain(manualUpdateHint('en', true))
  expect(manualUpdateHint('en', true)).toContain('portable ZIP')
  // An installed copy keeps downloading and installing in the app.
  const installed = render({ phase: 'available', version: '2.0.21-next', installable: true })
  expect(installed).toMatch(/<button[^>]*>下载更新<\/button>/)
  expect(installed).not.toContain('便携版需要手动更新')
})
it('names the release notes page after the latest channel version reported by the update service', () => {
  const releases = 'https://github.com/anywhere-labs/dsh-desktop/releases'
  expect(releaseNotesUrl()).toBe(releases)
  for (const version of ['2.0.19-next', '2.0.20-next.1']) expect(releaseNotesUrl(version)).toBe(`${releases}/tag/v${version}`)
  // The version comes from a remote response and must not be able to leave the tag path.
  const hostile = new URL(releaseNotesUrl('9.9.9/../../x?y#z'))
  expect([hostile.search, hostile.hash]).toEqual(['', ''])
  expect(hostile.pathname).toMatch(/^\/anywhere-labs\/dsh-desktop\/releases\/tag\/v[^/]+$/)
})
it('links the release notes beside the update controls in both languages', () => {
  const releases = 'https://github.com/anywhere-labs/dsh-desktop/releases'
  const installed = baseState.version
  // An installed build ahead of the last release (a source run) is reported the older, published version.
  const current: NextUpdateState = { phase: 'current', version: '2.0.19-next', installable: true }
  const ready: NextUpdateState = { phase: 'ready', version: '2.0.21-next', installable: true }
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
