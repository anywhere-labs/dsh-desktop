// TinTin 的视频剪辑 shell 构建(第三行形态, 2026-10-23 用户裁决):官方 Studio 编辑器与
// 官方聊天两树一起编译,复刻 apps/desktop/shell/vite.config.ts 的结构。源树由
// fetch-openfilm-shell.mjs 按 pin 从 openfilm/openfilm 上游 vendor 到
// tintin-resources/openfilm-shell-src/(npm 包剥离了 studio/ui/src,不能用)。
// 构建产物由 build.mjs 覆盖 vendored openfilm 包的 studio/ui/dist —— 服务端零改动,
// 嵌入视图伺服的编辑器页就自带聊天。
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import type { Plugin as PostcssPlugin } from 'postcss';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src');
/* with forward slashes, as Vite names files on Windows too */
const STUDIO = normalize(join(SRC, 'openfilm/studio/ui/src') + '/');
const CHAT = normalize(join(SRC, 'chat') + '/');
/* npm 包自带(未被剥离):film-doc 的构建产物 */
const OPENFILM_PKG = normalize(join(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm') + '/');
const SHARED = normalize(join(SRC, 'shared') + '/');

/** `openfilm/studio-ui/*` 在 npm 包里指向被剥离的 src —— 别名到 vendor 的源树;film-doc 用包内构建产物;
    `@openfilm/shared` 是上游 workspace 包(npm 无),别名到 vendor 的源码。 */
function openfilmAliases(): Plugin {
  return {
    name: 'tintin-openfilm-alias',
    enforce: 'pre',
    resolveId(source) {
      if (source === '@openfilm/shared/markdown') return this.resolve(join(SHARED, 'markdown-blocks.ts'), undefined, { skipSelf: true });
      if (source === '@openfilm/shared') return this.resolve(join(SHARED, 'index.ts'), undefined, { skipSelf: true });
      if (source.startsWith('openfilm/studio-ui/')) return this.resolve(join(STUDIO, source.slice('openfilm/studio-ui/'.length)), undefined, { skipSelf: true });
      if (source === 'openfilm/film-doc') return this.resolve(join(SRC, 'openfilm/src/film-doc.mjs'), undefined, { skipSelf: true });
      return null;
    },
  };
}

/** `@/…` is the importing file's own tree: Studio's files and the chat's each name their `src` so. */
function twoTrees(): Plugin {
  return {
    name: 'tintin-two-trees',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!source.startsWith('@/') || !importer) return null;
      const base = normalize(importer).startsWith(CHAT) ? CHAT : STUDIO;
      return this.resolve(join(base, source.slice(2)), importer, { ...options, skipSelf: true });
    },
  };
}

/**
 * The chat's styles, kept to the chat: every selector applies inside `.of-chat` (its column and its layer); `:root`,
 * `html` and `body` mean the chat itself; a theme on the page reaches the chat under it. Rules only a page of the
 * chat's own needed (its title bar, the see-through column, a theme from the system, the focus ring and the timeline
 * cursor Studio already has) are left out.
 */
const scopeChat: PostcssPlugin = {
  postcssPlugin: 'tintin-scope-chat',
  Once(root, { result }) {
    if (!normalize(result.opts.from ?? '').startsWith(CHAT)) return;
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as { name: string }).name)) return;
      const selectors = new Set<string>();
      for (const raw of rule.selectors) {
        const s = raw.trim();
        if (/:not\(\[data-theme\]\)|data-assets-open|openfilm-inset-titlebar|openfilm-fullscreen|tl-scrubbing|data-focus-nav/.test(s)) continue;
        const page = /^(?::root|html|body)(?![\w-])/.exec(s);
        const theme = /^\[data-theme='(?:light|dark)'\]/.exec(s);
        if (page) selectors.add(`.of-chat${s.slice(page[0].length)}`);
        else if (theme) selectors.add(`${theme[0]} .of-chat${s.slice(theme[0].length)}`);
        else selectors.add(`.of-chat ${s}`);
      }
      if (selectors.size) rule.selectors = [...selectors];
      else rule.remove();
    });
  },
};

export default defineConfig({
  plugins: [twoTrees(), openfilmAliases(), react(), tailwind()],
  css: { postcss: { plugins: [scopeChat] } },
  /* one React for both trees (each would find its own package's otherwise) */
  resolve: { dedupe: ['react', 'react-dom', 'lucide-react'] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
