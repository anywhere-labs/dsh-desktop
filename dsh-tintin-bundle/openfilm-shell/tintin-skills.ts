/**
 * 技能抽屉(2026-10-24 交互规范见 docs/tintin-openfilm-port.md §9):
 * 原生技能 + 服务端技能两个分组完整列出; 服务端技能带「安装」(写入智能体 home)。
 */
import { bootFail } from './boot';

type SkillRow = { name?: unknown; description?: unknown; source?: unknown };

const STYLE = [
  '.tintin-sk-fab{position:fixed;left:8px;bottom:88px;z-index:2147483000;background:#16171a;border:1px solid #3b6fd4;color:#cfe0ff;font:12px system-ui;padding:5px 10px;border-radius:8px;cursor:pointer}',
  '.tintin-sk-drawer{position:fixed;top:0;right:0;bottom:0;width:400px;z-index:2147483001;background:#101114;border-left:1px solid #26272b;display:flex;flex-direction:column;font:13px/1.5 system-ui;color:#e2e2e6}',
  '.tintin-sk-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c1d21}',
  '.tintin-sk-title{flex:1;font-weight:700;font-size:14px}',
  '.tintin-sk-close{background:none;border:0;color:#9a9aa0;font-size:16px;cursor:pointer}',
  '.tintin-sk-list{flex:1;min-height:0;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px}',
  '.tintin-sk-group{font-size:11px;color:#8a8a90;margin:10px 2px 0;border-top:1px solid #1c1d21;padding-top:10px}',
  '.tintin-sk-group:first-child{border-top:0;margin-top:0;padding-top:0}',
  '.tintin-sk-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #26272b;border-radius:9px;background:#16171a}',
  '.tintin-sk-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.tintin-sk-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tintin-sk-desc{color:#8a8a90;font-size:10px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.tintin-sk-install{border:1px solid #3b6fd4;background:#20304d;color:#cfe0ff;font-size:11px;padding:3px 8px;border-radius:7px;cursor:pointer;flex:none}',
  '.tintin-sk-status{padding:6px 12px 12px;color:#8a8a90;font-size:11px;min-height:18px;white-space:pre-wrap}',
].join('\n');

const mount = (): void => {
  try {
    const native = (window as unknown as {
      openfilmNative?: {
        skills?: {
          list: (project: string, agent: string) => Promise<{ openfilm?: SkillRow[]; error?: string }>
          install: (name: string) => Promise<{ ok?: boolean; path?: string; error?: string }>
        }
      }
    }).openfilmNative;
    if (typeof native?.skills?.list !== 'function') return;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const fab = document.createElement('button');
    fab.className = 'tintin-sk-fab';
    fab.textContent = '▦ 技能';
    document.body.append(fab);

    const drawer = document.createElement('div');
    drawer.className = 'tintin-sk-drawer';
    drawer.style.display = 'none';
    const head = document.createElement('div'); head.className = 'tintin-sk-head';
    const title = document.createElement('div'); title.className = 'tintin-sk-title'; title.textContent = '技能';
    const close = document.createElement('button'); close.className = 'tintin-sk-close'; close.textContent = '×';
    head.append(title, close);
    const list = document.createElement('div'); list.className = 'tintin-sk-list';
    const status = document.createElement('div'); status.className = 'tintin-sk-status';
    drawer.append(head, list, status);
    document.body.append(drawer);

    let loaded = false;
    const render = (items: SkillRow[]): void => {
      const nativeRows = items.filter((row) => row.source === 'native');
      const serverRows = items.filter((row) => row.source !== 'native');
      list.replaceChildren();
      const group = (label: string, rows: SkillRow[]): void => {
        const head = document.createElement('div'); head.className = 'tintin-sk-group';
        head.textContent = `${label}（${rows.length}）`;
        list.append(head);
        if (!rows.length) {
          const empty = document.createElement('div'); empty.style.cssText = 'color:#8a8a90;font-size:12px;padding:4px 2px';
          empty.textContent = '无';
          list.append(empty);
          return;
        }
        for (const row of rows) {
          const item = document.createElement('div'); item.className = 'tintin-sk-row';
          const main = document.createElement('div'); main.className = 'tintin-sk-main';
          const name = document.createElement('div'); name.className = 'tintin-sk-name'; name.textContent = String(row.name ?? '');
          const desc = document.createElement('div'); desc.className = 'tintin-sk-desc'; desc.textContent = String(row.description ?? '');
          main.append(name, desc); item.append(main);
          if (row.source !== 'native') {
            const install = document.createElement('button'); install.className = 'tintin-sk-install'; install.textContent = '安装';
            install.onclick = () => {
              install.textContent = '安装中…';
              void native.skills.install(String(row.name ?? '')).then((out) => {
                install.textContent = out.ok ? '已安装' : '重试';
                status.textContent = out.ok ? `已安装到智能体 home：${out.path ?? ''}` : `安装失败：${out.error ?? '未知错误'}`
              }, (error) => { install.textContent = '重试'; status.textContent = '安装失败：' + String(error) })
            };
            item.append(install);
          }
          list.append(item);
        }
      };
      group('原生技能', nativeRows);
      group('服务端技能', serverRows);
    };

    const load = async (): Promise<void> => {
      status.textContent = '加载中…';
      try {
        const out = await native.skills.list('', '');
        if (out.error) throw new Error(out.error);
        render(Array.isArray(out.openfilm) ? out.openfilm : []);
        status.textContent = '';
        loaded = true;
      } catch (error) {
        status.textContent = '加载失败：' + (error instanceof Error ? error.message : String(error));
      }
    };
    fab.onclick = () => { drawer.style.display = 'flex'; if (!loaded) void load() };
    close.onclick = () => { drawer.style.display = 'none' };
  } catch (error) {
    bootFail('技能抽屉挂载失败: ' + String(error));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
