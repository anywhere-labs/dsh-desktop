import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Provider from '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
import {
  COMPUTER_USE_COMMAND_NAME,
  COMPUTER_USE_SETTINGS_ROUTE,
  CUA_PROMPT_SECTION,
  CUA_TOOL_PREFIX,
  OFFICIAL_COMPUTER_USE_PROVIDER,
  OFFICIAL_CUA_TOOL,
  foldSessionComputerUseEnabled,
  installComputerUseCommand,
  officialHelperUnsupported,
  readComputerUseCommandConfig,
  type ComputerUseCommandController,
} from '../src/host/computer-use-command.ts'
import {
  ComputerUseCommandIcon,
  ComputerUsePluginArtwork,
  enrichComputerUseCandidates,
  registerComputerUseCommandUi,
} from '../src/client/computer-use-command-ui.tsx'
import type {
  CandidateRequest,
  ClientSessionContext,
  InputTriggerCandidate,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { defineContentToolFixture, executeToolFixture, installOfficialComputerUse, installToolExecution, OFFICIAL_COMPUTER_USE } from './upstream-family.ts'

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

interface RegisteredRoute {
  path: string
  methods?: readonly string[]
  fetch: (request: Request) => Promise<Response> | Response
}

/** Composed preset of each test Agent, read through the `agentPresets` stand-in. */
const presets = new Map<ScopeKey | undefined, string>()

async function createAgentInTest(
  ctx: Context,
  id: string,
  options?: { parentSession?: SessionId; owner?: Agent; preset?: string },
): Promise<{ agent: Agent; scope: Scope; steer: ReturnType<typeof vi.fn> }> {
  const session = ctx.sessions.create(SessionId(id), {
    ...(options?.parentSession ? { meta: { parentSession: options.parentSession } } : {}),
  })
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
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, agent)
      },
      { inject: ['tools', 'systemPrompt', 'commands', 'sessions', 'agents'] },
    ),
  )
  if (options?.owner) {
    ctx.agents.enter(agent, options.owner)
    await ctx.agents.announce(agent, 'startup')
  } else {
    await ctx.agents.register(agent)
  }
  return { agent, scope, steer }
}

describe('installComputerUseCommand', () => {
  let profileDir: string
  let ctx: Context
  let routes: Map<string, RegisteredRoute>

  beforeEach(async () => {
    vi.clearAllMocks()
    profileDir = mkdtempSync(join(tmpdir(), 'dsh-computer-use-cmd-'))
    routes = new Map()
    native.call.mockResolvedValue({
      rawJson: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    })

    ctx = new Context()
    ctx.provide('connection', {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
          }
        },
      },
    })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await installToolExecution(ctx)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(ComputerUseRegistry)

    ctx.tools.register(
      defineContentToolFixture({
        name: 'ordinary_echo',
        description: 'Ordinary workspace tool',
        parameters: {},
        execute: async () => [{ type: 'text', text: 'echo' }],
      }),
    )
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('defaults commandMode to true, registers /computer-use, and hides CUA tools and prompt section in ordinary sessions', async () => {
    const controller = installComputerUseCommand(ctx, profileDir)
    expect(controller.getCommandMode()).toBe(true)
    expect(readComputerUseCommandConfig(profileDir)).toEqual({ commandMode: true })

    await ctx.plugin(Provider)
    const { agent: agentA } = await createAgentInTest(ctx, 'session-a')

    // `/computer-use` command is registered when CUA tools exist and commandMode is true
    expect(ctx.commands.find(agentA, COMPUTER_USE_COMMAND_NAME)).toMatchObject({
      name: COMPUTER_USE_COMMAND_NAME,
      input: { hint: '[off|message]', attachments: true },
    })

    // Ordinary session has CUA tools restricted and CUA prompt section omitted
    const assemblyA = await ctx.systemPrompt.assemble(assembleContextFor(agentA))
    expect(assemblyA.tools.map(tool => tool.name)).toEqual(['ordinary_echo'])
    expect(assemblyA.sections.some(section => section.name === CUA_PROMPT_SECTION)).toBe(false)

    // Direct execution of CUA tool is rejected while gated
    const denied = await executeToolFixture(ctx, {
      name: 'cua_driver_native__check_permissions',
      callId: ToolCallId('call-denied'),
      arguments: { prompt: false },
      agent: agentA,
      signal: new AbortController().signal,
    })
    expect(denied.isError).toBe(true)
    expect(native.call).not.toHaveBeenCalled()
  })

  it('enables CUA tools and prompt section per session via /computer-use, steers task input, and disables via /computer-use off', async () => {
    installComputerUseCommand(ctx, profileDir)
    await ctx.plugin(Provider)

    const { agent: agentA, steer: steerA } = await createAgentInTest(ctx, 'session-a')
    const { agent: agentB } = await createAgentInTest(ctx, 'session-b')

    // Run `/computer-use Open the browser and check the page` on session A
    const enableExec = await ctx.commands.execute(
      agentA,
      `/${COMPUTER_USE_COMMAND_NAME} Open the browser and check the page`,
      [],
      new AbortController().signal,
    )
    expect(enableExec?.result.kind).toBe('success')
    expect(steerA).toHaveBeenCalledTimes(1)
    expect(steerA.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Open the browser and check the page' }],
      source: { kind: 'user' },
    })

    // Session A now sees CUA tools and the CUA prompt section
    const assemblyAEnabled = await ctx.systemPrompt.assemble(assembleContextFor(agentA))
    expect(assemblyAEnabled.tools.map(tool => tool.name)).toContain(
      'cua_driver_native__check_permissions',
    )
    expect(assemblyAEnabled.tools.map(tool => tool.name)).toContain(
      'cua_driver_native__screenshot_Display',
    )
    expect(
      assemblyAEnabled.sections.some(
        section => section.name === CUA_PROMPT_SECTION && section.text.length > 0,
      ),
    ).toBe(true)

    const allowed = await executeToolFixture(ctx, {
      name: 'cua_driver_native__check_permissions',
      callId: ToolCallId('call-allowed'),
      arguments: { prompt: false },
      agent: agentA,
      signal: new AbortController().signal,
    })
    expect(allowed.isError).toBeFalsy()
    expect(native.call).toHaveBeenCalledTimes(1)

    // Session B remains restricted!
    const assemblyB = await ctx.systemPrompt.assemble(assembleContextFor(agentB))
    expect(assemblyB.tools.map(tool => tool.name)).toEqual(['ordinary_echo'])
    expect(assemblyB.sections.some(section => section.name === CUA_PROMPT_SECTION)).toBe(false)

    // Subagent spawned under Session A inherits Session A's enabled state
    const { agent: subagentA } = await createAgentInTest(ctx, 'subagent-a', {
      parentSession: agentA.id,
      owner: agentA,
    })
    const assemblySubagent = await ctx.systemPrompt.assemble(assembleContextFor(subagentA))
    expect(assemblySubagent.tools.map(tool => tool.name)).toContain(
      'cua_driver_native__check_permissions',
    )

    // Run `/computer-use off` on session A
    const disableExec = await ctx.commands.execute(
      agentA,
      `/${COMPUTER_USE_COMMAND_NAME} off`,
      [],
      new AbortController().signal,
    )
    expect(disableExec?.result.kind).toBe('success')

    const assemblyADisabled = await ctx.systemPrompt.assemble(assembleContextFor(agentA))
    expect(assemblyADisabled.tools.map(tool => tool.name)).toEqual(['ordinary_echo'])
    expect(assemblyADisabled.sections.some(section => section.name === CUA_PROMPT_SECTION)).toBe(
      false,
    )
  })

  it('restores per-session Computer Use state from logged command events on session resume', async () => {
    installComputerUseCommand(ctx, profileDir)
    await ctx.plugin(Provider)

    const { agent: agentA } = await createAgentInTest(ctx, 'session-resume')
    await ctx.commands.execute(
      agentA,
      `/${COMPUTER_USE_COMMAND_NAME}`,
      [],
      new AbortController().signal,
    )
    expect(foldSessionComputerUseEnabled(agentA.session)).toBe(true)

    // Simulate a fresh session seeded with the prior session's events
    const seedEvents = agentA.session.snapshotEvents()
    const resumedSession = ctx.sessions.create(SessionId('session-resumed-copy'), {
      seed: seedEvents,
    })
    expect(foldSessionComputerUseEnabled(resumedSession)).toBe(true)

    let resumedScope!: Scope
    const resumedAgent = {
      id: resumedSession.id,
      session: resumedSession,
      steer: vi.fn(),
      get ctx() {
        return resumedScope.ctx
      },
    } as unknown as Agent
    await ctx.plugin(
      Object.assign(
        (inner: Context) => {
          resumedScope = createScope(inner, resumedAgent)
        },
        { inject: ['tools', 'systemPrompt', 'commands', 'sessions', 'agents'] },
      ),
    )
    await ctx.agents.register(resumedAgent)

    const assemblyResumed = await ctx.systemPrompt.assemble(assembleContextFor(resumedAgent))
    expect(assemblyResumed.tools.map(tool => tool.name)).toContain(
      'cua_driver_native__check_permissions',
    )
  })

  it('exposes GET/POST settings route and makes CUA tools resident across all sessions when commandMode is disabled', async () => {
    installComputerUseCommand(ctx, profileDir)
    await ctx.plugin(Provider)
    const { agent: agentA } = await createAgentInTest(ctx, 'session-a')

    const route = routes.get(COMPUTER_USE_SETTINGS_ROUTE)
    expect(route).toBeDefined()

    const getRes = await route!.fetch(
      new Request(`http://localhost${COMPUTER_USE_SETTINGS_ROUTE}`, { method: 'GET' }),
    )
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual({ commandMode: true })

    // Turn off commandMode via POST /api/desktop-next/computer-use
    const postRes = await route!.fetch(
      new Request(`http://localhost${COMPUTER_USE_SETTINGS_ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandMode: false }),
      }),
    )
    expect(postRes.status).toBe(200)
    expect(await postRes.json()).toEqual({ commandMode: false })
    expect(readComputerUseCommandConfig(profileDir)).toEqual({ commandMode: false })

    // `/computer-use` command is unregistered when commandMode is false
    expect(ctx.commands.find(agentA, COMPUTER_USE_COMMAND_NAME)).toBeUndefined()

    // CUA tools and prompt section are now resident in ordinary sessions without running `/computer-use`
    const assemblyResident = await ctx.systemPrompt.assemble(assembleContextFor(agentA))
    expect(assemblyResident.tools.map(tool => tool.name)).toContain(
      'cua_driver_native__check_permissions',
    )
    expect(
      assemblyResident.sections.some(
        section => section.name === CUA_PROMPT_SECTION && section.text.length > 0,
      ),
    ).toBe(true)
  })
})

describe.runIf(OFFICIAL_COMPUTER_USE)('installComputerUseCommand beside the official Computer Use', () => {
  let profileDir: string
  let ctx: Context
  let nextRealm: Context
  let controller: ComputerUseCommandController
  let unloadOfficial: () => Promise<void>
  const signal = new AbortController().signal
  const toolNames = async (agent: Agent): Promise<string[]> =>
    (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
  const sectionNames = async (agent: Agent): Promise<string[]> =>
    (await ctx.systemPrompt.assemble(assembleContextFor(agent))).sections.filter(section => section.text.length > 0).map(section => section.name)

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
    controller = installComputerUseCommand(ctx, profileDir)
    await nextRealm.plugin(Provider)
    unloadOfficial = await installOfficialComputerUse(ctx)
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('leaves PTC sessions to the official provider and keeps Computer Use (Next) in the others', async () => {
    expect(ctx.get('computerUse')?.providerName).toBe(OFFICIAL_COMPUTER_USE_PROVIDER)
    expect(nextRealm.get('computerUse')?.providerName).toBe('cua-driver-native')

    const { agent: ptc, steer } = await createAgentInTest(ctx, 'session-ptc', { preset: 'ptc' })
    const { agent: standard } = await createAgentInTest(ctx, 'session-standard', { preset: 'standard' })
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, ptc)).toBeDefined() })
    expect(ctx.tools.get(OFFICIAL_CUA_TOOL, standard)).toBeUndefined()

    // The command still forwards the task, which the official provider serves in this session.
    const ptcRun = await ctx.commands.execute(ptc, `/${COMPUTER_USE_COMMAND_NAME} Open the settings`, [], signal)
    expect(ptcRun?.result).toMatchObject({
      kind: 'success', text: '此会话正在使用官方 Computer Use；切换到其他模式后改用 Computer Use（Next）。',
    })
    expect(steer).toHaveBeenCalledTimes(1)
    expect(foldSessionComputerUseEnabled(ptc.session)).toBe(true)
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
    const { agent } = await createAgentInTest(ctx, 'session-switch', { preset: 'standard' })
    await ctx.commands.execute(agent, `/${COMPUTER_USE_COMMAND_NAME}`, [], signal)
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)

    presets.set(agent, 'ptc')
    ctx.emit('agent-preset/selected', agent.id, 'ptc')
    await vi.waitFor(() => { expect(ctx.tools.get(OFFICIAL_CUA_TOOL, agent)).toBeDefined() })
    expect((await toolNames(agent)).filter(name => name.startsWith(CUA_TOOL_PREFIX))).toEqual([])
    expect(await sectionNames(agent)).not.toContain(CUA_PROMPT_SECTION)

    await unloadOfficial()
    expect(ctx.get('computerUse')?.providerName).toBeUndefined()
    expect(await toolNames(agent)).toContain(`${CUA_TOOL_PREFIX}check_permissions`)
    expect(await sectionNames(agent)).toContain(CUA_PROMPT_SECTION)
  })

  it('keeps resident Computer Use (Next) out of the sessions the official provider serves', async () => {
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

describe('computer-use-command-ui', () => {
  it('enriches the /computer-use trigger row with the custom icon, localized label, and short description', () => {
    const rawRows: InputTriggerCandidate[] = [
      { name: 'compact', label: '压缩', description: '压缩以上对话内容', section: '指令' },
      { name: 'computer-use', description: '开启或关闭 Computer Use（Next）', hint: '[off|message]', section: '指令' },
    ]
    const zhRows = enrichComputerUseCandidates(rawRows, true)
    expect(zhRows[0]).toBe(rawRows[0])
    expect(zhRows[1]).toEqual({
      name: 'computer-use',
      label: '电脑操作（Next）',
      description: '开启或关闭 Computer Use（Next）',
      hint: '[off|message]',
      section: '指令',
      icon: ComputerUseCommandIcon,
    })

    const enRows = enrichComputerUseCandidates(rawRows, false)
    expect(enRows[1]).toMatchObject({
      name: 'computer-use',
      label: 'Computer Use (Next)',
      description: 'Enable or disable Computer Use (Next)',
      icon: ComputerUseCommandIcon,
    })

    const iconTree = ComputerUseCommandIcon({ size: 14 }) as unknown as {
      type: string
      props: { width: number; height: number; viewBox: string; children: unknown[] }
    }
    expect(iconTree.type).toBe('svg')
    expect(iconTree.props.width).toBe(14)
    expect(iconTree.props.height).toBe(14)
    expect(iconTree.props.viewBox).toBe('0 0 16 16')
    expect(iconTree.props.children).toHaveLength(5)

    const artworkTree = ComputerUsePluginArtwork({ size: 36 }) as unknown as {
      type: string
      props: { width: number; height: number; viewBox: string }
    }
    expect(artworkTree.type).toBe('svg')
    expect(artworkTree.props.width).toBe(36)
    expect(artworkTree.props.height).toBe(36)
    expect(artworkTree.props.viewBox).toBe('0 0 36 36')
  })

  it('decorates the / command trigger source and supports searching by localized label', async () => {
    const rawCatalog: InputTriggerCandidate[] = [
      { name: 'compact', label: '压缩', description: '压缩以上对话内容', section: '指令' },
      { name: 'computer-use', description: '开启或关闭 Computer Use（Next）', hint: '[off|message]', section: '指令' },
    ]
    const commandSource: InputTriggerSource = {
      trigger: '/',
      name: 'command',
      candidates: async (_session: ClientSessionContext, req: CandidateRequest) =>
        req.query === ''
          ? rawCatalog
          : rawCatalog.filter(
            item =>
              item.name.toLowerCase().includes(req.query.toLowerCase())
              || (item.label?.toLowerCase().includes(req.query.toLowerCase()) ?? false),
          ),
      onPick: () => undefined,
    }
    const sources: InputTriggerSource[] = [commandSource]
    let currentLang = 'zh'
    const mockCtx: any = {
      inject: (_deps: string[], fn: (inner: any) => void) => {
        fn(mockCtx)
      },
      effect: (fn: () => () => void) => fn(),
      locale: {
        bind: () => (key: string) => (key === 'language' ? currentLang : key),
      },
      inputTriggers: {
        live: { sources },
        registerSource: (src: InputTriggerSource) => {
          sources.push(src)
          return () => {}
        },
      },
    }

    registerComputerUseCommandUi(mockCtx as Context)

    const session = { sessionId: SessionId('s-1') }
    const emptyQueryRows = await commandSource.candidates(session, {
      query: '',
      position: 'leading',
      drilled: false,
      signal: new AbortController().signal,
    })
    const row = emptyQueryRows.find(item => item.name === 'computer-use')
    expect(row).toMatchObject({
      name: 'computer-use',
      label: '电脑操作（Next）',
      description: '开启或关闭 Computer Use（Next）',
      icon: ComputerUseCommandIcon,
    })

    // Querying by the Chinese label "电脑" also surfaces the enriched `computer-use` candidate
    const labelQueryRows = await commandSource.candidates(session, {
      query: '电脑',
      position: 'leading',
      drilled: false,
      signal: new AbortController().signal,
    })
    expect(labelQueryRows).toHaveLength(1)
    expect(labelQueryRows[0]).toMatchObject({
      name: 'computer-use',
      label: '电脑操作（Next）',
      description: '开启或关闭 Computer Use（Next）',
      icon: ComputerUseCommandIcon,
    })

    currentLang = 'en'
    const enRows = await commandSource.candidates(session, {
      query: '',
      position: 'leading',
      drilled: false,
      signal: new AbortController().signal,
    })
    expect(enRows.find(item => item.name === 'computer-use')).toMatchObject({
      name: 'computer-use',
      label: 'Computer Use (Next)',
      description: 'Enable or disable Computer Use (Next)',
      icon: ComputerUseCommandIcon,
    })
  })
})
