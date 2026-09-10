import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteControlOffer } from '../src/remote-control-offer.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'remote-control-offer-')); directories.push(directory)
  const options = { path: join(directory, 'notice'), readEnabled: vi.fn(async () => false),
    enable: vi.fn(async () => {}), confirm: vi.fn(async () => false), reportError: vi.fn() }
  return { options, offer: new RemoteControlOffer(options) }
}
it('remembers the first click across launches even when activation is cancelled', async () => {
  const { options, offer } = await fixture()
  expect(await offer.read()).toEqual({ enabled: false, seen: false })
  await offer.open('zh')
  expect(options.enable).not.toHaveBeenCalled()
  expect(await new RemoteControlOffer(options).read()).toEqual({ enabled: false, seen: true })
})
it('only enables after confirmation and does not offer an already enabled plugin', async () => {
  const { options, offer } = await fixture()
  options.confirm.mockResolvedValue(true)
  await offer.open('en')
  expect(options.enable).toHaveBeenCalledTimes(1)
  options.readEnabled.mockResolvedValue(true)
  await offer.open('en')
  expect(options.confirm).toHaveBeenCalledTimes(1)
  expect((await offer.read()).enabled).toBe(true)
})
it('deduplicates clicks while confirmation is open', async () => {
  const { options, offer } = await fixture()
  let confirm!: (value: boolean) => void
  options.confirm.mockImplementation(() => new Promise(resolve => { confirm = resolve }))
  const first = offer.open('zh')
  const second = offer.open('zh')
  expect(second).toBe(first)
  await vi.waitFor(() => expect(options.confirm).toHaveBeenCalledTimes(1))
  confirm(true)
  await first
  expect(options.enable).toHaveBeenCalledTimes(1)
})
it('keeps the notice seen after failure and permits retry', async () => {
  const { options, offer } = await fixture()
  options.confirm.mockResolvedValue(true)
  options.enable.mockRejectedValueOnce(new Error('save failed'))
  await expect(offer.open('zh')).rejects.toThrow('save failed')
  expect((await offer.read()).seen).toBe(true)
  await offer.open('zh')
  expect(options.enable).toHaveBeenCalledTimes(2)
})
