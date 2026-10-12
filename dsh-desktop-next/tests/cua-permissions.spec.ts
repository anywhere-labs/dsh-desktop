/** Exercise the installed Yarn-patched provider against a fake native driver, never the desktop. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Provider from '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
import type { DesktopPermission, DesktopPermissions } from '../src/permissions.ts'

const native = vi.hoisted(() => ({ create: vi.fn(), call: vi.fn(), shutdown: vi.fn(), destroy: vi.fn() }))
vi.mock('@trycua/cua-driver', () => ({ CuaDriver: { create: () => {
  native.create()
  return {
    listToolsJson: async () => JSON.stringify({ tools: [
      { name: 'check_permissions', inputSchema: { type: 'object', properties: { prompt: { type: 'boolean' } } } },
      { name: 'fixture_echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } },
    ] }),
    callTool: native.call, shutdown: native.shutdown, uniffiDestroy: native.destroy,
  }
} } }))
let ctx: Context
beforeEach(async () => {
  vi.clearAllMocks()
  native.call.mockResolvedValue({ rawJson: JSON.stringify({ content: [{ type: 'text', text: 'Actual driver: screen recording denied' }] }) })
  ctx = new Context()
  await ctx.plugin(ComputerUseRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
})
afterEach(async () => { await ctx.fiber.dispose() })
const state = (permission: DesktopPermission) => ({ permission, status: 'denied' as const, canRequest: false, canOpenSettings: true })
function service(): DesktopPermissions {
  const permissions = { query: vi.fn(async (permission: DesktopPermission) => state(permission)),
    request: vi.fn(async (permission: DesktopPermission) => state(permission)), openSettings: vi.fn(async () => {}) }
  ctx.provide('desktopPermissions', permissions)
  return permissions
}
async function mount() {
  const fiber = ctx.plugin(Provider)
  await fiber
  expect(native.create).toHaveBeenCalledOnce() // Never run calls if the native mock was bypassed.
  return fiber
}
function execute(name = 'check_permissions', args: Record<string, unknown> = { prompt: false }) {
  return ctx.tools.execute({ name: `cua_driver_native__${name}`, callId: ToolCallId('desktop-cua-test'), arguments: args, signal: new AbortController().signal })
}

it('queries Desktop without prompting and preserves the driver permission result', async () => {
  const permissions = service()
  const fiber = await mount()
  const result = await execute()
  expect(permissions.query).toHaveBeenCalledWith('screen')
  expect(permissions.query).toHaveBeenCalledWith('accessibility')
  expect(permissions.request).not.toHaveBeenCalled()
  expect(native.call).toHaveBeenCalledWith('check_permissions', '{"prompt":false}', expect.anything())
  expect(result.content).toEqual([{ type: 'text', text: 'Actual driver: screen recording denied' }])
  await fiber.dispose()
  expect(ctx.computerUse.providerName).toBeUndefined()
  expect(native.shutdown).toHaveBeenCalledOnce()
  expect(native.destroy).toHaveBeenCalledOnce()
})

it('routes explicit requests for missing grants through Desktop and prevents a second native prompt', async () => {
  const permissions = service()
  vi.mocked(permissions.query).mockImplementation(async permission => ({ ...state(permission), status: permission === 'screen' ? 'granted' : 'denied' }))
  await mount()
  await execute('check_permissions', { prompt: true })
  expect(permissions.request).toHaveBeenCalledExactlyOnceWith('accessibility')
  expect(native.call).toHaveBeenCalledWith('check_permissions', '{"prompt":false}', expect.anything())
})

it('retains upstream behavior without Desktop and leaves ordinary tools unchanged', async () => {
  await mount()
  await execute('check_permissions', { prompt: true })
  expect(native.call).toHaveBeenCalledWith('check_permissions', '{"prompt":true}', expect.anything())
  const permissions = service()
  await execute('fixture_echo', { value: 'unchanged' })
  expect(permissions.query).not.toHaveBeenCalled()
  expect(native.call).toHaveBeenLastCalledWith('fixture_echo', '{"value":"unchanged"}', expect.anything())
})

it('does not fall back to native prompting when the Desktop bridge fails', async () => {
  const permissions = service()
  vi.mocked(permissions.query).mockRejectedValue(new Error('Desktop disconnected'))
  await mount()
  expect((await execute('check_permissions', { prompt: true })).isError).toBe(true)
  expect(native.call).not.toHaveBeenCalled()
  expect(permissions.request).not.toHaveBeenCalled()
})
