// TinTin channel main-process capabilities (channel-only addition; see
// docs/tintin-migration-plan.md Phase 4). The mirrored desktop bootstrap files
// stay byte-identical to Beta, so every TinTin-specific main-process behavior
// installs itself from here, before the mirrored bootstrap runs.

import { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, type WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FilmAgentManager, dshBinExists } from './film-acp.ts'
import { filmChat, keepSnapshot, settleSnapshot } from './film-chat.ts'
import { resolveDesktopChannelHome } from '../desktop-channel-home.ts'
import { DESKTOP_PRODUCT_IDENTITY } from '../product-identity.ts'
import { embedAttach, embedClose, embedHide, embedShow, registerBrowserService } from 'dsh-tintin-browser'
import {
  OPENFILM_AGENT_CHANGED, OPENFILM_AGENT_CONNECT, OPENFILM_AGENT_DISCONNECT, OPENFILM_AGENT_LIST, OPENFILM_AGENT_SET_SHOWN,
  OPENFILM_COMMAND_EVENT, OPENFILM_HOST_HOVER, OPENFILM_HOST_REFER, OPENFILM_HOST_SELECTION, OPENFILM_REFER_EVENT, OPENFILM_SELECTION_EVENT,
  OPENFILM_VIEW_CHANNEL, isOpenFilmBounds, isOpenFilmStudioUrl,
  type OpenFilmBounds, type OpenFilmSelection, type OpenFilmStudioRef, type OpenFilmViewRequest,
} from '../openfilm-view-contract.ts'
import { BROWSER_VIEW_CHANNEL, isBrowserBounds, type BrowserViewRequest } from '../browser-view-contract.ts'
import { DESKTOP_FRAME_HEIGHT } from '../window-chrome.ts'
import { seedTinTinDefaults } from './first-boot.ts'

let installed = false
let browserAttached = false

/**
 * 页面坐标 → 窗口坐标的 y 偏移（2026-10-20 实机报障：内嵌 Studio 视图底部露出一条
 * 恰好等于标题条高的空隙）。兼容/扩展壳把主页面 WebContentsView 放在窗口
 * `y = DESKTOP_FRAME_HEIGHT` 处，页面里的 rect 是页面坐标——原生视图 bounds 必须
 * 加回这个偏移，否则视图整体上移一条高、窗口底部露出同高的一条。advanced 模式
 * 页面铺满窗口内容区，偏移为 0。
 */
const pageOffsetY = (window: BrowserWindow, sender: WebContents): number =>
  sender === window.webContents ? 0 : DESKTOP_FRAME_HEIGHT

/**
 * Install TinTin main-process capabilities. Safe to call more than once.
 *
 * - First-boot provisioning: seed the tintin-server model provider, default
 *   model, placeholder credential and the bridge's own config store into the
 *   channel home before the Host boots (ported from the source first-boot;
 *   without it a fresh install defaults to the official DeepSeek provider).
 * - Media binaries: point the host bridge at `<resources>/bin`
 *   (ffmpeg/ffprobe/yt-dlp delivered by the fetch scripts) when packaged.
 * - Browser domain: attach to the first top-level window the desktop
 *   bootstrap creates — the harness main window. Later windows (native-ui
 *   modals, dialogs, recovery chrome) are ignored, matching the source
 *   wiring where registerBrowserService received the main window only.
 */
const STUDIO_PARTITION = 'persist:tintin-openfilm-studio'
const studioPreloadPath = join(dirname(fileURLToPath(import.meta.url)), 'studio-preload.cjs')

let studioView: WebContentsView | null = null
let studioWindow: BrowserWindow | null = null
let studioShown = false
let studioBounds = ''
// bounds 去重（2026-10-21 报障：播放条抖动）——重复 setBounds 会迫使合成器不断
// 重排原生视图，干扰 Studio 播放；值不变时直接跳过。
const boundsKey = (bounds: OpenFilmBounds): string =>
  `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`

/** Create (or reuse) the native Studio view in the window that hosts the chat. */
function ensureStudioView(window: BrowserWindow, url: string): WebContentsView {
  if (studioView !== null && !studioView.webContents.isDestroyed()) return studioView
  studioWindow = window
  const view = new WebContentsView({
    webPreferences: {
      preload: studioPreloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: STUDIO_PARTITION,
    },
  })
  view.setBackgroundColor('#0b0c0f')
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.error(`dsh-plugin-desktop-tintin: Studio failed to load ${failedUrl} (${String(code)} ${description})`)
  })
  view.webContents.on('destroyed', () => {
    if (studioView === view) {
      studioView = null
      studioWindow = null
      studioShown = false
    }
  })
  studioView = view
  void view.webContents.loadURL(url)
  // 键盘焦点交给 Studio（2026-10-19 报障：焦点留主窗侧栏行按钮时，视图内按空格被
  // 主窗按 HTML 语义当成「再点一次行」→ 切回工作台）。仅打开时让一次，show 轮询不抢焦
  view.webContents.once('did-finish-load', () => {
    try { if (!view.webContents.isDestroyed()) view.webContents.focus() } catch { /* 销毁竞态 */ }
  })
  return view
}

function showStudio(bounds: OpenFilmBounds): void {
  if (studioView === null || studioWindow === null || studioWindow.isDestroyed()) return
  const key = boundsKey(bounds)
  if (studioShown && key === studioBounds) return
  if (!studioShown) {
    studioWindow.contentView.addChildView(studioView)
    studioShown = true
  }
  studioBounds = key
  studioView.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  })
}

function hideStudio(): void {
  if (studioView === null || studioWindow === null || studioWindow.isDestroyed() || !studioShown) return
  studioWindow.contentView.removeChildView(studioView)
  studioShown = false
  studioBounds = ''
}

function closeStudio(): void {
  const view = studioView
  if (view === null) return
  hideStudio()
  studioView = null
  studioWindow = null
  studioShown = false
  studioBounds = ''
  if (!view.webContents.isDestroyed()) view.webContents.close()
}

export function installTinTinMainHook(): void {
  if (installed) return
  installed = true

  seedTinTinDefaults(app.getPath('appData'))

  if (process.env.TINTIN_BIN_DIR === undefined && app.isPackaged) {
    const binDir = join(process.resourcesPath, 'bin')
    if (existsSync(binDir)) {
      process.env.TINTIN_BIN_DIR = binDir
      // OpenFilm runtime (2026-10-17): the vendored node.exe/openfilm.cmd sit
      // beside ffmpeg in bin/ — append (never prepend: system tools keep
      // precedence, the vendored set fills machines without them) so the
      // agent's shell and every child process resolve `openfilm` bare.
      if (process.platform === 'win32' && process.env.PATH !== undefined) {
        process.env.PATH = `${process.env.PATH};${binDir}`
      }
      const browsersDir = join(process.resourcesPath, 'playwright-browsers')
      if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(browsersDir)) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir
      }
    }
  }

  app.on('browser-window-created', (_event, window) => {
    if (browserAttached) return
    if (window.getParentWindow() !== null) return
    browserAttached = true
    try {
      // browser-page-preload（2026-10-19）：浏览器 UI 页（内嵌视图与独立窗口共用）的
      // 页面桥（dshDesktopBrowser/tintinBrowserPage）由此接通——构建产物与本文件同目录
      registerBrowserService(window, {
        pagePreloadPath: join(dirname(fileURLToPath(import.meta.url)), 'browser-page-preload.cjs'),
      })
    } catch (error) {
      console.error(
        `dsh-plugin-desktop-tintin: browser domain registration failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      browserAttached = false
    }
  })

  // Native OpenFilm Studio view (B 方案, 2026-10-18 用户裁决): the Studio page runs
  // in a WebContentsView with a preload that supplies Studio's host contract
  // (`window.openfilmHost`); its selection/playhead and "Reference in chat" refs
  // are forwarded to the chat renderer that drives this view.
  ipcMain.handle(OPENFILM_VIEW_CHANNEL, (event, request: OpenFilmViewRequest) => {
    if (request === null || typeof request !== 'object') return { ok: false, error: 'invalid request' }
    if (request.action === 'open') {
      if (!isOpenFilmStudioUrl(request.url)) return { ok: false, error: 'refused: not a local Studio address' }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window === null) return { ok: false, error: 'window not found' }
      ensureStudioView(window, request.url)
      return { ok: true }
    }
    if (request.action === 'show') {
      if (!isOpenFilmBounds(request.bounds)) return { ok: false, error: 'invalid bounds' }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window === null) return { ok: false, error: 'window not found' }
      const offsetY = pageOffsetY(window, event.sender)
      showStudio({
        x: request.bounds.x,
        y: request.bounds.y + offsetY,
        width: request.bounds.width,
        height: request.bounds.height,
      })
      return { ok: true }
    }
    if (request.action === 'hide') { hideStudio(); return { ok: true } }
    if (request.action === 'close') { closeStudio(); return { ok: true } }
    if (request.action === 'focus') {
      // 空格 = 播放/暂停（2026-10-21 报障：非输入焦点下按空格走浏览器页面滚动，
      // 页面滚动拖动 stage rect 造成原生视图来回抖动）——把键盘焦点交给 Studio。
      if (studioView !== null && studioWindow !== null && !studioWindow.isDestroyed()) {
        studioView.webContents.focus()
      }
      return { ok: true }
    }
    if (request.action === 'has-shell') {
      // 所伺服的编辑器页是否为 TinTin shell 构建(Studio + 官方聊天): 决定影片视图
      // 是否让位给页内聊天列(无 shell 构建时保留过渡版聊天列)。探测失败时带回
      // 页面诊断(readyState/桥/聊天列), 由聊天状态行显示 —— 不静默。
      if (studioView === null || studioView.webContents.isDestroyed()) return { ok: false, error: 'Studio 视图未开启' }
      return studioView.webContents.executeJavaScript(`(() => {
        try {
          return {
            readyState: document.readyState,
            hasDesktop: Boolean(window.openfilmDesktop),
            hasHost: Boolean(window.openfilmHost),
            hasChatColumn: Boolean(document.getElementById('of-chat')),
            hasRoot: Boolean(document.getElementById('root')),
          }
        } catch (error) { return { error: String(error) } }
      })()`, true).then((diag) => {
        const d = (diag ?? {}) as { readyState?: string; hasDesktop?: boolean; hasHost?: boolean; hasChatColumn?: boolean; hasRoot?: boolean; error?: string }
        const has = d.hasDesktop === true && d.hasChatColumn === true
        return { ok: true, has, diag: d }
      }, (error) => ({ ok: true, has: false, diag: { error: error instanceof Error ? error.message : String(error) } }))
    }
    return { ok: false, error: 'unknown action' }
  })
  ipcMain.on(OPENFILM_HOST_SELECTION, (event, selection: OpenFilmSelection) => {
    if (studioView !== null && event.sender === studioView.webContents) {
      studioWindow?.webContents.send(OPENFILM_SELECTION_EVENT, selection)
    }
  })
  ipcMain.on(OPENFILM_HOST_REFER, (event, ref: OpenFilmStudioRef) => {
    if (studioView !== null && event.sender === studioView.webContents) {
      studioWindow?.webContents.send(OPENFILM_REFER_EVENT, ref)
    }
  })
  // Studio → chat: what the pointer hovers (the chat lights its matching pills)
  ipcMain.on(OPENFILM_HOST_HOVER, (event, ref: OpenFilmStudioRef | null) => {
    if (studioView !== null && event.sender === studioView.webContents) {
      studioWindow?.webContents.send(OPENFILM_HOST_HOVER, ref ?? null)
    }
  })
  // Chat → Studio: a StudioCommand from the chat (StudioHost.onCommand contract)
  ipcMain.on(OPENFILM_COMMAND_EVENT, (event, command: unknown) => {
    if (studioView !== null && studioWindow !== null && event.sender === studioWindow.webContents) {
      studioView.webContents.send(OPENFILM_COMMAND_EVENT, command)
    }
  })

  // ── 影片智能体 ACP 桥(第三行形态, 2026-10-23 用户裁决):dsh --profile acp ──
  // 每部影片一个子进程, 模型路由到服务端(补丁生成见 film-acp.ts); 语义更新推回
  // 发起方渲染层, 审批按官方 approve 口径自动放行。
  let filmAgentManager: FilmAgentManager | null = null
  let filmSender: WebContents | null = null
  const channelHome = (): string =>
    resolveDesktopChannelHome({ identity: DESKTOP_PRODUCT_IDENTITY, environment: process.env, homeDirectory: homedir() }).homeDir
  const filmAgent = (): FilmAgentManager => {
    if (filmAgentManager === null) {
      const home = channelHome()
      filmAgentManager = new FilmAgentManager({
        channelHome: home,
        serverUrl: () => {
          try {
            const raw = JSON.parse(readFileSync(join(home, 'tintin', 'config.json'), 'utf8')) as { server?: { url?: unknown } }
            return typeof raw.server?.url === 'string' && raw.server.url.length > 0 ? raw.server.url : ''
          } catch { return '' }
        },
        onEvent: (update) => {
          try { filmSender?.send('openfilm:agent:local-event', update) } catch { /* 发起方已关闭 */ }
        },
        log: (message) => console.info(`[tintin-film-acp] ${message}`),
      })
    }
    return filmAgentManager
  }
  ipcMain.handle('openfilm:agent:local', async (event, payload: unknown) => {
    filmSender = event.sender
    const p = (payload ?? {}) as Record<string, unknown>
    const op = String(p.op ?? '')
    const manager = filmAgent()
    try {
      switch (op) {
        case 'list': return [manager.listState()]
        case 'start': {
          const cwd = String(p.cwd ?? '')
          if (!cwd) return { ok: false, error: 'cwd 必填' }
          const resume = typeof p.resume === 'string' && p.resume ? p.resume : null
          manager.trackTurn(cwd, p.meta)
          const info = await manager.begin(cwd)
          void resume /* begin 内部已按历史 sessionId resume */
          return { ok: true, key: cwd, info }
        }
        case 'prompt': {
          const key = String(p.key ?? '')
          const text = String(p.text ?? '')
          if (!key || !text) return { ok: false, error: 'key 与 text 必填' }
          const images = Array.isArray(p.images) ? p.images as Array<{ data: string; mimeType: string }> : undefined
          const result = await manager.prompt(key, text, p.meta as { turnId?: string } | undefined, images)
          return { ok: true, ...result }
        }
        case 'running': return manager.runningTurns()
        case 'ack': { manager.ackTurn(String(p.key ?? '')); return { ok: true } }
        case 'steer': {
          const key = String(p.key ?? '')
          const text = String(p.text ?? '')
          return manager.steer(key, text, Array.isArray(p.images) ? p.images as Array<{ data: string; mimeType: string }> : undefined)
        }
        case 'cancel': return manager.cancel(String(p.key ?? ''))
        case 'answerPermission': return manager.answerPermission(String(p.key ?? ''), String(p.requestId ?? ''), typeof p.optionId === 'string' ? p.optionId : null)
        case 'answerQuestion': return manager.answerQuestion(String(p.key ?? ''), String(p.requestId ?? ''), (p.answers ?? null) as Record<string, { label?: string; text?: string }> | null)
        case 'setOption': return manager.setOption(String(p.key ?? ''), String(p.configId ?? ''), p.value)
        case 'close': manager.stop(String(p.key ?? '')); return { ok: true }
        case 'disconnect': manager.dispose(); return { ok: true }
        case 'probe': {
          const tmp = join(channelHome(), 'film-agent-home', 'probe')
          mkdirSync(tmp, { recursive: true })
          const info = await manager.begin(tmp)
          manager.stop(tmp)
          return { ok: true, info }
        }
        default: return { ok: false, error: `未知操作 ${op}` }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Settings → Agents(deepseek-only, 阶段 2):注册表来自宿主, dsh CLI 在即 ready。
  let filmAgentsShown = true
  const filmAgentRow = () => ({
    id: 'deepseek',
    name: 'DeepSeek Harness',
    shown: filmAgentsShown,
    status: dshBinExists() ? 'ready' : 'missing',
    install: 'https://github.com/deepseek-ai/deepseek-harness',
  })
  const notifyFilmAgents = (): void => {
    try { studioView?.webContents.send(OPENFILM_AGENT_CHANGED, [filmAgentRow()]) } catch { /* 视图未开 */ }
  }
  ipcMain.handle(OPENFILM_AGENT_LIST, () => [filmAgentRow()])
  ipcMain.handle(OPENFILM_AGENT_CONNECT, () => {
    const ok = dshBinExists()
    if (ok) notifyFilmAgents()
    return { ok }
  })
  ipcMain.handle(OPENFILM_AGENT_DISCONNECT, () => { notifyFilmAgents(); return { ok: true } })
  ipcMain.handle(OPENFILM_AGENT_SET_SHOWN, (_event, payload: unknown) => {
    filmAgentsShown = (payload as { shown?: unknown } | null)?.shown !== false
    notifyFilmAgents()
    return { ok: true }
  })

  // ── openfilmNative.skills(官方聊天的技能面): openfilm 包自带技能 + 服务端技能 ──
  const tinServerUrl = (): string => {
    try {
      const raw = JSON.parse(readFileSync(join(channelHome(), 'tintin', 'config.json'), 'utf8')) as { server?: { url?: unknown } }
      return typeof raw.server?.url === 'string' && raw.server.url ? raw.server.url.replace(/\/+$/, '') : ''
    } catch { return '' }
  }
  const openfilmSkillsDir = (): string | null => {
    if (process.env.TINTIN_BIN_DIR) {
      const packaged = join(dirname(process.env.TINTIN_BIN_DIR), 'openfilm', 'node_modules', 'openfilm', 'skills')
      if (existsSync(packaged)) return packaged
    }
    const dev = resolve(dirname(fileURLToPath(import.meta.url)), '../../tintin-resources/openfilm/node_modules/openfilm/skills')
    return existsSync(dev) ? dev : null
  }
  ipcMain.handle('openfilm:native:skills-list', async (_event, payload: unknown) => {
    const q = (payload ?? {}) as { project?: unknown; agent?: unknown }
    void q
    const dir = openfilmSkillsDir()
    const openfilm: Array<Record<string, unknown>> = []
    if (dir !== null) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const folder = join(dir, entry.name)
        const skillMd = join(folder, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        let description = ''
        try {
          const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(skillMd, 'utf8'))?.[1] ?? ''
          description = /^description:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? ''
        } catch { /* 无 frontmatter: 空描述 */ }
        let scripts: string[] = []
        try {
          const manifest = JSON.parse(readFileSync(join(folder, 'openfilm.json'), 'utf8')) as { scripts?: unknown }
          if (Array.isArray(manifest.scripts)) scripts = manifest.scripts.map(String)
        } catch { /* 无清单: 空脚本 */ }
        openfilm.push({ name: entry.name, description, source: 'official', folder, scripts })
      }
    }
    /* 服务端技能(2026-10-23 用户要求: 技能之外还有服务端的技能)——并入 openfilm 清单,
       聊天的 @ 技能组即可引用服务端技能; 不可达时静默(只少服务端一组)。 */
    try {
      const serverUrl = tinServerUrl()
      if (serverUrl) {
        const res = await fetch(serverUrl + '/skills')
        const body = await res.json() as { data?: { skills?: Array<{ name?: unknown; description?: unknown }> } }
        for (const s of body.data?.skills ?? []) {
          const name = String(s.name ?? '')
          if (!name || openfilm.some((row) => String(row.name ?? '') === name)) continue
          openfilm.push({ name, description: String(s.description ?? ''), source: 'official', folder: '', scripts: [] })
        }
      }
    } catch { /* 服务端不可达: 只返回本地清单 */ }
    return { openfilm, own: { agent: String((payload as { agent?: unknown } | null)?.agent ?? ''), filtered: false, skills: [] }, mine: process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : '' }
  })
  ipcMain.handle('openfilm:native:skills-texts', async (_event, payload: unknown) => {
    const q = (payload ?? {}) as { project?: unknown; agent?: unknown; names?: unknown }
    const dir = openfilmSkillsDir()
    const texts: Array<{ name: string; text: string }> = []
    if (dir !== null) {
      for (const name of (Array.isArray(q.names) ? q.names : []).map(String)) {
        try { texts.push({ name, text: readFileSync(join(dir, name, 'SKILL.md'), 'utf8') }) } catch { /* 缺文件: 跳过 */ }
      }
    }
    return texts
  })
  ipcMain.handle('openfilm:native:skills-reveal', () => {
    const dir = openfilmSkillsDir()
    if (dir !== null) shell.showItemInFolder(dir)
    return { ok: dir !== null }
  })

  // ── 影片聊天的持久化(desktop:chat:*, 官方 chat-ipc.mjs 的存储语义, 见 film-chat.ts)──
  const chatProject = (payload: unknown): string => {
    const path = String((payload as { project?: unknown } | null)?.project ?? '')
    if (!path || !existsSync(path)) throw new Error('影片目录不存在')
    return path
  }
  const bytesOf = (value: unknown): ArrayBuffer => value as ArrayBuffer
  ipcMain.handle('desktop:chat:load', (_e, p: unknown) => filmChat.load(chatProject(p)))
  ipcMain.handle('desktop:chat:sessions', (_e, p: unknown) => {
    const q = p as { project?: unknown; sessions?: unknown[]; last?: unknown }
    filmChat.saveSessions(chatProject(p), Array.isArray(q.sessions) ? q.sessions : [], typeof q.last === 'string' ? q.last : null)
    return { ok: true }
  })
  ipcMain.handle('desktop:chat:turn', (_e, p: unknown) => {
    const q = p as { project?: unknown; turn?: Record<string, unknown>; items?: unknown[] }
    filmChat.saveTurn(chatProject(p), q.turn ?? {}, Array.isArray(q.items) ? q.items : [])
    return { ok: true }
  })
  ipcMain.handle('desktop:chat:ref-image', (_e, p: unknown) => {
    const q = p as { project?: unknown; turnId?: string; n?: number; bytes?: ArrayBuffer }
    return filmChat.saveRefImage(chatProject(p), String(q.turnId ?? ''), Number(q.n ?? 0), bytesOf(q.bytes))
  })
  ipcMain.handle('desktop:chat:attachment', (_e, p: unknown) => {
    const q = p as { project?: unknown; name?: string; bytes?: ArrayBuffer }
    return filmChat.saveAttachment(chatProject(p), String(q.name ?? 'file'), bytesOf(q.bytes))
  })
  ipcMain.handle('desktop:chat:paths', (_e, p: unknown) => filmChat.describePaths((p as { paths?: string[] } | null)?.paths ?? []))
  ipcMain.handle('desktop:chat:unsaved', (_e, p: unknown) => {
    const q = (p ?? {}) as { project?: unknown; except?: unknown }
    return filmChat.unsavedTurns(chatProject(p), Array.isArray(q.except) ? q.except.map(String) : [])
  })
  ipcMain.handle('desktop:chat:log', (_e, p: unknown) => {
    const q = (p ?? {}) as { project?: unknown; turnId?: unknown }
    return filmChat.log(chatProject(p), String(q.turnId ?? ''))
  })
  ipcMain.handle('desktop:chat:snapshot', (_e, p: unknown) => {
    const q = p as { project?: unknown; turnId?: string }
    keepSnapshot(String(q.turnId ?? ''), chatProject(p))
    return { ok: true }
  })
  ipcMain.handle('desktop:chat:changes', (_e, p: unknown) => {
    const q = p as { project?: unknown; turnId?: string }
    return settleSnapshot(String(q.turnId ?? ''), chatProject(p))
  })
  ipcMain.handle('desktop:chat:reveal', (_event, payload: unknown) => {
    const project = chatProject(payload)
    const turnId = String((payload as { turnId?: unknown } | null)?.turnId ?? '')
    shell.showItemInFolder(join(project, '.film'))
    void turnId
    return { ok: true }
  })
  ipcMain.handle('desktop:prefs', async () => {
    const home = channelHome()
    try {
      const raw = JSON.parse(readFileSync(join(home, 'preferences.json'), 'utf8')) as { developer?: boolean; changes?: boolean }
      return { developer: raw.developer === true, changes: raw.changes !== false }
    } catch { return { developer: false, changes: true } }
  })
  ipcMain.handle('desktop:prefs:set', async (_event, next: unknown) => {
    const home = channelHome()
    const q = (next ?? {}) as { developer?: unknown; changes?: unknown }
    let prefs = { developer: false, changes: true }
    try {
      const raw = JSON.parse(readFileSync(join(home, 'preferences.json'), 'utf8')) as { developer?: boolean; changes?: boolean }
      prefs = { developer: raw.developer === true, changes: raw.changes !== false }
    } catch { /* 首次写入 */ }
    if (typeof q.developer === 'boolean') prefs.developer = q.developer
    if (typeof q.changes === 'boolean') prefs.changes = q.changes
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'preferences.json'), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8')
    return prefs
  })

  // ── openfilmNative 的文件/截帧面(shell 页 bridge.ts 的后端, 见 film-acp.ts 头注)──
  ipcMain.handle('openfilm:native:reveal-path', (_event, payload: unknown) => {
    const path = String((payload as { path?: unknown } | null)?.path ?? '')
    if (path) shell.showItemInFolder(path)
    return { ok: true }
  })
  ipcMain.handle('openfilm:native:pick-folder', async (event, payload: unknown) => {
    const options = (payload ?? {}) as { title?: string; defaultPath?: string }
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('openfilm:native:capture', async (_event, payload: unknown) => {
    const rect = (payload ?? {}) as { x?: number; y?: number; width?: number; height?: number }
    if (studioView === null || studioView.webContents.isDestroyed()) return null
    const image = await studioView.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x ?? 0)),
      y: Math.max(0, Math.round(rect.y ?? 0)),
      width: Math.max(1, Math.round(rect.width ?? 1)),
      height: Math.max(1, Math.round(rect.height ?? 1)),
    })
    return image.toJPEG(85).toString('base64')
  })

  // Embedded browser view (2026-10-19 方案 4, OpenFilm native-view pattern): the chrome
  // hosts a placeholder and drives the browser UI view lifecycle; platform partition
  // views compose on top inside the page-reported host rect (browser-service embed mode).
  ipcMain.handle(BROWSER_VIEW_CHANNEL, (event, request: BrowserViewRequest) => {
    if (request === null || typeof request !== 'object') return { ok: false, error: 'invalid request' }
    if (request.action === 'open') {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window === null) return { ok: false, error: 'window not found' }
      return embedAttach(window)
    }
    if (request.action === 'show') {
      if (!isBrowserBounds(request.bounds)) return { ok: false, error: 'invalid bounds' }
      const window = BrowserWindow.fromWebContents(event.sender)
      // 同一偏移问题：浏览器内嵌视图的 host rect 也是页面坐标（2026-10-20 与 Studio 同修）
      const offsetY = window === null ? 0 : pageOffsetY(window, event.sender)
      return embedShow({
        x: request.bounds.x,
        y: request.bounds.y + offsetY,
        width: request.bounds.width,
        height: request.bounds.height,
      })
    }
    if (request.action === 'hide') { embedHide(); return { ok: true } }
    if (request.action === 'close') { embedClose(); return { ok: true } }
    return { ok: false, error: 'unknown action' }
  })
}

// Install on module load so the composition entry only needs to import this
// module before the mirrored bootstrap; ESM evaluation order then guarantees
// the listeners exist before any window is created.
installTinTinMainHook()
