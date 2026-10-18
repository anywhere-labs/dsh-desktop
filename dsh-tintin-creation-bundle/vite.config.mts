// tintin-media-bundle client build (vite, IIFE single file → dist/client.js).
// Vue is a build-time dependency bundled INTO the chunk; the host only forces
// react/@deepseek-ai singletons, which the entry requires from the module
// system at runtime. Rebuild: npm run tintin:media (wired into root scripts).
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

// IIFE lib mode does not auto-load the emitted css, and the runtime loads only
// dist/client.js — so after the bundle is written, embed the single css asset
// (cssCodeSplit:false merges SFC styles + plyr.css into one) into client.js as
// a guarded <style> injector appended after the IIFE, then remove the css
// file. Done via closeBundle + fs because vite 7 emits the merged css asset
// after user generateBundle hooks (the asset was not visible there in
// practice). Keeping everything in one file preserves the "one authoritative
// client artifact" contract; the try/catch + document guard keeps node-sandbox
// smoke runs (stub DOM) from failing on the injected statement.
function inlineCssIntoEntry(): Plugin {
  return {
    name: 'tintin-media-inline-css',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url))
      const entry = `${distDir}/client.js`
      let js: string
      try {
        js = readFileSync(entry, 'utf8')
      } catch {
        return // no entry emitted (config error elsewhere reports it)
      }
      if (js.includes("data-from','tintin-media-bundle")) return
      const cssFiles = readdirSync(distDir, { recursive: true })
        .map((f) => `${distDir}/${String(f).replaceAll('\\', '/')}`)
        .filter((f) => f.endsWith('.css') && statSync(f).isFile())
      if (cssFiles.length === 0) return
      const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
      const injector =
        `;(function(){try{var d=typeof document==='undefined'?null:document;` +
        `if(!d||!d.createElement)return;var s=d.createElement('style');` +
        `s.setAttribute('data-from','tintin-media-bundle');s.textContent=${JSON.stringify(css)};` +
        `(d.head||d.documentElement).appendChild(s)}catch(e){/* style injection failure must not break module registration */}})();\n`
      writeFileSync(entry, js + injector)
      for (const f of cssFiles) rmSync(f)
      // 清掉因此空掉的 assets 目录，保持 dist/ 单一权威产物。
      try { rmdirSync(`${distDir}/assets`) } catch { /* 非空/不存在则保留 */ }
    },
  }
}

export default defineConfig({
  // Anchor root to this package dir so `vite build -c <config>` works from
  // anywhere (the CLI resolves the entry against cwd otherwise).
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), inlineCssIntoEntry()],
  // 搬运的 TinTin 源文件里 `@/composables/...`、`@/components/...` 引用一律
  // 原样保留，靠该别名解析到本包 src/（源项目 vite 同名约定）。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // lib 模式默认不替换 process.env.NODE_ENV（假定宿主处理），而 vue/plyr 的
  // esm-bundler 构建在求值期读它——浏览器无 process 直接 ReferenceError，
  // 并打断 combo 里后续脚本的注册（实测：process is not defined）。
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    // 单一 css 资产（SFC styles + plyr.css），由 inlineCssIntoEntry 嵌入
    // dist/client.js；lib IIFE 模式不会自行加载分片 css。
    cssCodeSplit: false,
    // 图片等非 css 资产必须内联为 data URI（≤64KB）：运行时只加载 dist/client.js
    // 单一产物，独立 assets 文件（inlineCssIntoEntry 会清掉 dist/assets）无人加载。
    // 现有唯一图片=剪映设置引导截图（35KB）。
    assetsInlineLimit: 64 * 1024,
    lib: {
      entry: 'src/client-entry.ts',
      formats: ['iife'],
      name: 'TintinCreationBundle',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'client.js',
        // cssCodeSplit:false → all styles land in one asset which
        // inlineCssIntoEntry embeds into the chunk and deletes; nothing else
        // is expected here, the pattern only guards future strays.
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
