const fs = require('node:fs');
const mode = process.argv[2];
if (mode === 'resolutions') {
  const name = process.argv[3];
  const unscoped = name.slice('@deepseek-ai/'.length);
  const vendor = `vendor/dsh-runtime/0.1.5-rc.2/deepseek-ai-${unscoped}-0.1.5-rc.2.tgz`;
  const fileValue = `file:${vendor}`;
  const patchValue = `patch:@deepseek-ai/${name}@file%3A${vendor}#./patches/${unscoped}@0.1.5-rc.2.patch`;
  let text = fs.readFileSync('package.json', 'utf8');
  let hits = 0;
  for (const sel of [`"@deepseek-ai/${name}@npm:0.1.5-rc.2"`, `"@deepseek-ai/${name}@npm:^0.1.5-rc.2"`]) {
    const from = `${sel}: "${fileValue}"`;
    const to = `${sel}: "${patchValue}"`;
    if (!text.includes(from)) throw new Error(`missing resolution: ${from}`);
    text = text.replace(from, to);
    hits += 1;
  }
  fs.writeFileSync('package.json', text);
  console.log(`resolutions rewired for ${name} (${hits} keys)`);
} else if (mode === 'linux-test') {
  const files = ['dsh-plugin-desktop/tests/package.spec.ts', 'dsh-plugin-desktop-beta/tests/package.spec.ts'];
  const from = "expect(evaluate('linux', '43.3.0', '/request')).not.toHaveProperty('ELECTRON_RUN_AS_NODE')";
  const to = "expect(evaluate('linux', '43.3.0', '/request').ELECTRON_RUN_AS_NODE).toBe('1');\n      expect(evaluate('linux')).not.toHaveProperty('ELECTRON_RUN_AS_NODE')";
  let total = 0;
  for (const f of files) {
    let text = fs.readFileSync(f, 'utf8');
    if (!text.includes(from)) throw new Error(`assertion not found in ${f}`);
    text = text.replaceAll(from, to);
    fs.writeFileSync(f, text);
    total += 1;
  }
  console.log(`linux assertion updated in ${total} spec files`);
} else {
  throw new Error(`unknown mode ${mode}`);
}
