import { defineConfig } from 'tsdown'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { transform } from 'lightningcss'

const require = createRequire(import.meta.url)
/** Import prefix of an official CSS module the panel reuses (src/panel/official-styles.ts). */
const OFFICIAL_STYLES = 'acp-styles:'
/** Those imports by virtual id: the stylesheet and the classes it keeps (empty keeps all). */
const officialStyles = new Map<string, { key: string, filename: string, keep: ReadonlySet<string> }>()

export default defineConfig([{
  name: 'plugin',
  entry: { index: 'src/index.ts', client: 'src/client.ts', stdio: 'src/stdio.ts' },
  tsconfig: 'tsconfig.host.json',
  outDir: 'lib',
  platform: 'node',
  format: 'esm',
  target: 'es2023',
  clean: false,
  sourcemap: true,
  dts: true,
  // Oxc preserves standard decorators; lower the MeshCall service with
  // TypeScript so the published plugin runs on plain Node.js.
  plugins: [{
    name: 'standard-decorators',
    transform(code, id) {
      if (!/(?:^|\/)src\/rpc\.ts$/u.test(id.replaceAll('\\', '/'))) return
      const output = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true, experimentalDecorators: false },
      })
      return { code: output.outputText, map: output.sourceMapText! }
    },
  }],
  deps: { neverBundle: true },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
}, {
  name: 'panel', entry: { panel: 'src/panel/index.tsx' }, tsconfig: 'tsconfig.panel.json',
  outDir: 'lib', platform: 'browser', format: 'cjs', target: 'es2022', clean: false, dts: false, sourcemap: true,
  loader: { '.png': 'dataurl' },
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives'],
  // Reuse the official styles instead of writing our own: `acp-styles:<module.css>[?keep=a,b]`
  // compiles a CSS module of an installed official package and, given a list, keeps only the
  // rules that name those classes. The client fiber injects the result, so unloading removes it.
  plugins: [{
    name: 'official-styles',
    resolveId(source) {
      if (!source.startsWith(OFFICIAL_STYLES)) return
      const [path = '', list = ''] = source.slice(OFFICIAL_STYLES.length).split('?keep=')
      const filename = require.resolve(path)
      const key = `${filename}?keep=${list}`
      const known = [...officialStyles].find(([, entry]) => entry.key === key)?.[0]
      if (known) return known
      // A short id keeps the bundle's names readable; one ending in .css would be claimed by tsdown's own CSS pipeline.
      const id = `\0${OFFICIAL_STYLES}${basename(filename, '.css')}-${officialStyles.size}.mjs`
      officialStyles.set(id, { key, filename, keep: new Set(list.split(',').filter(Boolean)) })
      return id
    },
    async load(id) {
      const entry = officialStyles.get(id)
      if (!entry) return
      const { filename, keep } = entry
      this.addWatchFile(filename)
      const result = transform({
        filename, code: await readFile(filename), cssModules: true, minify: true,
        // A kept rule is left as parsed (no return value); only the dropped ones go back to lightningcss.
        ...keep.size > 0 ? { visitor: { Rule: { style: rule => rule.value.selectors.some(selector =>
          selector.some(part => part.type === 'class' && keep.has(part.name))) ? undefined : [] } } } : {},
      })
      const classes = Object.entries(result.exports ?? {}).filter(([name]) => keep.size === 0 || keep.has(name))
      const missing = [...keep].filter(name => !classes.some(([key]) => key === name))
      if (missing.length > 0) throw new Error(`official-styles: ${filename} no longer defines ${missing.join(', ')}`)
      // Drop the empty at-rule shells the pruned rules leave behind.
      const stylesheet = result.code.toString().replace(/@(?:media|container|supports)[^{}]*\{\}/gu, '')
      return `export default ${JSON.stringify(Object.fromEntries(classes.map(([key, value]) => [key, value.name])))};\n`
        + `export const stylesheet = ${JSON.stringify(stylesheet)};`
    },
  }],
  outputOptions: {
    entryFileNames: 'panel.js',
    banner: 'window.__ModuleLoader__.load({ id: "@agents-anywhere/dsh-acp-bridge", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}])
