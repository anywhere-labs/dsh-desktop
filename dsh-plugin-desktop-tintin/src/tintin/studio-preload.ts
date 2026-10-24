// Preload for the native OpenFilm Studio view (第三行形态, 2026-10-23 用户裁决).
// 所伺服的页面是 TinTin shell 构建(官方 Studio 编辑器 + 官方聊天, 同一页):
//   · shell 页自己的 bridge.ts 组装 `window.openfilmHost`(StudioHost 全契约)与
//     `window.openfilmDesktop`(聊天桥)—— 本 preload 不再暴露迷你 openfilmHost:
//     双 host 会让 Studio 的选中上报走进旧通道, 官方聊天永远收不到(实测)。
//   · 本 preload 只提供 `window.openfilmNative`(页面做不了的系统面): agents 注册表
//     (Settings → Agents), localAgents 会话协议(FilmAgentManager), 影片聊天持久化
//     (desktop:chat:*), 技能清单, 截帧/文件夹/路径。
// 降级: 若伺服的是无 shell 的旧 editor(探测见 main-hook has-shell), 页面以浏览器
// 模式运行, 过渡版聊天列保留 —— 功能减但可用。
import { contextBridge, ipcRenderer, webUtils } from 'electron'
// A sandboxed preload can only require('electron')/builtins — keep these
// literals in sync with ../openfilm-view-contract.ts (main-process side).
const OPENFILM_AGENT_LIST = 'dsh-desktop:openfilm-agent-list'
const OPENFILM_AGENT_CONNECT = 'dsh-desktop:openfilm-agent-connect'
const OPENFILM_AGENT_DISCONNECT = 'dsh-desktop:openfilm-agent-disconnect'
const OPENFILM_AGENT_SET_SHOWN = 'dsh-desktop:openfilm-agent-set-shown'
const OPENFILM_AGENT_CHANGED = 'dsh-desktop:openfilm-agent-changed'
const OPENFILM_AGENT_LOCAL = 'openfilm:agent:local'
const OPENFILM_AGENT_LOCAL_EVENT = 'openfilm:agent:local-event'

const agentInvoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)
const nativeInvoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)

// Settings → Agents: Studio re-reads the list whenever the main process says it changed.
const agentListeners = new Set<(agents: unknown[]) => void>()
ipcRenderer.on(OPENFILM_AGENT_CHANGED, (_event, agents: unknown[]) => {
  for (const listener of agentListeners) {
    try { listener(Array.isArray(agents) ? agents : []) } catch { /* a Studio-side listener error must not kill the channel */ }
  }
})

const agentRegistry = {
  list: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LIST),
  connect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_CONNECT, { id }),
  disconnect: (id: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_DISCONNECT, { id }),
  setShown: (id: string, shown: boolean): Promise<unknown> => agentInvoke(OPENFILM_AGENT_SET_SHOWN, { id, shown }),
  saveOwnModel: async (): Promise<{ ok: false; error: string }> =>
    ({ ok: false, error: 'TinTin: 模型由服务端提供, 无需自备 key' }),
  removeOwnModel: async (): Promise<{ ok: true }> => ({ ok: true }),
  mcp: async (): Promise<{ filtered: boolean; servers: unknown[] }> => ({ filtered: false, servers: [] }),
  allowMcp: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  skills: async (): Promise<{ filtered: boolean; skills: unknown[] }> => ({ filtered: false, skills: [] }),
  allowSkill: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  onChange: (listener: (agents: unknown[]) => void): (() => void) => {
    if (typeof listener === 'function') agentListeners.add(listener)
    return () => { agentListeners.delete(listener) }
  },
}

const localAgents = {
  list: (): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'list' }),
  disconnect: (agent: string): Promise<unknown> => agentInvoke(OPENFILM_AGENT_LOCAL, { op: 'disconnect', agent }),
  signIn: async (agent: string): Promise<{ ok: false; error: string }> =>
    ({ ok: false, error: `${agent} 无需登录: 模型由 TinTin 服务端提供` }),
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
}

const chat = {
  load: (project: string): Promise<unknown> => nativeInvoke('desktop:chat:load', { project }),
  saveSessions: (project: string, sessions: unknown[], last: string | null): Promise<unknown> =>
    nativeInvoke('desktop:chat:sessions', { project, sessions, last }),
  saveTurn: (project: string, turn: unknown, items: unknown[]): Promise<unknown> =>
    nativeInvoke('desktop:chat:turn', { project, turn, items }),
  log: (project: string, turnId: string, unless?: { size: number; callsSize: number }): Promise<unknown> =>
    nativeInvoke('desktop:chat:log', { project, turnId, unless }),
  reveal: (project: string, turnId?: string): Promise<unknown> => nativeInvoke('desktop:chat:reveal', { project, turnId }),
  saveRefImage: (project: string, turnId: string, n: number, bytes: ArrayBuffer): Promise<unknown> =>
    nativeInvoke('desktop:chat:ref-image', { project, turnId, n, bytes }),
  saveAttachment: (project: string, name: string, bytes: ArrayBuffer): Promise<unknown> =>
    nativeInvoke('desktop:chat:attachment', { project, name, bytes }),
  describePaths: (paths: string[]): Promise<unknown> => nativeInvoke('desktop:chat:paths', { paths }),
  unsaved: (project: string, except?: string[]): Promise<unknown> => nativeInvoke('desktop:chat:unsaved', { project, except }),
  snapshot: (project: string, turnId: string): Promise<unknown> => nativeInvoke('desktop:chat:snapshot', { project, turnId }),
  changes: (project: string, turnId: string): Promise<unknown> => nativeInvoke('desktop:chat:changes', { project, turnId }),
}

const skills = {
  list: (project: string, agent: string): Promise<unknown> => nativeInvoke('openfilm:native:skills-list', { project, agent }),
  texts: (project: string, agent: string, names: string[]): Promise<unknown> =>
    nativeInvoke('openfilm:native:skills-texts', { project, agent, names }),
  allow: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  changed: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  preview: async (): Promise<{ ok: false; error: string }> => ({ ok: false, error: '暂不支持从地址安装技能' }),
  previewFolder: async (): Promise<{ ok: false; cancelled: boolean }> => ({ ok: false, cancelled: true }),
  commit: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  discard: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  reveal: (): Promise<unknown> => nativeInvoke('openfilm:native:skills-reveal'),
}

const noopStop = (): (() => void) => () => {}

contextBridge.exposeInMainWorld('openfilmNative', {
  platform: 'win32',
  /* 影片目录: shell 桥的 follow() 按目录匹配 Studio 项目(嵌入页不走 /projects 路由) */
  tintinFilmDir: async (): Promise<string> => {
    try {
      const r = await ipcRenderer.invoke('openfilm:currentProject', {})
      return typeof (r as { project?: unknown } | null)?.project === 'string' ? (r as { project: string }).project : ''
    } catch { return '' }
  },
  /* 在线素材库(2026-10-24 用户要求): 主进程代理服务端 /material/*, 页面无 CORS 问题 */
  library: {
    list: (query: unknown): Promise<unknown> => agentInvoke('openfilm:library:list', query),
    download: (payload: unknown): Promise<unknown> => agentInvoke('openfilm:library:download', payload),
  },
  agents: agentRegistry,
  localAgents,
  chat,
  skills,
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
    /* File 对象不能过 IPC: Electron 的 webUtils 在 preload 内直接解析磁盘路径 */
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  revealPath: (path: string): Promise<void> => nativeInvoke('openfilm:native:reveal-path', { path }).then(() => undefined),
  pickFolder: (options?: { title?: string; defaultPath?: string }): Promise<string | null> =>
    nativeInvoke('openfilm:native:pick-folder', options ?? {}).then((r) => (typeof r === 'string' ? r : null)),
  capture: (rect: { x: number; y: number; width: number; height: number }): Promise<string | null> =>
    nativeInvoke('openfilm:native:capture', rect).then((r) => (typeof r === 'string' ? r : null)),
  prefs: {
    get: (): Promise<unknown> => nativeInvoke('desktop:prefs'),
    set: (next: unknown): Promise<unknown> => nativeInvoke('desktop:prefs:set', next),
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
