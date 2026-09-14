import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('checks preset dependencies through the real Desktop resolver without importing plugins', () => {
  const require = createRequire(import.meta.url)
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const { scanRoot } = await import(pathToFileURL(process.argv[1]).href);
    const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[2]).href);
    const root = mkdtempSync(join(tmpdir(), 'desktop-preset-resolution-'));
    let release;
    try {
      const profile = join(root, 'profile');
      const presets = join(root, 'presets');
      mkdirSync(profile);
      writeFileSync(join(profile, 'package.json'), '{"type":"module"}');
      const define = (id, name) => {
        mkdirSync(join(presets, id), { recursive: true });
        writeFileSync(join(presets, id, 'agent.cordis.yml'), JSON.stringify([{ id: 'check', name }]));
      };
      define('installed', '@deepseek-ai/dsh-persona');
      define('subpath', '@deepseek-ai/dsh-tool-subagent-control/list-agents');
      define('missing', '@desktop-regression/nonexistent');
      define('bad-export', '@deepseek-ai/dsh-persona/nonexistent-export');
      const base = pathToFileURL(profile + '/').href;
      const scan = () => scanRoot({ path: presets, trust: 'system' }, base);
      assert.ok((await scan()).find(p => p.id === 'installed').broken);
      release = installProfilePackageResolver(pathToFileURL(join(profile, 'package.json')).href);
      const rows = await scan();
      assert.equal(rows.find(p => p.id === 'installed').broken, undefined);
      assert.equal(rows.find(p => p.id === 'subpath').broken, undefined);
      assert.ok(rows.find(p => p.id === 'missing').broken);
      assert.ok(rows.find(p => p.id === 'bad-export').broken);
      const shipped = await scanRoot({ path: join(dirname(process.argv[1]), '../presets'), trust: 'system' }, base);
      const standard = shipped.find(p => p.id === 'standard');
      assert.ok(standard);
      assert.equal(standard.broken, undefined);
      // Profile plugins are visible, but discovery must not evaluate their code.
      const override = join(profile, 'node_modules', '@desktop-regression', 'probe');
      mkdirSync(override, { recursive: true });
      writeFileSync(join(override, 'package.json'), '{"name":"@desktop-regression/probe","type":"module","exports":"./index.js"}');
      writeFileSync(join(override, 'index.js'), 'throw new Error("discovery evaluated plugin")');
      define('probe', '@desktop-regression/probe');
      assert.equal((await scan()).find(p => p.id === 'probe').broken, undefined);
      release();
      release = undefined;
      assert.ok((await scan()).find(p => p.id === 'installed').broken);
      console.log('preset resolution passed');
    } finally {
      release?.();
      rmSync(root, { recursive: true, force: true });
    }
  `
  const output = execFileSync(process.execPath, [
    '--input-type=module', '-e', script,
    require.resolve('@deepseek-ai/dsh-agent-presets'),
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('preset resolution passed')
})
