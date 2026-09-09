import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { runDesktopCli } from '../src/bin.ts'

vi.mock('electron', () => ({ default: '/test/Electron' }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => {
  const process = new EventEmitter()
  queueMicrotask(() => process.emit('exit', 0, null))
  return process
}) }))
it('forwards a spaced directory as one argument to Electron without invoking a shell', async () => {
  await expect(runDesktopCli(['--', '中文 project'])).resolves.toBe(0)
  expect(spawn).toHaveBeenCalledWith('/test/Electron', [expect.stringMatching(/main\.js$/), '--', '中文 project'], {
    stdio: 'inherit', env: process.env, windowsHide: false,
  })
})
