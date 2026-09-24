import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('checks preset dependencies through the real Desktop resolver without importing plugins', () => {
  const require = createRequire(import.meta.url)
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[2]).href);
    const root = mkdtempSync(join(tmpdir(), 'desktop-preset-resolution-'));
    let release;
    try {
      const profile = join(root, 'profile');
      mkdirSync(profile);
      writeFileSync(join(profile, 'package.json'), '{"type":"module"}');
      const base = pathToFileURL(profile + '/').href;
      // Every shipped preset, not just \`standard\`. Peer virtualization can strand any
      // row's package inside another package's private node_modules, and the resolver
      // only walks upward — it never descends into one. Guarding a single preset let
      // \`minimal\`, \`ptc\` and \`cordis\` break unnoticed across a core bump.
      // dsh 0.1.7-alpha.1 replaced filesystem preset discovery with preset declarations
      // carried by the Web bundle's patch files, so the sweep reads
      // \`@deepseek-ai/dsh-web-app/presets/*.patch.yml\` instead of one directory per
      // preset. Rows carrying \`disabled: !!js process.platform === 'win32'\` are swept
      // too: a row that only runs on POSIX must still have its dependency installed on
      // Windows, and vice versa, so one platform's CI can catch the other's gap.
      const presetRoot = join(dirname(process.argv[1]), 'presets');
      const files = readdirSync(presetRoot).filter(name => name.endsWith('.patch.yml'));
      assert.ok(files.length > 0, 'the shipped preset root must be readable');
      const declared = [];
      for (const file of files) {
        const yaml = readFileSync(join(presetRoot, file), 'utf8');
        for (const [, name] of yaml.matchAll(/^\\s*-?\\s*name:\\s*'([^']+)'/gm)) {
          if (name.startsWith('cordis:')) continue; // built-in, not a package
          declared.push([file, name]);
        }
      }
      assert.ok(declared.length > 0, 'the shipped presets must declare plugin packages');
      // Without the Desktop overlay the bare profile resolves none of them. Asserting
      // that first is what keeps the sweep below a check on the resolver instead of a
      // tautology about the test runner's own node_modules.
      const bareResolve = createRequire(base);
      const resolvedWithoutOverlay = [];
      for (const [file, name] of declared) {
        try { bareResolve.resolve(name); resolvedWithoutOverlay.push(file + ': ' + name); } catch {}
      }
      assert.deepEqual([...new Set(resolvedWithoutOverlay)], []);
      release = installProfilePackageResolver(pathToFileURL(join(profile, 'package.json')).href);
      const resolveFromProfile = createRequire(base);
      const unresolvable = [];
      for (const [file, name] of declared) {
        try { resolveFromProfile.resolve(name); } catch { unresolvable.push(file + ': ' + name); }
      }
      assert.deepEqual([...new Set(unresolvable)], []);
      // Profile plugins are visible, but discovery must not evaluate their code.
      const override = join(profile, 'node_modules', '@desktop-regression', 'probe');
      mkdirSync(override, { recursive: true });
      writeFileSync(join(override, 'package.json'), '{"name":"@desktop-regression/probe","type":"module","exports":"./index.js"}');
      writeFileSync(join(override, 'index.js'), 'throw new Error("discovery evaluated plugin")');
      assert.ok(resolveFromProfile.resolve('@desktop-regression/probe').endsWith('index.js'));
      release();
      release = undefined;
      const afterRelease = createRequire(base);
      assert.throws(() => afterRelease.resolve(declared[0][1]));
      console.log('preset resolution passed');
    } finally {
      release?.();
      rmSync(root, { recursive: true, force: true });
    }
  `
  const output = execFileSync(process.execPath, [
    '--input-type=module', '-e', script,
    require.resolve('@deepseek-ai/dsh-web-app/package.json'),
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('preset resolution passed')
})
