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
    show: vi.fn(async (): Promise<MessageBoxReturnValue> => ({ response: 0, checkboxChecked: false })), reportError: vi.fn() }
  return { options, notice: new NextTransitionNotice(options) }
}
it('shows on first Stable launch with an unchecked opt-out and localizes the copy', async () => {
  const { options, notice } = await fixture()
  await notice.open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledWith(expect.objectContaining({
    message: 'Next 将成为新的稳定版桌面端', checkboxLabel: '确认后不再弹出', checkboxChecked: false,
  }))
  await notice.open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledTimes(1)
  await new NextTransitionNotice(options).open('en', 'stable', () => true)
  expect(options.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Next will become the new stable desktop app' }))
})
it('persists only an explicitly confirmed opt-out across launches', async () => {
  const { options, notice } = await fixture()
  options.show.mockResolvedValue({ response: 0, checkboxChecked: true })
  await notice.open('zh', 'stable', () => true)
  expect(await readFile(options.path, 'utf8')).toBe('next-transition-v1:dismissed\n')
  await new NextTransitionNotice(options).open('zh', 'stable', () => true)
  expect(options.show).toHaveBeenCalledTimes(1)
})
it('does not save an unconfirmed checkbox selection', async () => {
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
