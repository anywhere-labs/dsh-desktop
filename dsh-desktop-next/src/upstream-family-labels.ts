/**
 * Official names that differ between the DSH releases Next and Beta follow. Like
 * src/upstream-family.ts, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); it stays free of imports because renderer bundles use it.
 */

/**
 * How the official `@deepseek-ai/dsh-experimental-plugin-market-bundle` presents itself in its locale files from 0.2.2 on.
 * Next's rc.4 bundle still calls itself "Custom plugin markets"; Desktop already uses the 0.2.2 name.
 */
export const OFFICIAL_PLUGIN_INDEX = {
  title: { zh: '自定义插件索引', en: 'Custom plugin indexes' },
  description: {
    zh: '在插件页添加“发现”标签页，从你添加的插件索引中浏览和安装插件。',
    en: 'Adds a Discover tab to Plugins, where you browse and install plugins from plugin indexes you add.',
  },
} as const
