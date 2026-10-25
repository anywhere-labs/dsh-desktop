// TinTin channel main-process capabilities (channel-only addition; see
// docs/tintin-migration-plan.md Phase 4). The mirrored desktop bootstrap files
// stay byte-identical to Beta, so every TinTin-specific main-process behavior
// installs itself from here, before the mirrored bootstrap runs.

import { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FilmAgentManager, dshBinExists } from './film-acp.ts'
import { filmChat, keepSnapshot, settleSnapshot } from './film-chat.ts'
import { resolveDesktopChannelHome } from '../desktop-channel-home.ts'
import { DESKTOP_PRODUCT_IDENTITY, DESKTOP_PRODUCT_NAME } from '../product-identity.ts'
import { diagnosticLog } from '../developer-logging.ts'

// 铁律 3(关键失败路径必须打点): 主进程未捕获异常走统一日志管道(diagnosticLog →
// 滚动的 logs\dsh-*.log), 不另起炉灶私有落盘 —— Explorer 启动时 stderr 会丢失,
// 上一次"程序崩溃"查无证据的教训(2026-10-24)。
const reportMainError = (kind: string, error: unknown): void => {
  diagnosticLog({
    source: 'tintin-main', event: kind, level: 'error', developer: false,
    error: error instanceof Error ? error : String(error),
    fields: { stack: error instanceof Error ? (error.stack ?? '') : String(error) },
  })
}
process.on('uncaughtException', (error) => { reportMainError('uncaughtException', error) })
process.on('unhandledRejection', (reason) => { reportMainError('unhandledRejection', reason) })

// 开机对账: 上次异常退出(failLoud 不走 will-quit)留下的 openfilm node 孤儿清场 ——
// 只按可执行文件路径甄别(必须是 openfilm\bin\node.exe), 不碰其它任何 node 进程。
void execFile(
  'powershell.exe',
  ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -like '*\\openfilm\\bin\\node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
  { windowsHide: true, timeout: 30_000 },
  () => {},
)

// TinTin 品牌(通道专属): 窗口标题固定为产品名 —— 上游页面把 <title> 写成
// "DSH Desktop", 每个窗口创建时拦截标题更新, 保持 "TinTin"(2026-10-23 用户要求)。
app.on('browser-window-created', (_event, window) => {
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    if (window.getTitle() !== DESKTOP_PRODUCT_NAME) window.setTitle(DESKTOP_PRODUCT_NAME)
  })
})
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
// 陈旧服务重启改时间窗(2026-10-23:布尔一次性让「点击这里重试」失效,失败锁死;
// 60s 内只重启一次防循环,超窗后允许再次对账)。
const FILM_SHELL_RESTART_WINDOW_MS = 60_000
let filmShellRestartedAt = 0
/** 官方聊天「从未就绪 → 就绪」的转变标记: 重绘推进只在转变时执行一次(不再反复摘挂)。 */
let filmShellWasReady = false

/** TinTin 通道 home(影片智能体的 run.json/补丁/偏好都挂在它下面)。 */
const channelHome = (): string =>
  resolveDesktopChannelHome({ identity: DESKTOP_PRODUCT_IDENTITY, environment: process.env, homeDirectory: homedir() }).homeDir

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
/** 最近一次设置的视图边界(重绘推进用; 页面加载完成后再推一次). */
let studioLastRect: { x: number; y: number; width: number; height: number } | null = null
// 视图自愈(2026-10-23 报障:探测窗口内服务重启,首开吃 did-fail-load 后视图停在错误
// 页,后续 open 全部命中复用分支 → 探测永远失败):记住已加载 URL 与失败态,目标变了
// 或上次失败时强制重载,而不是复用死页面。
let studioLoadedUrl = ''
let studioLoadFailed = false
// bounds 去重（2026-10-21 报障：播放条抖动）——重复 setBounds 会迫使合成器不断
// 重排原生视图，干扰 Studio 播放；值不变时直接跳过。
const boundsKey = (bounds: OpenFilmBounds): string =>
  `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`

/** Create (or reuse) the native Studio view in the window that hosts the chat.
 *  复用仅限「同一地址且上次加载成功」;否则就地重载(2026-10-23 自愈缺口修复)。 */
function ensureStudioView(window: BrowserWindow, url: string): WebContentsView {
  if (studioView !== null && !studioView.webContents.isDestroyed()) {
    if (studioLoadedUrl === url && !studioLoadFailed) return studioView
    studioLoadedUrl = url
    studioLoadFailed = false
    void studioView.webContents.loadURL(url).catch(() => { studioLoadFailed = true })
    return studioView
  }
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
  /* 视频剪辑页的 console 进统一日志管道(diagnosticLog): Studio 的开发模式在页内
     可看, 主进程侧同步留档, 与主窗口渲染层日志同文件同格式。 */
  view.webContents.on('console-message', (...args: unknown[]) => {
    const details = args[1] as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown } | number | undefined
    const read = typeof details === 'object' && details !== null
      ? { level: Number(details.level ?? 2), message: String(details.message ?? ''), line: Number(details.lineNumber ?? 0), sourceId: String(details.sourceId ?? '') }
      : { level: Number(details ?? 2), message: String(args[2] ?? ''), line: Number(args[3] ?? 0), sourceId: String(args[4] ?? '') }
    diagnosticLog({
      source: 'studio-renderer', event: 'console', level: read.level >= 3 ? 'error' : 'info', developer: false,
      fields: { message: read.message.slice(0, 2000), sourceId: read.sourceId, line: read.line },
    })
  })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    studioLoadFailed = true
    console.error(`dsh-plugin-desktop-tintin: Studio failed to load ${failedUrl} (${String(code)} ${description})`)
  })
  view.webContents.on('did-finish-load', () => {
    studioLoadFailed = false
    studioLoadedUrl = url
  })
  view.webContents.on('destroyed', () => {
    if (studioView === view) {
      studioView = null
      studioWindow = null
      studioShown = false
      studioLoadedUrl = ''
      studioLoadFailed = false
    }
  })
  studioView = view
  studioLoadedUrl = url
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
  const rect = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
  studioView.setBounds(rect)
  studioLastRect = rect
  /* 重绘推进只在「从未就绪 → 就绪」转变时做一次(见 has-shell); show 本身不再反复
     摘挂/微调 —— 那会让画面在每次边界同步时抖动(2026-10-24 报障)。 */
}

/** 边界往返 + 视图重挂载: 触发 WebContentsView 的合成器重绘(黑屏的确定性修复).
    窗口还原/切换视图之所以有效, 是因为它们改变了窗口的视图树; 这里摘挂一次子视图
    等价于那次变化, 且比 1px 微调更可靠。 */
function nudgeRepaint(rect: { x: number; y: number; width: number; height: number }): void {
  const view = studioView
  if (view === null || view.webContents.isDestroyed()) return
  const bump = { ...rect, width: Math.max(1, rect.width + 16) }
  setTimeout(() => {
    if (studioView !== view || view.webContents.isDestroyed() || !studioShown || studioWindow === null || studioWindow.isDestroyed()) return
    /* ① 视图树变化(摘挂) — 等价于用户切换视图/还原窗口 */
    try {
      studioWindow.contentView.removeChildView(view)
      studioWindow.contentView.addChildView(view)
    } catch { /* 窗口已销毁: 无需重绘 */ }
    /* ② 边界微调再还原 */
    view.setBounds(bump)
    setTimeout(() => {
      if (studioView !== view || view.webContents.isDestroyed() || !studioShown) return
      view.setBounds(rect)
    }, 60)
  }, 60)
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
      // 是否让位给页内聊天列。探测失败且不在重启窗口内 → 旧 Studio 服务进程伺服旧
      // editor, 结束它(客户端下一轮 open 会以当前资源重启); 时间窗内不重复, 防循环。
      if (studioView === null || studioView.webContents.isDestroyed()) return { ok: false, error: 'Studio 视图未开启' }
      const restartIfStale = (request as { restartIfStale?: unknown }).restartIfStale === true
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
      })()`, true).then(async (raw) => {
        const d = (raw ?? {}) as { readyState?: string; hasDesktop?: boolean; hasHost?: boolean; hasChatColumn?: boolean; hasRoot?: boolean; error?: string }
        const has = d.hasDesktop === true && d.hasChatColumn === true
        /* 绘制屏障(2026-10-24 用户裁决的加载架构): 视图是独立表面, 页面里的遮罩盖不住它;
           必须在**显示视图之前**证明页面已经画出过一帧 —— 在页面内跑双 rAF, 帧排进页面
           合成器后返回; 客户端据此才 show 视图(遮罩保持到 show 之后), 避免遮罩撤了而首帧
           还没画的黑屏窗口期。 */
        let painted = false
        const probeView = studioView
        if (has && probeView !== null && !probeView.webContents.isDestroyed()) {
          try {
            painted = (await probeView.webContents.executeJavaScript(
              'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
              true,
            )) === true
          } catch { painted = false }
        }
        /* 接管确认(从未就绪 → 就绪的转变, 一次性)后延迟推一次重绘;
           常驻探测(日志条 4s 轮询)命中时**不再**摘挂/微调 —— 那会让画面持续抖动
           (2026-10-24 报障: 已加载完成还反复抖)。 */
        const shellBecameReady = has && painted && !filmShellWasReady
        filmShellWasReady = has && painted
        if (shellBecameReady && studioLastRect !== null) setTimeout(() => { if (studioLastRect !== null) nudgeRepaint(studioLastRect) }, 200)
        const restartWindowOpen = Date.now() - filmShellRestartedAt < FILM_SHELL_RESTART_WINDOW_MS
        if (has || !restartIfStale || restartWindowOpen) return { ok: true, has, painted, diag: d, restarted: false }
        filmShellRestartedAt = Date.now()
        try {
          /* 只清除陈旧 run.json, 不按 pid 裸杀 —— pid 可能已被系统复用给任何进程
             (2026-10-24 实测: 裸杀复用 pid 直接崩掉主程序)。陈旧服务的清场由
             startStudio 附着前的指纹对账(reconcileStudioInstance)安全处理;
             run.json 清掉后, 下一轮 open 必然全新拉起。 */
          rmSync(join(channelHome(), 'openfilm-studio', 'run.json'), { force: true })
        } catch { /* 无 run.json: 无需处理 */ }
        return { ok: true, has, diag: d, restarted: true }
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
  /* 退出即净场(2026-10-23 用户要求): will-quit 管正常退出, process 'exit' 管
     failLoud 类崩溃路径(不走 will-quit, 2026-10-24 1142 目录删不掉的事故)。
     句柄全部同步(kill/rmSync), 'exit' 阶段也能跑完; 幂等防重复。 */
  let studioTornDown = false
  const teardownStudioSync = (): void => {
    if (studioTornDown) return
    studioTornDown = true
    try { filmAgentManager?.dispose() } catch { /* 已退出 */ }
    try {
      const runPath = join(channelHome(), 'openfilm-studio', 'run.json')
      const run = JSON.parse(readFileSync(runPath, 'utf8')) as { pid?: unknown }
      /* pid 来自我们自己几分钟前写入的 run.json, 复用风险趋零; 仍要求正数且存在才杀 */
      if (typeof run.pid === 'number' && run.pid > 0) {
        try { process.kill(run.pid, 0) } catch { throw new Error('stale') }
        process.kill(run.pid)
      }
      rmSync(runPath, { force: true })
    } catch { /* 无 run.json 或进程已不在: 无需收场 */ }
  }
  app.on('will-quit', teardownStudioSync)
  process.on('exit', teardownStudioSync)
  // ── 在线素材库(2026-10-24 用户要求): 主进程代理服务端 /material/*, 供 shell 页抽屉 ──
  ipcMain.handle('openfilm:library:list', async (_event, payload: unknown) => {
    const q = (payload ?? {}) as { page?: unknown; size?: unknown; mediaType?: unknown; search?: unknown }
    const serverUrl = tinServerUrl()
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      const url = new URL(serverUrl + '/material/list')
      url.searchParams.set('page', String(Number(q.page) || 1))
      url.searchParams.set('size', String(Number(q.size) || 24))
      if (typeof q.mediaType === 'string' && q.mediaType) url.searchParams.set('media_type', q.mediaType)
      if (typeof q.search === 'string' && q.search.trim()) url.searchParams.set('search', q.search.trim())
      const res = await fetch(url)
      /* 实测(2026-10-24 铁律 14): /material/list 返回顶层 items, 不包 data */
      const body = await res.json() as { items?: unknown[]; data?: { items?: unknown[] } }
      const items = Array.isArray(body.items) ? body.items : Array.isArray(body.data?.items) ? body.data.items : []
      return { serverUrl, items }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('openfilm:library:download', async (_event, payload: unknown) => {
    const p = (payload ?? {}) as { project?: unknown; materialId?: unknown; filename?: unknown; serverUrl?: unknown; target?: unknown }
    const target: 'project' | 'downloads' = p.target === 'downloads' ? 'downloads' : 'project'
    let project = typeof p.project === 'string' && p.project ? p.project.replace(/[\\/]+$/, '') : ''
    const id = String(p.materialId ?? '')
    const filename = String(p.filename ?? `material-${id}`)
    /* 页面拿不到影片目录时, 主进程自己从 studio.json 解析(2026-10-24 报障: 页面侧
       openfilm:currentProject 偶发为空 → 下载直接失败且磁盘无文件)。 */
    if (target === 'project' && !project) {
      try {
        const raw = JSON.parse(readFileSync(join(channelHome(), 'openfilm-studio', 'studio.json'), 'utf8')) as { recent?: Array<{ path?: unknown }> }
        const first = raw.recent?.[0]?.path
        if (typeof first === 'string' && first) {
          project = first.replace(/[\\/]+$/, '')
          diagnosticLog({ source: 'tintin-main', event: 'library-download-project-fallback', level: 'info', developer: false, fields: { project } })
        }
      } catch { /* 无 studio.json: 下面的参数校验报错 */ }
    }
    if (!id || (target === 'project' && !project)) {
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'error', developer: false, fields: { reason: '参数缺失', id, project } })
      return { error: '参数缺失(项目/素材 id)' }
    }
    const serverUrl = typeof p.serverUrl === 'string' && p.serverUrl ? p.serverUrl.replace(/\/+$/, '') : tinServerUrl()
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      const res = await fetch(serverUrl + '/material/serve?material_id=' + encodeURIComponent(id))
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const dir = target === 'downloads' ? app.getPath('downloads') : join(project, 'assets', 'download')
      mkdirSync(dir, { recursive: true })
      const safe = filename.replace(/[/:*?"<>|]/g, '-').slice(0, 100) || `material-${id}`
      const file = join(dir, safe)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'info', developer: false, fields: { ok: true, file, target } })
      return target === 'downloads' ? { ok: true, path: file } : { ok: true, rel: 'assets/download/' + safe }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnosticLog({ source: 'tintin-main', event: 'library-download', level: 'error', developer: false, fields: { ok: false, error: message, id, project } })
      return { error: message }
    }
  })
  // ── 产品库选择(2026-10-24 用户要求): 仿视频流程的选择产品移植 — 代理 /api/product-library/* ──
  ipcMain.handle('openfilm:products', async (_event, payload: unknown) => {
    const p = (payload ?? {}) as { op?: unknown; q?: unknown; limit?: unknown; id?: unknown; project?: unknown }
    const serverUrl = tinServerUrl()
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      if (p.op === 'search') {
        const url = new URL(serverUrl + '/api/product-library/search')
        url.searchParams.set('q', String(p.q ?? ''))
        url.searchParams.set('limit', String(Number(p.limit) || 50))
        const res = await fetch(url)
        return await res.json()
      }
      if (p.op === 'detail') {
        const id = encodeURIComponent(String(p.id ?? ''))
        const res = await fetch(serverUrl + '/api/product-library/items/' + id)
        return await res.json()
      }
      /* 六视图随选下载(2026-10-25 用户要求): 产品的六视图图片落项目 assets/download,
         左侧媒体面板可见 → @ 文件引用; 视图值形状未定, 字符串/对象均兼容。 */
      if (p.op === 'views') {
        const id = encodeURIComponent(String(p.id ?? ''))
        const project = String(p.project ?? '').replace(/[\\/]+$/, '')
        if (!id || !project) return { error: '参数缺失(项目/产品 id)' }
        const detail = await (await fetch(serverUrl + '/api/product-library/items/' + id)).json() as {
          item?: { six_views?: Record<string, unknown> }
        }
        const views = detail.item?.six_views ?? {}
        const dir = join(project, 'assets', 'download')
        mkdirSync(dir, { recursive: true })
        const files: string[] = []
        for (const [view, value] of Object.entries(views)) {
          const url = typeof value === 'string' && value
            ? (value.startsWith('/') ? serverUrl + value : value)
            : (value && typeof value === 'object' && 'url' in (value as Record<string, unknown>) ? String((value as Record<string, unknown>).url ?? '') : '')
          if (!url) continue
          try {
            const res = await fetch(url.startsWith('/') ? serverUrl + url : url)
            if (!res.ok) continue
            const type = res.headers.get('content-type') ?? ''
            const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
            const safe = `${id}_${view}`.replace(/[^\w-]/gu, '-')
            writeFileSync(join(dir, safe + ext), Buffer.from(await res.arrayBuffer()))
            files.push(safe + ext)
          } catch { /* 单视图失败不阻断其余视图 */ }
        }
        return { ok: true, files }
      }
      return { error: '未知操作' }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
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
        log: (message) => {
          /* 统一日志管道(2026-10-25 可观测性): 影片智能体的每个管理器事件都落盘 */
          try { diagnosticLog({ source: 'film-acp', event: 'log', level: 'info', developer: false, fields: { message: String(message).slice(0, 2000) } }) } catch { /* 日志失败不阻断 */ }
          console.info(`[tintin-film-acp] ${message}`)
        },
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
    if (process.resourcesPath) {
      const packaged = join(process.resourcesPath, 'skills', 'openfilm')
      if (existsSync(packaged)) return packaged
    }
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
        openfilm.push({ name: entry.name, description, source: 'native', folder, scripts })
      }
    }
    /* 服务端技能(2026-10-23 用户要求: 技能之外还有服务端的技能)——并入 openfilm 清单,
       聊天的 @ 技能组即可引用服务端技能; 不可达时静默(只少服务端一组)。 */
    try {
      const serverUrl = tinServerUrl()
      if (serverUrl) {
        const res = await fetch(serverUrl + '/skills')
        /* 实测(2026-10-24 铁律 14): /skills 返回顶层 skills: [{id,name,description,instruction}] */
        const body = await res.json() as { skills?: Array<{ name?: unknown; description?: unknown }>; data?: { skills?: Array<{ name?: unknown; description?: unknown }> } }
        const serverSkills = Array.isArray(body.skills) ? body.skills : Array.isArray(body.data?.skills) ? body.data.skills : []
        for (const s of serverSkills) {
          const name = String(s.name ?? '')
          if (!name || openfilm.some((row) => String(row.name ?? '') === name)) continue
          openfilm.push({ name, description: String(s.description ?? ''), source: 'server', folder: '', scripts: [] })
        }
      }
    } catch { /* 服务端不可达: 只返回本地清单 */ }
    /* Studio 官方技能目录(2026-10-25 报障): /api/skills = 项目的+个人的+官方的
       (视频复刻等官方技能在这里) —— 在 Studio 页内 fetch(自带鉴权 cookie), 主进程汇总。 */
    try {
      const view = studioView
      if (view !== null && !view.webContents.isDestroyed()) {
        const raw = await view.webContents.executeJavaScript(
          'fetch("/api/skills?project=").then((r) => r.json())', true,
        ) as { skills?: Array<{ name?: unknown; description?: unknown; source?: unknown }> }
        for (const s of raw.skills ?? []) {
          const name = String(s.name ?? '')
          if (!name || openfilm.some((row) => String(row.name ?? '') === name)) continue
          openfilm.push({ name, description: String(s.description ?? ''), source: String(s.source ?? 'official'), folder: '', scripts: [] })
        }
      }
    } catch { /* Studio 页不可用: 已有其余来源 */ }
    /* 铁律 3: 技能清单的关键失败路径打点(聊天侧 / 与 @ 菜单的可见性取决于本返回值) */
    diagnosticLog({
      source: 'tintin-main', event: 'skills-list', level: 'info', developer: false,
      fields: { native: openfilm.filter((row) => row.source === 'native').length, server: openfilm.filter((row) => row.source === 'server').length, total: openfilm.length },
    })
    return { openfilm, own: { agent: String((payload as { agent?: unknown } | null)?.agent ?? ''), filtered: false, skills: [] }, mine: process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : '' }
  })
  /* 服务端技能安装(2026-10-24 交互规范 §9): 写进影片智能体 home, 智能体即可用 */
  ipcMain.handle('openfilm:skills:install', async (_event, payload: unknown) => {
    const name = String((payload as { name?: unknown } | null)?.name ?? '')
    const serverUrl = tinServerUrl()
    if (!name) return { error: '缺少技能名' }
    if (!serverUrl) return { error: '服务端未配置' }
    try {
      const res = await fetch(serverUrl + '/skills')
      const body = await res.json() as { skills?: Array<{ name?: unknown; instruction?: unknown }> }
      const skill = (body.skills ?? []).find((s) => String(s.name ?? '') === name)
      const instruction = String(skill?.instruction ?? '')
      if (!instruction) return { error: `服务端未返回「${name}」的正文` }
      const target = join(channelHome(), 'film-agent-home', 'skills', name.replace(/[/:*?"<>|]/g, '-'))
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'SKILL.md'), instruction)
      /* 安装即广播官方的技能变更事件(2026-10-24 用户问的"自动引用"): 聊天清单自动刷新,
         新装的技能立刻可引用, 无需重进视频剪辑。 */
      try { await studioView?.webContents.executeJavaScript("window.dispatchEvent(new Event('openfilm:skills-changed'))", true) } catch { /* 页面不在: 下次挂载自然刷新 */ }
      return { ok: true, path: target }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('openfilm:native:skills-texts', async (_event, payload: unknown) => {
    const q = (payload ?? {}) as { project?: unknown; agent?: unknown; names?: unknown }
    const dir = openfilmSkillsDir()
    const texts: Array<{ name: string; text: string }> = []
    const wanted = (Array.isArray(q.names) ? q.names : []).map(String)
    if (dir !== null) {
      for (const name of wanted) {
        try { texts.push({ name, text: readFileSync(join(dir, name, 'SKILL.md'), 'utf8') }) } catch { /* 缺文件: 跳过 */ }
      }
    }
    /* 服务端技能的正文注入(2026-10-24): /skills 响应自带 instruction 字段(实测),
       本地缺 SKILL.md 的名字从这里补 —— 技能引用的上下文注入必须带全文。 */
    const missing = wanted.filter((name) => !texts.some((t) => t.name === name))
    if (missing.length) {
      try {
        const serverUrl = tinServerUrl()
        if (serverUrl) {
          const res = await fetch(serverUrl + '/skills')
          const body = await res.json() as { skills?: Array<{ name?: unknown; instruction?: unknown }> }
          for (const s of body.skills ?? []) {
            const name = String(s.name ?? '')
            const instruction = String(s.instruction ?? '')
            if (!name || !instruction || !missing.includes(name)) continue
            texts.push({ name, text: instruction })
          }
        }
      } catch { /* 服务端不可达: 已尽力 */ }
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
