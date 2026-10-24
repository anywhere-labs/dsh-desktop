/**
 * 在线素材库抽屉(2026-10-24 用户要求: 过渡版退役后在 shell 页内重建在线素材操作)。
 * 数据经 openfilmNative.library(主进程代理服务端, 无 CORS 问题); 点击 = 下载落项目
 * assets/download, 落地后即出现在 Studio 媒体面板, 走官方交互(拖入时间线/@ 引用)。
 */
import { bootFail } from './boot';
import { registerAssetsDrawer, closeAssetsDrawer } from './bridge';

type LibraryItem = { material_id?: unknown; id?: unknown; filename?: unknown; name?: unknown; size?: unknown };

const STYLE = [
  '.tintin-lib-fab{position:fixed;left:8px;bottom:52px;z-index:2147483000;background:#16171a;border:1px solid #3b6fd4;color:#cfe0ff;font:12px system-ui;padding:5px 10px;border-radius:8px;cursor:pointer}',
  '.tintin-lib-drawer{position:fixed;top:0;right:0;bottom:0;width:380px;z-index:2147483001;background:#101114;border-left:1px solid #26272b;display:flex;flex-direction:column;font:13px/1.5 system-ui;color:#e2e2e6}',
  '.tintin-lib-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c1d21}',
  '.tintin-lib-title{flex:1;font-weight:700;font-size:14px}',
  '.tintin-lib-close{background:none;border:0;color:#9a9aa0;font-size:16px;cursor:pointer}',
  '.tintin-lib-search{margin:10px 12px;background:#16171a;border:1px solid #26272b;border-radius:8px;color:#e8e8e6;font:12px system-ui;padding:6px 10px;outline:none}',
  '.tintin-lib-list{flex:1;min-height:0;overflow:auto;padding:0 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-lib-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26272b;border-radius:9px;background:#16171a}',
  '.tintin-lib-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
  '.tintin-lib-size{color:#77787e;font-size:10px;flex:none}',
  '.tintin-lib-dl{border:1px solid #3b6fd4;background:#20304d;color:#cfe0ff;font-size:11px;padding:3px 8px;border-radius:7px;cursor:pointer;flex:none}',
  '.tintin-lib-more{margin:10px 12px 14px;border:1px solid #26272b;background:#16171a;color:#c9c9cf;font-size:12px;padding:6px;border-radius:8px;cursor:pointer}',
  '.tintin-lib-status{padding:6px 12px 12px;color:#8a8a90;font-size:11px;min-height:18px;white-space:pre-wrap}',
].join('\n');

const mount = (): void => {
  try {
    const native = (window as unknown as { openfilmNative?: { library?: { list: (q: unknown) => Promise<{ items?: LibraryItem[]; serverUrl?: string; error?: string }>; download: (p: unknown) => Promise<{ ok?: boolean; rel?: string; error?: string }> }; tintinFilmDir?: () => Promise<string> } }).openfilmNative;
    const filmDirBridge = (window as unknown as { tintinFilmDir?: () => Promise<string> }).tintinFilmDir;
    if (typeof native?.library?.list !== 'function' || typeof filmDirBridge !== 'function') return; // 非本形态页面: 不挂

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const fab = document.createElement('button');
    fab.className = 'tintin-lib-fab';
    fab.textContent = '⇩ 在线素材';
    document.body.append(fab);

    const drawer = document.createElement('div');
    drawer.className = 'tintin-lib-drawer';
    drawer.style.display = 'none';
    const head = document.createElement('div'); head.className = 'tintin-lib-head';
    const title = document.createElement('div'); title.className = 'tintin-lib-title'; title.textContent = '在线素材库';
    const close = document.createElement('button'); close.className = 'tintin-lib-close'; close.textContent = '×'; close.title = '关闭';
    head.append(title, close);
    const search = document.createElement('input'); search.className = 'tintin-lib-search'; search.placeholder = '搜索素材库…';
    const list = document.createElement('div'); list.className = 'tintin-lib-list';
    const more = document.createElement('button'); more.className = 'tintin-lib-more'; more.textContent = '加载更多'; more.style.display = 'none';
    const status = document.createElement('div'); status.className = 'tintin-lib-status';
    drawer.append(head, search, list, more, status);
    document.body.append(drawer);

    let page = 1;
    let serverUrl = '';
    let exhausted = false;
    let busy = false;

    const fmtSize = (bytes: unknown): string => {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '';
      const units = ['B', 'KB', 'MB', 'GB']; let v = n; let u = 0;
      while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1 }
      return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
    };
    const idOf = (item: LibraryItem): string => String(item.material_id ?? item.id ?? '');
    const nameOf = (item: LibraryItem): string => String(item.filename || item.name || `material-${idOf(item)}`);

    const open = (): void => {
      drawer.style.display = 'flex';
      if (!list.childElementCount && !busy) void load(false);
    };
    const hide = (): void => { drawer.style.display = 'none' };
    fab.onclick = open;
    close.onclick = () => { hide(); closeAssetsDrawer() };
    /* 聊天列的素材按钮经桥开合本抽屉(2026-10-24 用户裁决: 抽屉 = 在线素材) */
    registerAssetsDrawer((openState) => { if (openState) open(); else hide() });

    async function load(reset: boolean): Promise<void> {
      if (busy) return;
      busy = true;
      status.textContent = reset ? '加载中…' : '加载更多…';
      try {
        const result = await native.library.list({ page: reset ? 1 : page, size: 24, search: search.value.trim() });
        if (result.error) throw new Error(result.error);
        serverUrl = result.serverUrl ?? serverUrl;
        const items = result.items ?? [];
        if (reset) { list.replaceChildren(); page = 1 }
        exhausted = items.length < 24;
        if (reset && !items.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:8px 2px';
          empty.textContent = '没有匹配的在线素材。';
          list.append(empty);
        }
        for (const item of items) {
          const row = document.createElement('div'); row.className = 'tintin-lib-row';
          const name = document.createElement('div'); name.className = 'tintin-lib-name'; name.textContent = nameOf(item); name.title = nameOf(item);
          const size = document.createElement('span'); size.className = 'tintin-lib-size'; size.textContent = fmtSize(item.size);
          const dl = document.createElement('button'); dl.className = 'tintin-lib-dl'; dl.textContent = '下载到项目';
          dl.onclick = () => {
            void (async () => {
              dl.textContent = '下载中…';
              try {
                let project = '';
                try { project = await filmDirBridge() } catch { project = '' }
                const out = await native.library.download({ project, materialId: idOf(item), filename: nameOf(item), serverUrl });
                if (out.error) throw new Error(out.error);
                status.textContent = `已下载到项目 ${out.rel ?? ''}（Studio 媒体面板可见，可拖入时间线）`;
              } catch (error) {
                status.textContent = `下载失败：${error instanceof Error ? error.message : String(error)}`;
              } finally {
                dl.textContent = '下载到项目';
              }
            })();
          };
          row.append(name, size, dl);
          list.append(row);
        }
        page += 1;
        more.style.display = exhausted ? 'none' : 'block';
        status.textContent = '';
      } catch (error) {
        status.textContent = `加载失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        busy = false;
      }
    }
    more.onclick = () => { void load(false) };
    let searchTimer = 0;
    search.oninput = () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { void load(true) }, 350) };
  } catch (error) {
    bootFail('在线素材抽屉挂载失败: ' + String(error));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
