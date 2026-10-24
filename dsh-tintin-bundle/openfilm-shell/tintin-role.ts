/**
 * 角色选择器(2026-10-24 §11 角色智能体名册): 选择本片场的角色预设,
 * 写入 window.__tintinRole —— studio-preload 的 localAgents.start 随 meta 送达主进程,
 * 影片智能体以该角色的人设启动会话(预设目录与主应用同源)。
 */
import { bootFail } from './boot';

const ROLES: Array<[string, string]> = [
  ['tintin-assistant', '总助手'],
  ['tintin-director', '编导'],
  ['tintin-producer', '制作'],
  ['tintin-qc', '质检'],
  ['tintin-librarian', '素材库'],
]

const STYLE = [
  '.tintin-role{position:fixed;right:428px;bottom:124px;z-index:2147483000;display:flex;align-items:center;gap:6px;background:#16171a;border:1px solid #2a2b31;border-radius:8px;padding:4px 8px;font:12px system-ui;color:#c9c9cf}',
  '.tintin-role select{background:transparent;border:0;color:#e8e8e6;font:12px system-ui;outline:none}',
  '.tintin-role select option{background:#16171a;color:#e8e8e6}',
].join('\n');

const KEY = 'tintin.role'

const mount = (): void => {
  try {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const box = document.createElement('div');
    box.className = 'tintin-role';
    const label = document.createElement('span'); label.textContent = '角色';
    const select = document.createElement('select');
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
    select.onchange = () => {
      const picked = select.value;
      ;(window as unknown as { __tintinRole: string }).__tintinRole = picked;
      try { localStorage.setItem(KEY, picked) } catch { /* 无存储: 会话内有效 */ }
    };
    box.append(label, select);
    document.body.append(box);
  } catch (error) {
    bootFail('角色选择器挂载失败: ' + String(error));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else setTimeout(mount, 0);
