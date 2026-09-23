import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { recovery: 'src/recovery.ts', 'browser-guests': 'src/browser-guests.ts', permissions: 'src/permissions.ts', 'desktop-cli': 'src/desktop-cli.ts', 'plugin-cli': 'src/plugin-cli.ts', 'desktop-runtime': 'src/desktop-runtime.ts', main: 'src/main.ts', host: 'src/host/index.ts', profiles: 'src/profiles.ts', extensions: 'src/extensions.ts', webserver: 'src/webserver.ts', 'host-process': 'src/host-process.ts', 'web-document': 'src/web-document.ts' },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: true,
    deps: { neverBundle: ['electron'] },
  },
  ...['preload-app', 'preload-shell'].map(name => ({
    entry: { [name]: `src/${name}.ts` },
    outDir: 'lib', format: 'cjs' as const, platform: 'node' as const, target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
    deps: { neverBundle: ['electron'] },
  })),
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
    fixedExtension: false, dts: false, clean: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], alwaysBundle: ['lucide-react'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-desktop-next", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
