/** Computer Use (Next) beside the official Computer Use bundle of dsh 0.2.3. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import type * as OfficialCua from '@deepseek-ai/dsh-cua'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Provider from '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
import {
  COMPUTER_USE_COMMAND_NAME,
  CUA_PROMPT_SECTION,
  CUA_TOOL_PREFIX,
  foldSessionComputerUseEnabled,
  installComputerUseCommand,
  type ComputerUseCommandController,
} from '../../src/host/computer-use-command.ts'
import {
  OFFICIAL_COMPUTER_USE_PROVIDER,
  OFFICIAL_CUA_PROGRAM_TOOL,
  OFFICIAL_CUA_TOOL,
  officialComputerUsePlatform,
  officialComputerUseSupported,
  officialHelperUnsupported,
  officialWindowsHelperInstalled,
} from '../../src/upstream-family/official-computer-use.ts'
import { officialCuaWindowsHelper } from '../../src/upstream-family/official-cua.ts'
import { defineContentToolFixture, executeToolFixture, installToolExecution } from '../upstream-family.ts'

const native = vi.hoisted(() => ({
  create: vi.fn(),
  call: vi.fn(),
  shutdown: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@trycua/cua-driver', () => ({
  CuaDriver: {
    create: () => {
      native.create()
      return {
        listToolsJson: async () =>
          JSON.stringify({
            tools: [
              {
                name: 'check_permissions',
                inputSchema: { type: 'object', properties: { prompt: { type: 'boolean' } } },
              },
              {
                name: 'screenshot_Display',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          }),
        callTool: native.call,
        shutdown: native.shutdown,
        uniffiDestroy: native.destroy,
      }
    },
  },
}))

/** Composed preset of each test Agent, read through the `agentPresets` stand-in. */
const presets = new Map<ScopeKey | undefined, string>()

async function createAgentInTest(
  ctx: Context,
  id: string,
  options?: { preset?: string },
): Promise<{ agent: Agent; steer: ReturnType<typeof vi.fn> }> {
  const session = ctx.sessions.create(SessionId(id))
  const steer = vi.fn()
  let scope!: Scope
  const agent = {
    id: session.id,
    session,
    steer,
    get ctx() {
      return scope.ctx
    },
  } as unknown as Agent
  if (options?.preset !== undefined) presets.set(agent, options.preset)
  // Like the shipped agent loop, the Agent scope declares no `commands` injection.
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, agent)
      },
      { inject: ['tools', 'systemPrompt', 'sessions', 'agents'] },
    ),
  )
  await ctx.agents.register(agent)
  return { agent, steer }
}

/**
 * Install the official Computer Use as the bundle's macOS provider does once its helper is prepared:
 * `installCua` of `@deepseek-ai/dsh-cua`, the bundle's runtime for every platform, since the macOS-only
 * provider package is not installed elsewhere. The bundle installs on demand into the Profile, so the
 * specs depend on that runtime directly. No test operation starts a helper.
 * @param ctx - test root providing the provider's registry, tool, prompt, Agent and preset services.
 * @returns disposer that unloads the provider.
 */
async function installOfficialComputerUse(ctx: Context): Promise<() => Promise<void>> {
  const cua = await import(pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-cua')).href) as typeof OfficialCua
  const fiber = ctx.plugin({
    name: 'official-computer-use',
    inject: ['computerUse', 'tools', 'systemPrompt', 'agents'],
    apply: (inner: Context) => {
      cua.installCua(inner, cua.CuaConfig({}), {
        helperPath: join(tmpdir(), 'dsh-cua-native'),
        createChannel: () => { throw new Error('official Computer Use fixtures start no helper') },
        getGuidance: () => 'Official Computer Use guidance', capabilities: { platform: 'macos', systemInput: true, methods: [], appLevelAccessibility: true, keyboard: ['app'], browser: false, coordinateSpace: 'screenshot-pixels' },
        permissionParameters: (_method, permission) => ({ permission }),
      })
    },
  })
  await fiber
  return async () => { await fiber.dispose() }
}

describe('installComputerUseCommand beside the official Computer Use', () => {
  let profileDir: string
  let ctx: Context
  let nextRealm: Context
  const signal = new AbortController().signal
  const toolNames = async (agent: Agent): Promise<string[]> =>
    (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
  const sectionNames = async (agent: Agent): Promise<string[]> =>
    (await ctx.systemPrompt.assemble(assembleContextFor(agent))).sections.filter(section => section.text.length > 0).map(section => section.name)
  /** Compose Computer Use (Next) in its realm and the official provider beside it. */
  const installBoth = async (): Promise<{ controller: ComputerUseCommandController; unloadOfficial: () => Promise<void> }> => {
    const controller = installComputerUseCommand(ctx, profileDir)
    await nextRealm.plugin(Provider)
    return { controller, unloadOfficial: await installOfficialComputerUse(ctx) }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    presets.clear()
    profileDir = mkdtempSync(join(tmpdir(), 'dsh-computer-use-official-'))
    native.call.mockResolvedValue({ rawJson: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) })
    ctx = new Context()
    ctx.provide('agentPresets', { composedPreset: (agentCtx: Context) => presets.get(scopeOf(agentCtx)) })
    // The official provider runs `cua_run_code` on a private Node PTC runtime for the Agents off its preset. No test
    // runs a program, so these services only let that runtime and its tool register.
    for (const name of ['fs', 'subprocess', 'sandbox', 'sandboxPolicy', 'workingDirectory']) ctx.provide(name, {})
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await installToolExecution(ctx)
    await ctx.plugin(CommandRuntime)
    ctx.tools.register(defineContentToolFixture({
      name: 'ordinary_echo', description: 'Ordinary workspace tool', parameters: {},
      execute: async () => [{ type: 'text', text: 'echo' }],
    }))
    // As the shipped patches compose them: Computer Use (Next) keeps a registry realm of its own,
    // and the official bundle mounts the registry every other plugin sees.
    nextRealm = ctx.isolate('computerUse')
    await nextRealm.plugin(ComputerUseRegistry)
    await ctx.plugin(ComputerUseRegistry)
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('registers /computer-use in each session and removes it when Computer Use (Next) unloads', async () => {
    const fiber = ctx.plugin((inner: Context) => { installComputerUseCommand(inner, profileDir) })
    await fiber
    const { agent: early } = await createAgentInTest(ctx, 'session-early')
    // Without the Computer Use (Next) tools there is nothing to load.
    expect(ctx.commands.find(early, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()

    await nextRealm.plugin(Provider)
    const { agent: late } = await createAgentInTest(ctx, 'session-late')
    expect(ctx.commands.find(early, COMPUTER_USE_COMMAND_NAME)).toBeDefined()
    expect(ctx.commands.list(late).map(item => item.name)).toContain(COMPUTER_USE_COMMAND_NAME)

    await fiber.dispose()
    expect(ctx.commands.find(early, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()
    expect(ctx.commands.find(late, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()
  })

  it('leaves every session to the official provider: raw `cua` on its preset, `cua_run_code` on the others', async () => {
    await installBoth()
    expect(ctx.get('computerUse')?.providerName).toBe(OFFICIAL_COMPUTER_USE_PROVIDER)
    expect(nextRealm.get('computerUse')?.providerName).toBe('cua-driver-native')

    const { agent: ptc, steer } = await createAgentInTest(ctx, 'session-ptc', { preset: 'ptc' })
    const { agent: standard } = await createAgentInTest(ctx, 'session-standard', { preset: 'standard' })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, ptc)).toBeDefined() })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, standard)).toBeDefined() })
    expect(ctx.tools.get(OFFICIAL_CUA_TOOL, standard)).toBeUndefined()
    expect(await toolNames(ptc)).toContain(OFFICIAL_CUA_TOOL)
    expect(await toolNames(standard)).toContain(OFFICIAL_CUA_PROGRAM_TOOL)

    // The sessions the official provider serves offer no `/computer-use`, so typing it runs nothing.
    for (const agent of [ptc, standard]) {
      expect(ctx.commands.list(agent).map(item => item.name)).not.toContain(COMPUTER_USE_COMMAND_NAME)
      expect(await ctx.commands.execute(agent, `/${COMPUTER_USE_COMMAND_NAME} Open the settings`, [], signal)).toBeUndefined()
      expect(foldSessionComputerUseEnabled(agent.session)).toBe(false)
      expect((await toolNames(agent)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
      expect(await sectionNames(agent)).not.toContain(CUA_PROMPT_SECTION)
    }
    expect(steer).not.toHaveBeenCalled()
    const denied = await executeToolFixture(ctx, {
      name: `${CUA_TOOL_PREFIX}check_permissions`, callId: ToolCallId('call-ptc'), arguments: { prompt: false }, agent: ptc, signal,
    })
    expect(denied.isError).toBe(true)
    expect(native.call).not.toHaveBeenCalled()
  })

  it('follows the official provider arriving, preset switches and the provider leaving', async () => {
    installComputerUseCommand(ctx, profileDir)
    await nextRealm.plugin(Provider)
    const { agent } = await createAgentInTest(ctx, 'session-switch', { preset: 'standard' })
    const standardRun = await ctx.commands.execute(agent, `/${COMPUTER_USE_COMMAND_NAME}`, [], signal)
    expect(standardRun?.result).toMatchObject({ kind: 'success', text: '已开启 Computer Use（Next），输入 /computer-use off 关闭。' })
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    const changes = vi.fn()
    ctx.on('commands/change', changes)

    const unloadOfficial = await installOfficialComputerUse(ctx)
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, agent)).toBeDefined() })
    // The command leaves with the tools, before any request is assembled, and the client hears about it.
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()
    expect(changes).toHaveBeenCalled()
    expect((await toolNames(agent)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
    expect(await sectionNames(agent)).not.toContain(CUA_PROMPT_SECTION)

    const switchTo = (preset: string): void => {
      presets.set(agent, preset)
      ctx.emit('agent-preset/selected', agent.id, preset)
    }
    switchTo('ptc')
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, agent)).toBeDefined() })
    expect(ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, agent)).toBeUndefined()
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()
    switchTo('standard')
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, agent)).toBeDefined() })
    expect(ctx.tools.get(OFFICIAL_CUA_TOOL, agent)).toBeUndefined()
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()

    changes.mockClear()
    await unloadOfficial()
    expect(ctx.get('computerUse')?.providerName).toBeUndefined()
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeDefined()
    expect(changes).toHaveBeenCalled()
    // The session's earlier `/computer-use` still applies.
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    expect(await sectionNames(agent)).toContain(CUA_PROMPT_SECTION)
  })

  it('keeps resident Computer Use (Next) out of the sessions the official provider serves', async () => {
    const { controller, unloadOfficial } = await installBoth()
    controller.setCommandMode(false)
    const { agent: ptc } = await createAgentInTest(ctx, 'session-ptc', { preset: 'ptc' })
    const { agent: standard } = await createAgentInTest(ctx, 'session-standard', { preset: 'standard' })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, ptc)).toBeDefined() })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_PROGRAM_TOOL, standard)).toBeDefined() })
    for (const agent of [ptc, standard]) {
      expect((await toolNames(agent)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
      expect(await sectionNames(agent)).not.toContain(CUA_PROMPT_SECTION)
    }
    await unloadOfficial()
    for (const agent of [ptc, standard]) {
      expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
      expect(await sectionNames(agent)).toContain(CUA_PROMPT_SECTION)
    }
  })
})

it('keeps Computer Use (Next) where the official helper cannot start, before macOS 14', () => {
  expect(officialHelperUnsupported('darwin', '22.6.0')).toBe(true)
  expect(officialHelperUnsupported('darwin', '23.0.0')).toBe(false)
  expect(officialHelperUnsupported('darwin', '25.1.0')).toBe(false)
  expect(officialHelperUnsupported('linux', '6.8.0')).toBe(false)
  expect(officialHelperUnsupported('win32', '10.0.26100')).toBe(false)
})

it('offers the official Computer Use switch on macOS 14 and later and in Windows installations that carry its helper', () => {
  expect(officialComputerUseSupported('darwin', '22.6.0')).toBe(false)
  expect(officialComputerUseSupported('darwin', '23.0.0')).toBe(true)
  expect(officialComputerUseSupported('darwin', '25.1.0')).toBe(true)
  expect(officialComputerUseSupported('linux', '6.8.0', () => true)).toBe(false)
  expect(officialComputerUseSupported('win32', '10.0.26100', () => true)).toBe(true)
  expect(officialComputerUseSupported('win32', '10.0.26100', () => false)).toBe(false)
  expect(officialComputerUsePlatform('darwin')).toBe('macos')
  expect(officialComputerUsePlatform('win32')).toBe('windows')
  expect(officialComputerUsePlatform('linux')).toBeUndefined()
})

it('finds the Windows helper beside the archive the provider runs from', () => {
  expect(officialCuaWindowsHelper('/opt/DSH/resources/app.asar/node_modules/@deepseek-ai/dsh-cua-windows', 'arm64'))
    .toBe('/opt/DSH/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-cua-windows/native/bin/win-arm64/dsh-cua-windows.exe')
  expect(officialCuaWindowsHelper('C:\\DSH\\resources\\app.asar\\node_modules\\@deepseek-ai\\dsh-cua-windows', 'x64'))
    .toContain('app.asar.unpacked')
  const root = mkdtempSync(join(tmpdir(), 'official-cua-windows-'))
  try {
    const provider = join(root, 'resources', 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-cua-windows')
    expect(officialWindowsHelperInstalled('x64', () => provider)).toBe(false)
    const helper = officialCuaWindowsHelper(provider, 'x64')
    mkdirSync(join(helper, '..'), { recursive: true })
    writeFileSync(helper, 'helper')
    expect(officialWindowsHelperInstalled('x64', () => provider)).toBe(true)
    expect(officialWindowsHelperInstalled('arm64', () => provider)).toBe(false)
    expect(officialWindowsHelperInstalled('x64', () => { throw new Error('Cannot find module') })).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
