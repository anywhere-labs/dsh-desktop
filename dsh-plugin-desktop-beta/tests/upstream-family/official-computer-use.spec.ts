/** Computer Use (Next) beside the official Computer Use bundle of dsh 0.2.2, which only Beta follows. */
import { mkdtempSync, rmSync } from 'node:fs'
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
  OFFICIAL_CUA_TOOL,
  officialComputerUseSupported,
  officialHelperUnsupported,
} from '../../src/upstream-family/official-computer-use.ts'
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
 * Install the official Computer Use as the shipped bundle's macOS provider does once its helper is
 * prepared: `installCua` of `@deepseek-ai/dsh-cua`, the bundle's runtime for every platform, since the
 * macOS-only provider package is not installed elsewhere. No test operation starts a helper.
 * @param ctx - test root providing the provider's registry, tool, prompt, Agent and preset services.
 * @returns disposer that unloads the provider.
 */
async function installOfficialComputerUse(ctx: Context): Promise<() => Promise<void>> {
  const bundle = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-cua-bundle/package.json')
  const cua = await import(pathToFileURL(createRequire(bundle).resolve('@deepseek-ai/dsh-cua')).href) as typeof OfficialCua
  const fiber = ctx.plugin({
    name: 'official-computer-use',
    inject: ['computerUse', 'tools', 'systemPrompt', 'agents'],
    apply: (inner: Context) => {
      cua.installCua(inner, cua.CuaConfig({}), {
        helperPath: join(tmpdir(), 'dsh-cua-native'),
        createChannel: () => { throw new Error('official Computer Use fixtures start no helper') },
        guidance: 'Official Computer Use guidance', description: 'Official Computer Use',
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

  it('leaves PTC sessions to the official provider and keeps Computer Use (Next) in the others', async () => {
    await installBoth()
    expect(ctx.get('computerUse')?.providerName).toBe(OFFICIAL_COMPUTER_USE_PROVIDER)
    expect(nextRealm.get('computerUse')?.providerName).toBe('cua-driver-native')

    const { agent: ptc, steer } = await createAgentInTest(ctx, 'session-ptc', { preset: 'ptc' })
    const { agent: standard } = await createAgentInTest(ctx, 'session-standard', { preset: 'standard' })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, ptc)).toBeDefined() })
    expect(ctx.tools.get(OFFICIAL_CUA_TOOL, standard)).toBeUndefined()

    // The session the official provider serves offers no `/computer-use`, so typing it runs nothing.
    expect(ctx.commands.list(ptc).map(item => item.name)).not.toContain(COMPUTER_USE_COMMAND_NAME)
    expect(await ctx.commands.execute(ptc, `/${COMPUTER_USE_COMMAND_NAME} Open the settings`, [], signal)).toBeUndefined()
    expect(steer).not.toHaveBeenCalled()
    expect(foldSessionComputerUseEnabled(ptc.session)).toBe(false)
    const ptcTools = await toolNames(ptc)
    expect(ptcTools).toContain(OFFICIAL_CUA_TOOL)
    expect(ptcTools.filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
    expect(await sectionNames(ptc)).not.toContain(CUA_PROMPT_SECTION)
    const denied = await executeToolFixture(ctx, {
      name: `${CUA_TOOL_PREFIX}check_permissions`, callId: ToolCallId('call-ptc'), arguments: { prompt: false }, agent: ptc, signal,
    })
    expect(denied.isError).toBe(true)
    expect(native.call).not.toHaveBeenCalled()

    const standardRun = await ctx.commands.execute(standard, `/${COMPUTER_USE_COMMAND_NAME}`, [], signal)
    expect(standardRun?.result).toMatchObject({ kind: 'success', text: '已开启 Computer Use（Next），输入 /computer-use off 关闭。' })
    const standardTools = await toolNames(standard)
    expect(standardTools).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    expect(standardTools).not.toContain(OFFICIAL_CUA_TOOL)
    expect(await sectionNames(standard)).toContain(CUA_PROMPT_SECTION)
  })

  it('follows preset switches and the official provider leaving', async () => {
    const { unloadOfficial } = await installBoth()
    const { agent } = await createAgentInTest(ctx, 'session-switch', { preset: 'standard' })
    await ctx.commands.execute(agent, `/${COMPUTER_USE_COMMAND_NAME}`, [], signal)
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    const switchTo = (preset: string): void => {
      presets.set(agent, preset)
      ctx.emit('agent-preset/selected', agent.id, preset)
    }
    const changes = vi.fn()
    ctx.on('commands/change', changes)

    switchTo('ptc')
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, agent)).toBeDefined() })
    // The command leaves with the tools, before any request is assembled, and the client hears about it.
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()
    expect(changes).toHaveBeenCalled()
    expect((await toolNames(agent)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
    expect(await sectionNames(agent)).not.toContain(CUA_PROMPT_SECTION)

    switchTo('standard')
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, agent)).toBeUndefined() })
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeDefined()
    // The session's earlier `/computer-use` still applies.
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)

    switchTo('ptc')
    await vi.waitFor(() => { expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeUndefined() })
    changes.mockClear()
    await unloadOfficial()
    expect(ctx.get('computerUse')?.providerName).toBeUndefined()
    expect(ctx.commands.find(agent, COMPUTER_USE_COMMAND_NAME)).toBeDefined()
    expect(changes).toHaveBeenCalled()
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    expect(await sectionNames(agent)).toContain(CUA_PROMPT_SECTION)
  })

  it('keeps resident Computer Use (Next) out of the sessions the official provider serves', async () => {
    const { controller } = await installBoth()
    controller.setCommandMode(false)
    const { agent: ptc } = await createAgentInTest(ctx, 'session-ptc', { preset: 'ptc' })
    const { agent: standard } = await createAgentInTest(ctx, 'session-standard', { preset: 'standard' })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, ptc)).toBeDefined() })
    expect((await toolNames(ptc)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
    expect(await sectionNames(ptc)).not.toContain(CUA_PROMPT_SECTION)
    expect(await toolNames(standard)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    expect(await sectionNames(standard)).toContain(CUA_PROMPT_SECTION)
  })
})

it('keeps Computer Use (Next) where the official helper cannot start, before macOS 14', () => {
  expect(officialHelperUnsupported('darwin', '22.6.0')).toBe(true)
  expect(officialHelperUnsupported('darwin', '23.0.0')).toBe(false)
  expect(officialHelperUnsupported('darwin', '25.1.0')).toBe(false)
  expect(officialHelperUnsupported('linux', '6.8.0')).toBe(false)
  expect(officialHelperUnsupported('win32', '10.0.26100')).toBe(false)
})

it('offers the official Computer Use switch only on macOS 14 and later', () => {
  expect(officialComputerUseSupported('darwin', '22.6.0')).toBe(false)
  expect(officialComputerUseSupported('darwin', '23.0.0')).toBe(true)
  expect(officialComputerUseSupported('darwin', '25.1.0')).toBe(true)
  expect(officialComputerUseSupported('linux', '6.8.0')).toBe(false)
  expect(officialComputerUseSupported('win32', '10.0.26100')).toBe(false)
})
