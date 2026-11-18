import { defineConfig } from 'tsdown'
import ts from 'typescript'

export default defineConfig({
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
})
