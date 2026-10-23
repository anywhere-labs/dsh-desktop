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
import { updateAction, updateLabel } from '../src/update-state.ts'
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
it('allows checks in development, but never downloads or replaces the development application', async () => {
  const { updates, options, request } = await fixture({ packaged: false })
  await updates.check(); await updates.download()
  expect(updates.snapshot()).toMatchObject({ installable: false, error: 'development' })
  expect(request).toHaveBeenCalledOnce(); expect(options.prepare).not.toHaveBeenCalled()
})
it('does not start background update polling on Linux', async () => {
  vi.useFakeTimers()
  const { updates, request } = await fixture({ platform: 'linux', packaged: true })
  updates.start()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(request).not.toHaveBeenCalled()
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
it('serves only the private archive to the native updater and closes its loopback listener', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-feed-test-')); roots.push(root)
  const path = join(root, 'update.zip'); await writeFile(path, 'test archive')
  const feed = await serveMacUpdate(path, '2.0.20-next.1')
  try {
    const metadata = await (await fetch(feed.url)).json() as { url: string; name: string }
    expect(metadata.name).toBe('2.0.20-next.1')
    expect(await (await fetch(metadata.url)).text()).toBe('test archive')
    expect((await fetch(new URL('/update.zip', feed.url))).status).toBe(404)
    expect((await fetch(feed.url, { method: 'POST' })).status).toBe(404)
  } finally { await feed.close() }
  await expect(fetch(feed.url)).rejects.toThrow()
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
it('renders only the version on Linux while showing update status and controls on macOS and Windows', () => {
  const baseState: DesktopState = {
    selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
    features: { market: false, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
    phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture',
    platform: 'linux', version: '2.0.20-next', trayAvailable: true, notificationsAvailable: true,
    browserUrl: null, lan: null, checkpoint: null, logs: '',
    updates: { phase: 'idle', installable: false },
  }
  const linuxHtml = renderToStaticMarkup(createElement(NextUpdateSettings, { state: baseState, language: 'zh-CN', run: vi.fn() }))
  expect(linuxHtml).toContain('桌面版本')
  expect(linuxHtml).not.toContain('应用更新')
  expect(linuxHtml).toContain('DSH NEXT · 2.0.20-next')
  expect(linuxHtml).not.toContain('检查更新')
  expect(linuxHtml).not.toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  expect(linuxHtml).not.toContain('<button')

  const macHtml = renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform: 'darwin' }, language: 'zh-CN', run: vi.fn() }))
  expect(macHtml).toContain('应用更新')
  expect(macHtml).toContain('DSH NEXT · 2.0.20-next')
  expect(macHtml).toContain('检查更新')
  expect(macHtml).toContain('应用内安装更新需要使用 macOS 或 Windows 安装版。')
  expect(macHtml).toContain('<button')
})
