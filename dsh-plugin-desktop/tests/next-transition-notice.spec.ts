import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { MessageBoxReturnValue } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { NextTransitionNotice } from '../src/next-transition-notice.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'next-transition-')); directories.push(directory)
  const options = { path: join(directory, 'notices', 'next-transition-v1'),
    show: vi.fn(async (): Promise<MessageBoxReturnValue> => ({ response: 1, checkboxChecked: false })), reportError: vi.fn() }
  return { options, notice: new NextTransitionNotice(options) }
}
it('shows on first Stable launch with a separate opt-out button and localizes the copy', async () => {
  const { options, notice } = await fixture()
  await notice.open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledWith(expect.objectContaining({
    message: 'Next 将成为新的稳定版桌面端', buttons: ['不再提醒', '知道了'], defaultId: 1, cancelId: 1,
  }))
  await notice.open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledTimes(1)
  await new NextTransitionNotice(options).open('en', 'stable', () => true)
  expect(options.show).toHaveBeenLastCalledWith(expect.objectContaining({
    message: 'Next will become the new stable desktop app', buttons: ["Don't show again", 'OK'],
  }))
})
// #1418: on macOS the in-dialog checkbox could not be ticked, so the notice
// returned on every launch. The opt-out must not depend on any checkbox state.
it('never asks the dialog for checkbox state', async () => {
  const { options, notice } = await fixture()
  await notice.open('zh', 'stable', () => true)
  const shown = options.show.mock.calls[0] as unknown as [Record<string, unknown>]
  expect(shown[0]).not.toHaveProperty('checkboxLabel')
  expect(shown[0]).not.toHaveProperty('checkboxChecked')
})
it('persists the opt-out button across launches even when no checkbox was ticked', async () => {
  const { options, notice } = await fixture()
  options.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  await notice.open('zh', 'stable', () => true)
  expect(await readFile(options.path, 'utf8')).toBe('next-transition-v1:dismissed\n')
  await new NextTransitionNotice(options).open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledTimes(1)
})
it('keeps reminding after the acknowledgement button, Escape or closing the window', async () => {
  const { options, notice } = await fixture()
  options.show.mockResolvedValue({ response: 1, checkboxChecked: true })
  await notice.open('zh', 'stable', () => true)
  await new NextTransitionNotice(options).open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledTimes(2)
})
it('stays out of Beta, Next and disposed generations', async () => {
  const { options, notice } = await fixture()
  await notice.open('zh', 'beta', () => true)
  await notice.open('zh', 'next', () => true)
  await notice.open('zh', 'stable', () => false)
  expect(options.show).not.toHaveBeenCalled()
})
it('deduplicates concurrent opens and tolerates corrupt state and dialog failure', async () => {
  const { options, notice } = await fixture()
  await mkdir(dirname(options.path), { recursive: true })
  await writeFile(options.path, 'corrupt')
  options.show.mockRejectedValue(new Error('closed'))
  const first = notice.open('en', 'stable', () => true)
  expect(notice.open('en', 'stable', () => true)).toBe(first)
  await expect(first).resolves.toBeUndefined()
  expect(options.show).toHaveBeenCalledTimes(1)
  expect(options.reportError).toHaveBeenCalledTimes(1)
})
