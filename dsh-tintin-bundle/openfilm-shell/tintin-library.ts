/**
 * 在线素材库抽屉(2026-10-24 交互规范见 docs/tintin-openfilm-port.md §10)。
 * 数据经 openfilmNative.library(主进程代理服务端, 无 CORS); 下载落项目后即出现在
 * Studio 左侧媒体面板, 走官方交互(拖入时间线 / @ 引用)。
 */
import { bootFail } from './boot';
import { registerAssetsDrawer, closeAssetsDrawer } from './bridge';

type LibraryItem = { material_id?: unknown; id?: unknown; filename?: unknown; name?: unknown; size?: unknown; media_type?: unknown };
type Tab = 'video' | 'image' | 'audio';

const STYLE = [
  '.tintin-lib-fab{position:fixed;right:428px;bottom:52px;z-index:2147483000;background:#16171a;border:1px solid #3b6fd4;color:#cfe0ff;font:12px system-ui;padding:5px 10px;border-radius:8px;cursor:pointer}',
  '.tintin-lib-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.28)}',
  '.tintin-lib-drawer{position:fixed;top:0;right:0;bottom:0;width:400px;z-index:2147483001;background:#101114;border-left:1px solid #26272b;display:flex;flex-direction:column;font:13px/1.5 system-ui;color:#e2e2e6}',
  '.tintin-lib-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c1d21}',
  '.tintin-lib-title{flex:1;font-weight:700;font-size:14px}',
  '.tintin-lib-close{background:#1a1b1f;border:1px solid #2a2b31;border-radius:8px;color:#c9c9cf;font-size:15px;cursor:pointer;min-width:28px;height:28px;padding:0 8px;flex:none}',
  '.tintin-lib-close:hover{background:#24262b;color:#fff}',
  '.tintin-lib-tabs{display:flex;gap:6px;padding:8px 12px 0}',
  '.tintin-lib-tab{border:1px solid #2a2b31;background:#1a1b1f;color:#c9c9cf;font:11px system-ui;padding:3px 10px;border-radius:7px;cursor:pointer}',
  '.tintin-lib-tab.is-on{background:#3b6fd4;border-color:#3b6fd4;color:#fff}',
  '.tintin-lib-search{margin:8px 12px;background:#16171a;border:1px solid #26272b;border-radius:8px;color:#e8e8e6;font:12px system-ui;padding:6px 10px;outline:none}',
  '.tintin-lib-list{flex:1;min-height:0;overflow:auto;padding:0 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-lib-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26272b;border-radius:9px;background:#16171a;cursor:default}',
  '.tintin-lib-thumb{width:56px;height:32px;border-radius:5px;object-fit:cover;background:#0b0c0f;flex:none;cursor:pointer}',
  '.tintin-lib-note{width:56px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:#0b0c0f;color:#8f9096;flex:none}',
  '.tintin-lib-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;cursor:pointer}',
  '.tintin-lib-size{color:#77787e;font-size:10px;flex:none}',
  '.tintin-lib-play,.tintin-lib-dl{border:1px solid #3b6fd4;background:#20304d;color:#cfe0ff;font-size:11px;padding:3px 8px;border-radius:7px;cursor:pointer;flex:none}',
  '.tintin-lib-play{width:26px;height:26px;padding:0;border-radius:50%}',
  '.tintin-lib-play.is-playing{background:#3b6fd4;color:#fff}',
  '.tintin-lib-more{margin:10px 12px 14px;border:1px solid #26272b;background:#16171a;color:#c9c9cf;font-size:12px;padding:6px;border-radius:8px;cursor:pointer}',
  '.tintin-lib-status{padding:6px 12px 12px;color:#8a8a90;font-size:11px;min-height:18px;white-space:pre-wrap}',
  '.tintin-lib-progress{height:3px;margin:0 12px;background:#1a1b1f;border-radius:2px;overflow:hidden}',
  '.tintin-lib-progress i{display:block;height:100%;width:40%;background:#3b6fd4;animation:tintin-lib-slide 1.1s linear infinite}',
  '@keyframes tintin-lib-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}',
  '.tintin-lib-menu{position:fixed;z-index:2147483002;background:#1a1b1f;border:1px solid #2f3036;border-radius:8px;padding:4px;min-width:170px;box-shadow:0 10px 28px rgba(0,0,0,.45)}',
  '.tintin-lib-menu button{display:block;width:100%;text-align:left;padding:7px 10px;border:0;border-radius:6px;background:none;color:#c9c9cf;font:12px system-ui;cursor:pointer}',
  '.tintin-lib-menu button:hover{background:#24262b}',
  '.tintin-lib-preview{position:fixed;inset:0;z-index:2147483003;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center}',
  '.tintin-lib-preview-box{max-width:82vw;background:#16171a;border:1px solid #2a2b31;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-lib-preview-media{max-width:78vw;max-height:70vh;display:block}',
  '.tintin-lib-preview-name{color:#b9b9c0;font-size:11px}',
].join('\n');

const mount = (): void => {
  try {
    const native = (window as unknown as {
      openfilmNative?: {
        library?: {
          list: (q: unknown) => Promise<{ items?: LibraryItem[]; serverUrl?: string; error?: string }>
          download: (p: unknown) => Promise<{ ok?: boolean; rel?: string; path?: string; error?: string }>
        }
      }
    }).openfilmNative;
    const filmDirBridge = (window as unknown as { tintinFilmDir?: () => Promise<string> }).tintinFilmDir;
    /* 只有 library.list 缺失才不挂; 影片目录缺失只影响「下载到项目」, 预览/下载到电脑照常 */
    if (typeof native?.library?.list !== 'function') return;
    const projectDir = async (): Promise<string> => {
      if (typeof filmDirBridge !== 'function') return '';
      try { return await filmDirBridge() } catch { return '' }
    }

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
    const tabs = document.createElement('div'); tabs.className = 'tintin-lib-tabs';
    const search = document.createElement('input'); search.className = 'tintin-lib-search'; search.placeholder = '搜索素材库…';
    const list = document.createElement('div'); list.className = 'tintin-lib-list';
    const more = document.createElement('button'); more.className = 'tintin-lib-more'; more.textContent = '加载更多'; more.style.display = 'none';
    const status = document.createElement('div'); status.className = 'tintin-lib-status';
    /* 下载进度条(2026-10-24 用户要求): 抽屉底部的不定长进度条, 下载期间显示 */
    const progress = document.createElement('div'); progress.className = 'tintin-lib-progress'; progress.style.display = 'none';
    progress.append(document.createElement('i'));
    drawer.append(head, tabs, search, list, more, progress, status);
    document.body.append(drawer);
    /* 背景遮罩(点抽屉外任意处即关闭): 抽屉 z=3001, 遮罩 z=3000 */
    const backdrop = document.createElement('div'); backdrop.className = 'tintin-lib-backdrop'; backdrop.style.display = 'none';
    document.body.append(backdrop);

    let tab: Tab = 'video';
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
    const serveUrl = (item: LibraryItem): string => `${serverUrl}/material/serve?material_id=${encodeURIComponent(idOf(item))}`;
    const thumbUrl = (item: LibraryItem): string => `${serverUrl}/material/thumbnail?material_id=${encodeURIComponent(idOf(item))}`;

    const TABS: Array<[Tab, string]> = [['video', '视频'], ['image', '图片'], ['audio', '音频']];
    const renderTabs = (): void => {
      tabs.replaceChildren(...TABS.map(([id, label]) => {
        const b = document.createElement('button');
        b.className = 'tintin-lib-tab' + (id === tab ? ' is-on' : '');
        b.textContent = label;
        b.onclick = () => { if (tab === id) return; tab = id; page = 1; exhausted = false; stopAudio(); list.replaceChildren(); renderTabs(); void load(true) };
        return b;
      }));
    };
    renderTabs();

    /* 行内音频试听: 单实例, ▶/■ 同键切换 */
    let currentAudio: HTMLAudioElement | null = null;
    let currentBtn: HTMLElement | null = null;
    const stopAudio = (): void => {
      if (currentAudio) { try { currentAudio.pause(); currentAudio.currentTime = 0 } catch { /* stopped */ } }
      if (currentBtn) { currentBtn.textContent = '▶'; currentBtn.classList.remove('is-playing') }
      currentAudio = null; currentBtn = null;
    };

    /* 预览模态: 点击名称/缩略图 → 视频/音频播放器或图片大图 */
    const showPreview = (item: LibraryItem): void => {
      stopAudio();
      const backdrop = document.createElement('div'); backdrop.className = 'tintin-lib-preview';
      const box = document.createElement('div'); box.className = 'tintin-lib-preview-box';
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center';
      const label = document.createElement('div'); label.className = 'tintin-lib-preview-name'; label.style.flex = '1'; label.textContent = nameOf(item);
      const closeBtn = document.createElement('button'); closeBtn.className = 'tintin-lib-close'; closeBtn.textContent = '×';
      bar.append(label, closeBtn);
      const media = document.createElement(tab === 'image' ? 'img' : tab === 'audio' ? 'audio' : 'video') as HTMLMediaElement & HTMLImageElement;
      media.className = 'tintin-lib-preview-media';
      if (tab === 'image') (media as HTMLImageElement).src = serveUrl(item);
      else { (media as HTMLVideoElement).src = serveUrl(item); media.controls = true; (media as HTMLVideoElement).autoplay = true }
      box.append(bar, media); backdrop.append(box); document.body.append(backdrop);
      const closePreview = (): void => {
        try { (media as HTMLVideoElement).pause?.() } catch { /* not playing */ }
        backdrop.remove();
      };
      closeBtn.onclick = closePreview;
      backdrop.onclick = (ev) => { if (ev.target === backdrop) closePreview() };
    };

    /* 右键菜单: 下载到项目 / 下载到电脑 */
    const download = async (item: LibraryItem, target: 'project' | 'downloads'): Promise<void> => {
      progress.style.display = 'block';
      status.textContent = target === 'downloads' ? '正在下载到电脑…' : '正在下载到项目…';
      try {
        const project = target === 'project' ? await projectDir() : '';
        const out = await native.library.download({ project, materialId: idOf(item), filename: nameOf(item), serverUrl, target });
        if (out.error) throw new Error(out.error);
        status.textContent = target === 'downloads'
          ? `已下载到电脑 ${out.path ?? ''}`
          : `已下载到项目 ${out.rel ?? ''}（Studio 媒体面板可见，可拖入时间线）`
      } catch (error) {
        status.textContent = `下载失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        progress.style.display = 'none';
      }
    };
    const showRowMenu = (x: number, y: number, item: LibraryItem): void => {
      document.querySelector('.tintin-lib-menu')?.remove();
      const menu = document.createElement('div'); menu.className = 'tintin-lib-menu';
      const rowProject = document.createElement('button'); rowProject.textContent = '下载到本地项目';
      rowProject.onclick = () => { menu.remove(); void download(item, 'project') };
      const rowPc = document.createElement('button'); rowPc.textContent = '下载到电脑';
      rowPc.onclick = () => { menu.remove(); void download(item, 'downloads') };
      menu.append(rowProject, rowPc);
      menu.style.left = `${Math.min(x, innerWidth - 200)}px`;
      menu.style.top = `${Math.min(y, innerHeight - 80)}px`;
      document.body.append(menu);
      setTimeout(() => {
        const off = (ev: MouseEvent): void => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', off) } };
        document.addEventListener('mousedown', off);
      }, 0);
    };

    const open = (): void => {
      backdrop.style.display = 'block'
      drawer.style.display = 'flex';
      if (!list.childElementCount && !busy) void load(true);
    };
    const hide = (): void => { stopAudio(); drawer.style.display = 'none'; backdrop.style.display = 'none' };
    fab.onclick = open;
    /* 关闭(2026-10-24 报障三轮): 三条独立路径 —— ①大热区 × (pointerdown+click) ②点抽屉外的背景遮罩
       ③Esc; 全部落到同一个 requestClose, 关闭后回置聊天素材按钮状态。 */
    const requestClose = (event?: Event): void => {
      if (event) { event.preventDefault(); event.stopPropagation() }
      hide()
      closeAssetsDrawer()
    };
    close.addEventListener('pointerdown', requestClose)
    close.addEventListener('click', requestClose)
    backdrop.addEventListener('pointerdown', requestClose)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawer.style.display !== 'none') requestClose()
    })
    registerAssetsDrawer((openState) => { if (openState) open(); else hide() });

    async function load(reset: boolean): Promise<void> {
      if (busy) return;
      busy = true;
      status.textContent = reset ? '加载中…' : '加载更多…';
      try {
        const result = await native.library.list({ page: reset ? 1 : page, size: 24, mediaType: tab, search: search.value.trim() });
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
          if (tab === 'audio') {
            const note = document.createElement('div'); note.className = 'tintin-lib-note'; note.textContent = '♪'; row.append(note);
          } else {
            const img = document.createElement('img'); img.className = 'tintin-lib-thumb'; img.loading = 'lazy';
            img.src = thumbUrl(item); img.onerror = () => { img.remove() };
            img.onclick = () => showPreview(item);
            row.append(img);
          }
          const name = document.createElement('div'); name.className = 'tintin-lib-name'; name.textContent = nameOf(item); name.title = nameOf(item);
          name.onclick = () => showPreview(item);
          const size = document.createElement('span'); size.className = 'tintin-lib-size'; size.textContent = fmtSize(item.size);
          row.append(name, size);
          if (tab === 'audio') {
            const play = document.createElement('button'); play.className = 'tintin-lib-play'; play.textContent = '▶'; play.title = '试听/停止';
            play.onclick = () => {
              if (currentBtn === play) { stopAudio(); return }
              stopAudio();
              const audio = new Audio(serveUrl(item));
              currentAudio = audio; currentBtn = play;
              play.textContent = '■'; play.classList.add('is-playing');
              audio.addEventListener('ended', () => { if (currentAudio === audio) stopAudio() });
              audio.play().catch(() => stopAudio());
            };
            row.append(play);
          }
          const dl = document.createElement('button'); dl.className = 'tintin-lib-dl'; dl.textContent = '下载到项目';
          dl.onclick = () => {
            if (dl.dataset.busy === '1') return;
            dl.dataset.busy = '1'; dl.textContent = '下载中…'
            void download(item, 'project').finally(() => { dl.dataset.busy = ''; dl.textContent = '下载到项目' })
          };
          row.append(dl);
          row.addEventListener('contextmenu', (event) => {
            event.preventDefault(); event.stopPropagation();
            showRowMenu(event.clientX, event.clientY, item);
          });
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
    search.oninput = () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { page = 1; exhausted = false; void load(true) }, 300) };
  } catch (error) {
    bootFail('在线素材抽屉挂载失败: ' + String(error));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
