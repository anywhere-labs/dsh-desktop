import { afterEach, expect, it, vi } from 'vitest'
import { main } from '../src/host/index.ts'

const hostProcess = process as unknown as { noAsar?: boolean }

afterEach(() => {
  delete hostProcess.noAsar
  vi.unstubAllEnvs()
})

it('reads user workspaces physically before the Host validates its launch', async () => {
  delete hostProcess.noAsar
  vi.stubEnv('DSH_HOME', '')

  await expect(main()).rejects.toThrow('Next Host requires runtime, profile, home and IPC')

  expect(hostProcess.noAsar).toBe(true)
})
