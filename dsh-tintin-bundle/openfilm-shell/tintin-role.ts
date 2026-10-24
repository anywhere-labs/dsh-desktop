/**
 * 角色选择器(2026-10-24 §11 角色智能体名册): 选择本片场的角色预设,
 * 写入 window.__tintinRole —— studio-preload 的 localAgents.start 随 meta 送达主进程,
 * 影片智能体以该角色的人设启动会话(预设目录与主应用同源)。
 *
 * 挂载位置(2026-10-24 用户要求): 官方 composer 工具条内(与素材/技能按钮同行同款样式),
 * 不再用浮动层 —— 等官方工具条出现后注入, 样式走官方 openfilm-composer-tool。
 */
import { bootFail } from './boot';

const ROLES: Array<[string, string]> = [
  ['tintin-assistant', '总助手'],
  ['tintin-director', '编导'],
  ['tintin-producer', '制作'],
  ['tintin-qc', '质检'],
  ['tintin-librarian', '素材库'],
]

const KEY = 'tintin.role'

const mount = (): void => {
  try {
    const build = (): HTMLElement => {
      const select = document.createElement('select');
      select.className = 'openfilm-composer-tool';
      select.title = '角色(智能体人设)';
      for (const [id, name] of ROLES) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.append(option);
      }
      const kept = (() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })();
      const current = kept && ROLES.some(([id]) => id === kept) ? kept : 'tintin-assistant';
      select.value = current;
      ;(window as unknown as { __tintinRole: string }).__tintinRole = current;
      /* 行内紧凑尺寸: 与模型名同排, 不挤压官方按钮 */
      select.style.cssText = 'height:26px;min-width:96px;background:transparent;border:0;color:inherit;font:12px system-ui;outline:none;cursor:pointer';
      select.onchange = () => {
        const picked = select.value;
        ;(window as unknown as { __tintinRole: string }).__tintinRole = picked;
        try { localStorage.setItem(KEY, picked) } catch { /* 无存储: 会话内有效 */ }
      };
      return select;
    };
    const attach = (): void => {
      /* 官方工具条 = 素材按钮(官方 openfilm-composer-tool)的父容器; 注入到它的行首 */
      const official = document.querySelector('.openfilm-composer-tool');
      const row = official?.parentElement;
      if (!row) return false
      if (row.querySelector('[data-tintin-role]')) return true
      const select = build();
      select.setAttribute('data-tintin-role', '1');
      row.prepend(select);
      return true
    };
    let tries = 0
    const tick = (): void => {
      if (attach()) return
      tries += 1
      if (tries < 80) setTimeout(tick, 250)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 0));
    else setTimeout(tick, 0);
  } catch (error) {
    bootFail('角色选择器挂载失败: ' + String(error));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
