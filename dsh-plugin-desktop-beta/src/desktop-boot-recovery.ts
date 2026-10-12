/** Desktop-only Recovery Mode action injected into the framework-free boot page. */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DESKTOP_RECOVERY_RESTART_PATH } from './desktop-settings-contract.ts'

/** The bounded same-origin request used to restart into Recovery Mode. */
export const DESKTOP_RECOVERY_RESTART_REQUEST = Object.freeze({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  credentials: 'same-origin',
})

/** Backwards-compatible request name retained for downstream imports. */
export const DESKTOP_TERMINAL_OPEN_REQUEST = DESKTOP_RECOVERY_RESTART_REQUEST

/** Minimal presentation for the early-boot recovery guidance and action. */
export const DESKTOP_BOOT_RECOVERY_STYLE = `
[data-dsh-desktop-recovery] {
  --dsh-recovery-muted: var(--dsw-alias-label-secondary, var(--dsh-boot-label-secondary, #61666b));
  --dsh-recovery-primary-bg: var(--dsw-alias-button-primary-fill, var(--dsh-boot-brand, #0f1115));
  --dsh-recovery-primary-hover: var(--dsw-alias-button-primary-hover, #303238);
  --dsh-recovery-primary-fg: var(--dsw-alias-label-primary-foreground, #fff);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  width: min(480px, calc(100vw - 48px));
  margin-top: 8px;
  color: var(--dsh-recovery-muted);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
[data-dsh-desktop-recovery] p {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}
[data-dsh-desktop-recovery] button {
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 20px;
  background: var(--dsh-recovery-primary-bg);
  color: var(--dsh-recovery-primary-fg);
  cursor: pointer;
  font: 500 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
[data-dsh-desktop-recovery] button:hover:not(:disabled),
[data-dsh-desktop-recovery] button:active:not(:disabled) {
  background: var(--dsh-recovery-primary-hover);
}
[data-dsh-desktop-recovery] button:focus-visible {
  outline: 2px solid #5b8def;
  outline-offset: 2px;
}
[data-dsh-desktop-recovery] button:disabled {
  cursor: progress;
  opacity: 0.52;
}
body[data-ds-dark-theme] [data-dsh-desktop-recovery] {
  --dsh-recovery-muted: #cfd3d6;
  --dsh-recovery-primary-bg: #f9fafb;
  --dsh-recovery-primary-hover: #dfe3e6;
  --dsh-recovery-primary-fg: #151517;
}
@media (prefers-color-scheme: dark) {
  [data-dsh-desktop-recovery] {
    --dsh-recovery-muted: #cfd3d6;
    --dsh-recovery-primary-bg: #f9fafb;
    --dsh-recovery-primary-hover: #dfe3e6;
    --dsh-recovery-primary-fg: #151517;
  }
}
@media (max-width: 520px) {
  [data-dsh-desktop-recovery] { width: calc(100vw - 32px); }
  [data-dsh-desktop-recovery] button { width: 100%; }
}
`

/** Preserve the upstream plugin-failure report and append Desktop recovery guidance. */
export const DESKTOP_BOOT_RECOVERY_SCRIPT = `(() => {
  const endpoint = ${JSON.stringify(DESKTOP_RECOVERY_RESTART_PATH)};
  const request = ${JSON.stringify(DESKTOP_RECOVERY_RESTART_REQUEST)};
  const label = '打开恢复模式 / Open Recovery Mode';
  const description = '部分插件加载失败，可能与当前 DSH 版本不兼容。你可以进入恢复模式卸载有问题的插件，或新建 Profile 后重新启动。 / Some plugins failed to load and may be incompatible with this DSH version. Open Recovery Mode to uninstall the affected plugins or create a new Profile, then restart DSH Desktop.';
  const element = (tag, attributes, content) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
      if (name === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(name, value);
    }
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const attach = () => {
    const root = document.querySelector('[data-dsh-boot]');
    if (!root || root.querySelector('[data-dsh-desktop-recovery]')) return;
    const title = [...root.querySelectorAll('div')].find((node) =>
      node.childElementCount === 0 && node.textContent?.trim() === 'Failed to load plugins'
    );
    const report = title?.parentElement;
    if (!report) return;
    const panel = element('section', {
      'aria-label': label,
      dataset: { dshDesktopRecovery: '' },
    });
    const button = element('button', { type: 'button', 'aria-label': label }, label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch(endpoint, request);
        if (!response.ok) throw new Error('Desktop recovery request failed');
      } catch {
        button.disabled = false;
      }
    });
    panel.append(element('p', {}, description), button);
    report.append(panel);
  };
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
  attach();
})();`

/** Backwards-compatible names retained for downstream tests and embedders. */
export const DESKTOP_BOOT_TERMINAL_STYLE = DESKTOP_BOOT_RECOVERY_STYLE
export const DESKTOP_BOOT_TERMINAL_SCRIPT = DESKTOP_BOOT_RECOVERY_SCRIPT

/** Structured rows consumed by both the loopback server and static boot renderer. */
export function desktopBootRecoveryInjections(): readonly IndexInjection[] {
  return [
    { kind: 'style', text: DESKTOP_BOOT_RECOVERY_STYLE },
    { kind: 'script', placement: 'body', text: DESKTOP_BOOT_RECOVERY_SCRIPT },
  ]
}
