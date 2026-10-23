// Preload for the native OpenFilm Studio view (B 方案, 2026-10-18 用户裁决; 阶段 2
// 起接入宿主聊天缝, 2026-10-23 用户裁决「第三行」). The Studio UI reads
// `window.openfilmHost` before its modules run and reports what the person selects /
// where the playhead is through it; this preload forwards those reports to the main
// process, which hands them to the TinTin chat renderer. Studio's own chat is not
// used — the host's optional tabs stay absent, so the editor renders full width and
// our DSH chat lives beside the native view. The agents registry (Settings → Agents)
// is served from the main process (DeepSeek Harness only in phase 2).
import { contextBridge, ipcRenderer, webUtils } from 'electron'
// A sandboxed preload can only require('electron')/builtins — keep these
// literals in sync with ../openfilm-view-contract.ts (main-process side).
const OPENFILM_HOST_SELECTION = 'dsh-desktop:openfilm-host-selection'
const OPENFILM_HOST_REFER = 'dsh-desktop:openfilm-host-refer'
const OPENFILM_HOST_HOVER = 'dsh-desktop:openfilm-host-hover'
const OPENFILM_COMMAND_EVENT = 'dsh-desktop:openfilm-command'
const OPENFILM_AGENT_LIST = 'dsh-desktop:openfilm-agent-list'
const OPENFILM_AGENT_CONNECT = 'dsh-desktop:openfilm-agent-connect'
const OPENFILM_AGENT_DISCONNECT = 'dsh-desktop:openfilm-agent-disconnect'
const OPENFILM_AGENT_SET_SHOWN = 'dsh-desktop:openfilm-agent-set-shown'
const OPENFILM_AGENT_CHANGED = 'dsh-desktop:openfilm-agent-changed'
const OPENFILM_AGENT_LOCAL = 'openfilm:agent:local'
const OPENFILM_AGENT_LOCAL_EVENT = 'openfilm:agent:local-event'

// The chat drives the editor through StudioHost.onCommand (reveal/highlight/draft-refs):
// Studio registers its listener once through the host field, this preload hands it every
// command the main process forwards from the chat renderer.
let commandListener: ((command: unknown) => void) | null = null
ipcRenderer.on(OPENFILM_COMMAND_EVENT, (_event, command: unknown) => {
  try { commandListener?.(command) } catch { /* a Studio-side listener error must not kill the channel */ }
})

// Settings → Agents: Studio re-reads the list whenever the main process says it changed.
const agentListeners = new Set<(agents: unknown[]) => void>()
ipcRenderer.on(OPENFILM_AGENT_CHANGED, (_event, agents: unknown[]) => {
  for (const listener of agentListeners) {
    try { listener(Array.isArray(agents) ? agents : []) } catch { /* a Studio-side listener error must not kill the channel */ }
  }
})

const agentInvoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('openfilmHost', {
  version: 1,
  name: 'TinTin',
  onSelection: (selection: unknown): void => {
    ipcRenderer.send(OPENFILM_HOST_SELECTION, selection)
  },
  refer: (ref: unknown): void => {
    ipcRenderer.send(OPENFILM_HOST_REFER, ref)
  },
  onHover: (ref: unknown): void => {
    ipcRenderer.send(OPENFILM_HOST_HOVER, ref ?? null)
  },
  onCommand: (listener: (command: unknown) => void): void => {
    commandListener = typeof listener === 'function' ? listener : null
  },
  agents: {
    list: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LIST),
    connect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_CONNECT, { id }),
    disconnect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_DISCONNECT, { id }),
    setShown: (id: string, shown: boolean): Promise<unknown> => agentInvoke(OPENFILM_AGENT_SET_SHOWN, { id, shown }),
    onChange: (listener: (agents: unknown[]) => void): (() => void) => {
      if (typeof listener === 'function') agentListeners.add(listener)
      return () => { agentListeners.delete(listener) }
    },
  },
  // 花费前提问由主进程按官方 approve 口径自动放行(阶段 1), Studio 的 asks 卡暂不挂。
  asks: { show: (): void => {} },
})

// ── openfilmNative(官方 shell 页 bridge.ts 的后端;缺它页面加载即崩)──────────
// 全部成员就位:agents 走阶段 2 的注册表 IPC;localAgents 的会话协议在阶段 3b 接
// FilmAgentManager,当前占位(聊天可见,发起会话提示未接入);chat/skills 日志存取
// 占位为空;capture 经主进程对 Studio 视图截帧。
const nativeInvoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)
const noopStop = (): (() => void) => () => {}
const pendingProxy = new Proxy({}, {
  get: () => (): Promise<Record<string, never>> => Promise.resolve({}),
}) as Record<string, (...args: never[]) => Promise<Record<string, never>>>

contextBridge.exposeInMainWorld('openfilmNative', {
  platform: 'win32',
  async hello() {
    return {
      flavor: 'tintin',
      version: '0.2.1-rc.1',
      ffmpeg: {},
      update: null,
      chatOpen: true,
      chatWidth: 420,
      chatMin: 340,
      studioMin: 640,
      fullScreen: false,
    }
  },
  pathForFile: (file: File): string => {
    /* File 对象不能过 IPC:Electron 的 webUtils 在 preload 内直接解析磁盘路径 */
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  revealPath: (path: string): Promise<void> => nativeInvoke('openfilm:native:reveal-path', { path }).then(() => undefined),
  pickFolder: (options?: { title?: string; defaultPath?: string }): Promise<string | null> =>
    nativeInvoke('openfilm:native:pick-folder', options ?? {}).then((r) => (typeof r === 'string' ? r : null)),
  capture: (rect: { x: number; y: number; width: number; height: number }): Promise<string | null> =>
    nativeInvoke('openfilm:native:capture', rect).then((r) => (typeof r === 'string' ? r : null)),
  agents: {
    list: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LIST),
    connect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_CONNECT, { id }),
    disconnect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_DISCONNECT, { id }),
    setShown: (id: string, shown: boolean): Promise<unknown> => agentInvoke(OPENFILM_AGENT_SET_SHOWN, { id, shown }),
    onChange: (listener: (agents: unknown[]) => void): (() => void) => {
      if (typeof listener === 'function') agentListeners.add(listener)
      return () => { agentListeners.delete(listener) }
    },
  },
  tabs: {
    list: async () => ({ self: null, tabs: [] }),
    onChange: () => noopStop(),
    show: () => {},
    close: () => {},
    open: () => {},
    move: () => {},
    report: () => {},
    openRequest: () => {},
    onPick: () => noopStop(),
  },
  /* 阶段 3b:localAgents 各方法经 openfilm:agent:local 直通主进程 FilmAgentManager
     (start/prompt/steer/审批/提问/事件流);事件经 openfilm:agent:local-event 回流。 */
  localAgents: {
    list: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'list' }),
    disconnect: (agent: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'disconnect', agent }),
    signIn: async (agent: string): Promise<{ ok: false; error: string }> =>
      ({ ok: false, error: `${agent} 无需登录:模型由 TinTin 服务端提供` }),
    probe: (agent: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'probe', agent }),
    start: (agent: string, cwd: string, resume?: string | null, meta?: unknown): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'start', agent, cwd, resume, meta }),
    prompt: (key: string, text: string, meta?: unknown, images?: unknown[]): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'prompt', key, text, meta, images }),
    running: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'running' }),
    ack: (key: string, turnId: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'ack', key, turnId }),
    steer: (key: string, text: string, images?: unknown[]): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'steer', key, text, images }),
    adopt: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    cancel: (key: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'cancel', key }),
    setOption: (key: string, configId: string, value: unknown): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'setOption', key, configId, value }),
    answerPermission: (key: string, requestId: string, optionId: string | null): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'answerPermission', key, requestId, optionId }),
    answerQuestion: (key: string, requestId: string, answers: unknown): Promise<unknown> =>
      agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'answerQuestion', key, requestId, answers }),
    close: (key: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'close', key }),
    onEvent: (cb: (event: unknown) => void): (() => void) => {
      const listener = (_event: unknown, event: unknown): void => { try { cb(event) } catch { /* 聊天侧渲染错误不杀通道 */ } }
      ipcRenderer.on(OPENFILM_AGENT_LOCAL_EVENT, listener)
      return () => { ipcRenderer.removeListener(OPENFILM_AGENT_LOCAL_EVENT, listener) }
    },
  },
  /* 聊天的持久化(desktop:chat:*, 形状见官方 AppBridge.chat): 每影片 .film/chat.json + refs/attachments 落盘。 */
  chat: {
    load: (project: string): Promise<unknown> => ipcRenderer.invoke('desktop:chat:load', { project }),
    saveSessions: (project: string, sessions: unknown[], last: string | null): Promise<unknown> =>
      ipcRenderer.invoke('desktop:chat:sessions', { project, sessions, last }),
    saveTurn: (project: string, turn: unknown, items: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke('desktop:chat:turn', { project, turn, items }),
    log: (project: string, turnId: string, unless?: { size: number; callsSize: number }): Promise<unknown> =>
      ipcRenderer.invoke('desktop:chat:log', { project, turnId, unless }),
    reveal: (project: string, turnId?: string): Promise<unknown> => ipcRenderer.invoke('desktop:chat:reveal', { project, turnId }),
    saveRefImage: (project: string, turnId: string, n: number, bytes: ArrayBuffer): Promise<unknown> =>
      ipcRenderer.invoke('desktop:chat:ref-image', { project, turnId, n, bytes }),
    saveAttachment: (project: string, name: string, bytes: ArrayBuffer): Promise<unknown> =>
      ipcRenderer.invoke('desktop:chat:attachment', { project, name, bytes }),
    describePaths: (paths: string[]): Promise<unknown> => ipcRenderer.invoke('desktop:chat:paths', { paths }),
    unsaved: (project: string, except?: string[]): Promise<unknown> => ipcRenderer.invoke('desktop:chat:unsaved', { project, except }),
    snapshot: (project: string, turnId: string): Promise<unknown> => ipcRenderer.invoke('desktop:chat:snapshot', { project, turnId }),
    changes: (project: string, turnId: string): Promise<unknown> => ipcRenderer.invoke('desktop:chat:changes', { project, turnId }),
  },
  skills: pendingProxy,
  prefs: {
    get: async () => ({ developer: false, changes: true }),
    set: async () => ({}),
    onChange: () => noopStop(),
  },
  saveLayout: () => {},
  setTheme: () => {},
  setLanguage: () => {},
  onFullScreen: () => noopStop(),
  onToggleChat: () => noopStop(),
  onOpenSettings: () => noopStop(),
  onStudioBrowser: () => noopStop(),
  onFfmpeg: () => noopStop(),
  onUpdate: () => noopStop(),
  restartToUpdate: async () => ({ ok: false, error: 'TinTin 桌面的更新走自身通道' }),
  updateState: async () => ({ status: 'off', version: '', channel: 'stable', availableVersion: null, progress: 0, checkedAt: null, error: null }),
  checkForUpdate: async () => null,
})
