// Browser UI page preload (tintin channel-only). Serves BOTH the embedded
// browser view and the standalone browser window — the page (build/
// tintin-browser.html) consumes window.dshDesktopBrowser + window.tintinBrowserPage.
//
// A sandboxed preload can only require('electron')/builtins — a relative-chunk
// import ("module not found") kills the whole preload (2026-10-19 studio-preload
// incident). Channel names below are LOCAL LITERALS kept in sync with
// dsh-tintin-browser/src/browser/browser-service.ts (main-process side).
import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload)

/** Subscribe to a main→page event channel; returns an unsubscribe. */
function on(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: unknown, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => { ipcRenderer.removeListener(channel, wrapped) }
}

const BROWSER_PAGE_BOUNDS = 'tintin-browser-page:bounds'
const BROWSER_PAGE_OPEN = 'tintin-browser-page:open'
const BROWSER_PAGE_ACTION = 'tintin-browser-page:action'
const BROWSER_PAGE_STATE = 'tintin-browser-page:state'
const EXTENSIONS_CHANGED = 'browser:extensions-changed'
const DOWNLOAD_PROGRESS = 'downloads:progress'
const DOWNLOAD_DONE = 'downloads:done'
const DOWNLOAD_ERROR = 'downloads:error'
const HOTSPOT_PROGRESS = 'browser:hotspot-progress'
const AUTO_LISTING_PROGRESS = 'autoListing:onProgress'
const CREATORS_PROGRESS = 'creators:collect-progress'

const desktopBrowser = {
  // 平台/登录态/开窗（独立窗口路径仍由主进程 browser:open 承载；位置参数=平台 id）
  platforms: () => invoke('browser:platforms'),
  loginStatus: () => invoke('browser:loginStatus'),
  open: (platform: string) => invoke('browser:open', String(platform || '')),
  extractDOM: (payload: unknown) => invoke('browser:extractDOM', payload),
  exportCookies: (payload?: unknown) => invoke('browser:exportCookies', payload),
  // 每日素材/热榜/嗅探/下载
  getDailyAssets: () => invoke('browser:getDailyAssets'),
  revealDailyAsset: (payload: unknown) => invoke('browser:revealDailyAsset', payload),
  openDailyAsset: (payload: unknown) => invoke('browser:openDailyAsset', payload),
  captureHotspots: (payload?: unknown) => invoke('browser:captureHotspots', payload),
  sniffList: (payload?: unknown) => invoke('browser:sniffList', payload),
  sniffClear: (payload?: unknown) => invoke('browser:sniffClear', payload),
  sniffDownload: (payload: unknown) => invoke('browser:sniffDownload', payload),
  // 扩展管理
  extensionList: () => invoke('browser:extensionList'),
  extensionInstall: (payload: unknown) => invoke('browser:extensionInstall', payload),
  extensionUninstall: (payload: unknown) => invoke('browser:extensionUninstall', payload),
  onExtensionsChanged: (listener: (payload: unknown) => void) => on(EXTENSIONS_CHANGED, listener),
  // 自动上架（抖店工作台）
  autoListingListRuns: (payload?: unknown) => invoke('autoListing:listRuns', payload),
  autoListingValidate: (payload: unknown) => invoke('autoListing:validate', payload),
  autoListingStart: (payload: unknown) => invoke('autoListing:start', payload),
  autoListingStop: (payload: unknown) => invoke('autoListing:stop', payload),
  autoListingResume: (payload: unknown) => invoke('autoListing:resume', payload),
  autoListingStatus: (payload?: unknown) => invoke('autoListing:status', payload),
  autoListingOpenResultDir: (payload: unknown) => invoke('autoListing:openResultDir', payload),
  onAutoListingProgress: (listener: (payload: unknown) => void) => on(AUTO_LISTING_PROGRESS, listener),
  // 达人采集
  creatorsGetCreators: (payload?: unknown) => invoke('creators:getCreators', payload),
  creatorsAddCreator: (payload: unknown) => invoke('creators:addCreator', payload),
  creatorsDeleteCreator: (payload: unknown) => invoke('creators:deleteCreator', payload),
  creatorsGetCollected: (payload: unknown) => invoke('creators:getCollected', payload),
  creatorsCollectFromCreator: (payload: unknown) => invoke('creators:collectFromCreator', payload),
  onCreatorsProgress: (listener: (payload: unknown) => void) => on(CREATORS_PROGRESS, listener),
  // 素材库（下载/嗅探记录/收藏）
  mediaStorageGetDownloads: (payload?: unknown) => invoke('media:storageGetDownloads', payload),
  mediaStorageGetSniffed: (payload?: unknown) => invoke('media:storageGetSniffed', payload),
  mediaStorageClearHistory: (payload: unknown) => invoke('media:storageClearHistory', payload),
  mediaStorageGetFavorites: (payload?: unknown) => invoke('media:storageGetFavorites', payload),
  mediaStorageAddFavorite: (payload: unknown) => invoke('media:storageAddFavorite', payload),
  mediaStorageRemoveFavorite: (payload: unknown) => invoke('media:storageRemoveFavorite', payload),
  // 下载进度事件（页面下载栏）
  onDownloadEvent: (listeners: { progress?: (payload: unknown) => void; done?: (payload: unknown) => void; error?: (payload: unknown) => void }) => {
    const offs = [
      listeners.progress ? on(DOWNLOAD_PROGRESS, listeners.progress) : null,
      listeners.done ? on(DOWNLOAD_DONE, listeners.done) : null,
      listeners.error ? on(DOWNLOAD_ERROR, listeners.error) : null,
    ].filter((v): v is () => void => v !== null)
    return () => { for (const off of offs) off() }
  },
  onHotspotProgress: (listener: (payload: unknown) => void) => on(HOTSPOT_PROGRESS, listener),
}

const tintinBrowserPage = {
  /** 页面宿主矩形上报（内嵌时=UI 视图内坐标；主进程合成外层偏移） */
  bounds: (rect: unknown) => invoke(BROWSER_PAGE_BOUNDS, rect),
  /** 平台切换（主进程 ensure 视图+导航） */
  open: (payload: { platform: string }) => invoke(BROWSER_PAGE_OPEN, payload),
  /** 工具条动作（back/forward/reload/stop/home/go/server） */
  action: (payload: unknown) => invoke(BROWSER_PAGE_ACTION, payload),
  /** 主进程导航态推送 */
  onState: (listener: (payload: unknown) => void) => on(BROWSER_PAGE_STATE, listener),
}

contextBridge.exposeInMainWorld('dshDesktopBrowser', desktopBrowser)
contextBridge.exposeInMainWorld('tintinBrowserPage', tintinBrowserPage)
