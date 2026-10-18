// dsh-tintin-ops-bundle vite config — copied from dsh-tintin-media-bundle
// (2026-10-17 快照；lib IIFE 单文件 + CSS 内联 + @ 别名，独立域同构)。
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function inlineCssIntoEntry(): Plugin {
  return {
    name: 'tintin-ops-inline-css',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url))
      const entry = `${distDir}/client.js`
      let js: string
      try {
        js = readFileSync(entry, 'utf8')
      } catch {
        return
      }
      if (js.includes("data-from','tintin-ops-bundle")) return
      const cssFiles = readdirSync(distDir, { recursive: true })
        .map((f) => `${distDir}/${String(f).replaceAll('\\', '/')}`)
        .filter((f) => f.endsWith('.css') && statSync(f).isFile())
      if (cssFiles.length === 0) return
      const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
      const injector =
        `;(function(){try{var d=typeof document==='undefined'?null:document;` +
        `if(!d||!d.createElement)return;var s=d.createElement('style');` +
        `s.setAttribute('data-from','tintin-ops-bundle');s.textContent=${JSON.stringify(css)};` +
        `(d.head||d.documentElement).appendChild(s)}catch(e){}})();\n`
      writeFileSync(entry, js + injector)
      for (const f of cssFiles) rmSync(f)
      try { rmdirSync(`${distDir}/assets`) } catch { /* 非空/不存在则保留 */ }
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue(), inlineCssIntoEntry()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    assetsInlineLimit: 64 * 1024,
    lib: {
      entry: 'src/client-entry.ts',
      formats: ['iife'],
      name: 'TintinOpsBundle',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'client.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
