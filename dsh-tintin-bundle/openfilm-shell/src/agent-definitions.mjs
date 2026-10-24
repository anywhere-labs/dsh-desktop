// @ts-check
/** Desktop metadata only; discovery, launch and sign-in behavior stay in their existing modules. */
/** @satisfies {Record<string, { name: string, install: `https://${string}` | null }>} */
const definitions = {
  codex: { name: 'Codex', install: 'https://chatgpt.com/download/' },
  claude: { name: 'Claude Code', install: 'https://claude.com/download' },
  copilot: { name: 'GitHub Copilot', install: 'https://github.com/features/copilot/cli' },
  cursor: { name: 'Cursor', install: 'https://cursor.com/cli' },
  opencode: { name: 'OpenCode', install: 'https://opencode.ai/download' },
  codebuddy: { name: 'CodeBuddy', install: 'https://www.codebuddy.cn/docs/cli/installation' },
  qwen: { name: 'Qwen Code', install: 'https://github.com/QwenLM/qwen-code' },
  kimi: { name: 'Kimi', install: 'https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html' },
  minimax: { name: 'MiniMax Code', install: 'https://www.npmjs.com/package/@minimax-ai/code' },
  deepseek: { name: 'DeepSeek Harness', install: 'https://github.com/deepseek-ai/deepseek-harness' },
  byok: { name: 'Own key', install: null },
};

/** @type {Readonly<{ [Id in keyof typeof definitions]: Readonly<typeof definitions[Id]> }>} */
export const AGENT_DEFINITIONS = Object.freeze(definitions);
/** @typedef {keyof typeof AGENT_DEFINITIONS} AgentId */

export const AGENT_IDS = Object.freeze(/** @type {AgentId[]} */ (Object.keys(AGENT_DEFINITIONS)));
export const OWN_AGENT_IDS = Object.freeze(AGENT_IDS.filter((id) => id !== 'byok'));

/** All desktop choices, including own key; safe for persisted data and unknown historical ids.
 * @param {unknown} value
 * @returns {value is AgentId}
 */
export function isAgentId(value) {
  return typeof value === 'string' && Object.hasOwn(AGENT_DEFINITIONS, value);
}
