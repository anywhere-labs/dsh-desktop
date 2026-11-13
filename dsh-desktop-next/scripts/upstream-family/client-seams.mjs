/** Reproduce the rc.2 Desktop UI seams from the untouched, vendored official packages.
 * Run with Node from any directory. Every edit must match once; changed upstream bytes fail closed.
 * Existing official views and their controllers remain the owners of onboarding and plugin management.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const require = createRequire(join(root, 'dsh-desktop-next/package.json'))
// The existing Vite toolchain supplies the source-map editor and composer.
const MagicString = require('magic-string')
const remapping = require('@jridgewell/remapping')
const ts = require('typescript')
const version = '0.2.2-rc.3'

function onboarding() {
  function DesktopOnboardingNavigation({ busy, t, onBack, onSkip }) {
    return react_jsx_runtime.jsxs('footer', {
      className: DesktopOnboarding_module_css_default.navigation,
      style: { position: 'static', transform: 'none', width: 'auto' },
      children: [onBack ? react_jsx_runtime.jsxs('button', {
        type: 'button', disabled: busy, onClick: onBack,
        children: [react_jsx_runtime.jsx('span', {
          className: DesktopOnboarding_module_css_default.backIcon,
          style: { maskImage: `url(${onboarding_back_default})` }, 'aria-hidden': true,
        }), t('onboardingBack')],
      }) : react_jsx_runtime.jsx('span', {}), react_jsx_runtime.jsx('button', {
        type: 'button', disabled: busy, onClick: onSkip, children: t('onboardingSkip'),
      })],
    })
  }
  function DesktopOnboardingContinuationPage({ children, setVisible }) {
    react.useLayoutEffect(() => {
      setVisible(true)
      globalThis.dshOnboarding?.setActive(true)
      return () => { setVisible(false); globalThis.dshOnboarding?.setActive(false) }
    }, [setVisible])
    return react_jsx_runtime.jsx(OnboardingSurface, { children: react_jsx_runtime.jsx('div', {
      className: 'dshDesktopOnboardingContent', 'data-desktop-onboarding': 'desktop-extension',
      style: { width: '100%', height: '100%' }, children,
    }) })
  }
  function DesktopOnboardingEntry(props) {
    const account = props.useAccount(value => value)
    const renderNext = () => react_jsx_runtime.jsx(OfficialDesktopOnboardingEntry, props)
    const renderSurface = children => react_jsx_runtime.jsx(DesktopOnboardingContinuationPage, {
      children, setVisible: props.setVisible,
    })
    const renderLoading = () => renderSurface(react_jsx_runtime.jsx('div', {
      role: 'status', children: props.t('onboardingLoading'),
    }))
    return props.renderSlot('onboarding.desktop.before', {
      accountStatus: account.view?.status ?? (account.failed ? 'error' : 'loading'),
      openLogin: props.openDesktopLogin, renderSurface,
      renderNavigation: options => react_jsx_runtime.jsx(DesktopOnboardingNavigation, { ...options, t: props.t }),
      renderLoading, renderNext,
    }, { fallback: globalThis.dshDesktopSetup ? renderLoading() : renderNext() })
  }
}

// The native shell exposes no credential values. Query the official metadata APIs only.
async function readOnboardingApiKeyPresence(ctx) {
  const bridge = globalThis.dshOnboarding
  if (typeof bridge?.hasApiKey === 'function') return bridge.hasApiKey()
  if (!globalThis.dshDesktopSetup) throw new Error('desktop login bridge unavailable')
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const [settings, providers] = await Promise.all([ctx.remote.settings.describe(), ctx.remote.llm.listConfigurableProviders()])
  if (!settings.ok || !record(settings.value) || !Array.isArray(settings.value.namespaces)
    || !providers.ok || !Array.isArray(providers.value)) throw new Error('desktop onboarding: credential directory unavailable')
  const namespaces = settings.value.namespaces
  const official = namespaces.find(item => record(item) && item.ns === 'llm-deepseek')
  if (official !== undefined && (!record(official.value) || typeof official.value.apiKeyEnv !== 'string')) {
    throw new Error('desktop onboarding: invalid official credential reference')
  }
  const refs = official === undefined ? [] : [official.value.apiKeyEnv]
  for (const provider of providers.value) {
    if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) {
      throw new Error('desktop onboarding: invalid provider address')
    }
    let value = namespaces.find(item => record(item) && item.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      if (typeof key !== 'string') throw new Error('desktop onboarding: invalid provider path')
      value = record(value) ? value[key] : undefined
    }
    if (record(value) && typeof value.apiKeyEnv === 'string') refs.push(value.apiKeyEnv)
  }
  const unique = [...new Set(refs)]
  const states = {}
  for (let offset = 0; offset < unique.length; offset += 64) {
    const result = await ctx.remote.credentials.describe(unique.slice(offset, offset + 64))
    if (!result.ok || !record(result.value)) throw new Error('desktop onboarding: credential metadata unavailable')
    Object.assign(states, result.value)
  }
  for (const ref of unique) {
    if (!record(states[ref]) || typeof states[ref].configured !== 'boolean') {
      throw new Error('desktop onboarding: missing credential metadata')
    }
  }
  return unique.some(ref => states[ref].configured)
}

function patchPackage(name, edit, entry = () => 'lib/client.js') {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-client-seam-'))
  try {
    execFileSync('tar', ['-xzf', join(root, `vendor/dsh-runtime/${version}/deepseek-ai-${name}-${version}.tgz`), '-C', temp])
    const cwd = join(temp, 'package')
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    git('init', '-q')
    git('add', '.')
    const file = entry(cwd)
    const source = readFileSync(join(cwd, file), 'utf8')
    const code = new MagicString(source)
    const once = (before, after) => {
      const at = source.indexOf(before)
      assert.ok(at >= 0 && source.indexOf(before, at + before.length) === -1, `${name}: expected unique ${before}`)
      code.overwrite(at, at + before.length, after)
    }
    const replaceFunction = (name, replacement) => {
      const nodes = []
      const visit = node => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) nodes.push(node)
        ts.forEachChild(node, visit)
      }
      const parsed = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      visit(parsed)
      assert.equal(nodes.length, 1, name)
      code.overwrite(nodes[0].getStart(parsed), nodes[0].end, replacement)
    }
    const append = (file, text) => writeFileSync(join(cwd, file), `${readFileSync(join(cwd, file), 'utf8')}\n${text}\n`)
    edit({ once, replaceFunction, append, cwd })
    if (existsSync(join(cwd, `${file}.map`))) {
      const map = remapping([JSON.parse(code.generateMap({ file, source: file, hires: true }).toString()),
        JSON.parse(readFileSync(join(cwd, `${file}.map`), 'utf8'))], () => null)
      writeFileSync(join(cwd, `${file}.map`), JSON.stringify(map))
    }
    writeFileSync(join(cwd, file), code.toString())
    const diff = git('diff', '--no-ext-diff', '--binary')
    assert.ok(diff.length > 0)
    writeFileSync(join(root, `patches/${name}@${version}.patch`), diff)
    console.log(`${name}: generated Desktop patch (existing source map composed when present)`)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

patchPackage('dsh-client-ui-settings-account', ({ once, replaceFunction, append }) => {
  const body = onboarding.toString().slice(onboarding.toString().indexOf('{') + 1, -1)
  once('function DesktopOnboardingEntry(', `${body}\nfunction OfficialDesktopOnboardingEntry(`)
  once('className:OnboardingSurface_module_css_default.onboardingOverlay,',
    'className:OnboardingSurface_module_css_default.onboardingOverlay,"data-desktop-onboarding-surface":"",')
  once('id:`desktop-onboarding`,locale:', 'id:`desktop-onboarding`,children:{"onboarding.desktop.before":{kind:"single",scope:"root"}},locale:')
  once('inject:()=>({hooks:{account:operations.hooks.account,onboarding:',
    'inject:()=>({openDesktopLogin:()=>operations.showLogin(true),hooks:{account:operations.hooks.account,onboarding:')
  replaceFunction('readOnboardingApiKeyPresence', readOnboardingApiKeyPresence.toString())
  once('operations.hooks.account,readOnboardingApiKeyPresence,', 'operations.hooks.account,()=>readOnboardingApiKeyPresence(ctx),')
  append('lib/types/client/index.d.ts', `import type { ReactNode as DesktopNode } from 'react';
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'onboarding.desktop.before': { kind: 'single'; scope: 'root'; owner: {
      accountStatus: 'loading' | 'error' | 'signed-out' | 'credential-stored';
      openLogin(): void;
      renderSurface(children: DesktopNode): DesktopNode;
      renderNavigation(options: { busy: boolean; onBack?: (() => void) | undefined; onSkip(): void }): DesktopNode;
      renderLoading(): DesktopNode;
      renderNext(): DesktopNode;
    } };
  }
}`)
})

patchPackage('dsh-client-ui-plugin-manager', ({ once, append }) => {
  once('const SLOTS=[', 'const SLOTS=[`plugins.bundle.hidden`,`plugins.item.hidden`,')
  once('let ledger={items:[],', 'let ledger={items:[],hiddenBundles:new Set,hiddenItems:new Set,')
  once('bundles:keysOf(`plugins.bundle.config`)', 'hiddenBundles:keysOf(`plugins.bundle.hidden`),hiddenItems:keysOf(`plugins.item.hidden`),bundles:keysOf(`plugins.bundle.config`)')
  once('const listed=state.packages.filter(pkg=>!HIDDEN_BUNDLES', 'const available=state.packages.filter(pkg=>!HIDDEN_BUNDLES')
  once('const mine=listed.filter', 'const listed=available.filter(pkg=>!ledger.hiddenBundles.has(pkg.name));const mine=listed.filter')
  once('?listed.find(pkg=>pkg.name===view.name)', '?available.find(pkg=>pkg.name===view.name)')
  once('const basicCards=ledger.items.map(', 'const basicCards=ledger.items.filter(item=>!ledger.hiddenItems.has(item.id)).map(')
  once('children:{"plugins.add.actions":', 'children:{"plugins.overview":{kind:"list",scope:"root"},"plugins.bundle.hidden":{kind:"keyed",scope:"root"},"plugins.item.hidden":{kind:"keyed",scope:"root"},"plugins.add.actions":')
  once('installedCards&&!loaded?', `onInstalled&&showsMainList&&loaded?renderSlot('plugins.overview', {
    onOpenBundle: name => {
      if (!available.some(pkg => pkg.name === name)) return;
      setActivation(null); setView({kind:'package',name});
    },
    onOpenItem: id => {
      if (!ledger.items.some(item => item.id === id)) return;
      setActivation(null); setView({kind:'item',id});
    }
  }):null,installedCards&&!loaded?`)
  // Stable markers keep native titlebar styling independent of upstream's CSS hash.
  once('className:PluginManagerPage_module_css_default.detailTop,', 'className:PluginManagerPage_module_css_default.detailTop,"data-plugin-page-header":"detail",')
  once('className:PluginManagerPage_module_css_default.pageHead,', 'className:PluginManagerPage_module_css_default.pageHead,"data-plugin-page-header":"list",')
  append('lib/types/client/slot-contract.d.ts', `declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.overview': { kind: 'list'; scope: 'root'; owner: {
      onOpenBundle(name: string): void;
      onOpenItem(id: string): void;
    } };
    'plugins.bundle.hidden': { kind: 'keyed'; scope: 'root' };
    'plugins.item.hidden': { kind: 'keyed'; scope: 'root' };
  }
}`)
})

// Plugins can still deliver a damaged in-memory draft to the editor, outside the persisted-draft decoder.
patchPackage('dsh-client-ui-conversation', ({ once }) => {
  once('function resolveDraftInput(input){', `function resolveDraftInput(input){
    if (typeof input !== 'string' && (typeof input !== 'object' || input === null
      || typeof input.text !== 'string' || !Array.isArray(input.references))) {
      return {text: typeof input?.text === 'string' ? input.text : '', references: []};
    }
  `)
  once('setDraft(text){const clean=text.replace(REFERENCE_PLACEHOLDER_RE,',
    'setDraft(text){const clean=(typeof text === "string" ? text : "").replace(REFERENCE_PLACEHOLDER_RE,')
})

// The hosted Chromium inspector still supplies a no-op embedder callback; Reload otherwise never completes.
patchPackage('dsh-experimental-inspector', ({ once }) => {
  once('reattach(e) {}', 'reattach(e) { e(); }')
}, cwd => {
  const folder = 'lib/devtools/chunks'
  const matches = readdirSync(join(cwd, folder)).filter(file => /^legacy-.*\.js$/u.test(file)
    && readFileSync(join(cwd, folder, file), 'utf8').includes('reattach(e) {}'))
  assert.equal(matches.length, 1, 'official inspector embedder chunk')
  return `${folder}/${matches[0]}`
})

// Preserve master’s program-directory protection, owner-grant repair and existing-entry labeling alongside Electron’s console bootstrap.
patchPackage('dsh-sandbox-windows-acl', ({ once, cwd }) => {
  const typesFile = readdirSync(join(cwd, 'lib')).find(file => /^types-.*\.js$/u.test(file))
  assert.ok(typesFile)
  const desktopPatch = readFileSync(join(root, 'patches/dsh-sandbox-windows-acl@0.2.2-rc.3.patch'), 'utf8')
  const aclPatch = desktopPatch.slice(desktopPatch.indexOf('diff --git a/lib/types-')).replaceAll('types-DXWX0PXB.js', typesFile)
  execFileSync('git', ['apply', '-'], { cwd, input: aclPatch })
  once('import { join } from "node:path";', 'import { join } from "node:path";\nimport { spawn } from "node:child_process";\nimport { createRequire } from "node:module";')
  once('async function main() {', readFileSync(new URL('./windows-console-bootstrap.js', import.meta.url), 'utf8') + '\nasync function main() {')
  once('const api = await win32();', 'await ensureConsoleHost();\n\tconst api = await win32();')
}, () => 'lib/runner.js')

// These master fixes remain necessary in rc.2; upstream has not absorbed them.
patchPackage('dsh-sandbox-local', ({ once }) => {
  once('import { join } from "node:path";', 'import { dirname, join } from "node:path";')
  once('args.push("--tmpfs", "/tmp");', 'args.push("--tmpfs", "/tmp");\n\t\t// Preserve the read-only AppImage runner mount beneath the masked /tmp.\n\t\tconst executableDir = dirname(process.execPath);\n\t\tif (executableDir.startsWith("/tmp/")) args.push("--ro-bind", executableDir, executableDir);')
  once('const existing = this.tempCapabilities.get(key);\n\t\tif (existing !== void 0) return existing;',
    'const existing = this.tempCapabilities.get(key);\n\t\tif (existing !== void 0) {\n\t\t\tif (existsSync(existing.dir)) return existing;\n\t\t\tthis.tempCapabilities.delete(key);\n\t\t\tthis.ctx.logger.warn(`sandbox-local: windows-acl private temp ${existing.dir} was removed; creating a new one`);\n\t\t\ttry { existing.grant.dispose(); } catch (error) { this.ctx.logger.warn(error); }\n\t\t}');
}, () => 'lib/index.js')

patchPackage('dsh-experimental-client-ui-cot-translation', ({ once }) => {
  once('if(!initial.ok)throw initial.error;', 'if(!initial.ok&&initial.error?.code===`remote-access/denied`)return;if(!initial.ok)throw initial.error;')
})
patchPackage('dsh-client-ui-plugin-recommendations', ({ once }) => {
  once('const inject=[`locale`,`remote`,`actionCards`,`pluginNavigation`];',
    'const inject=[`locale`,`remote`,`actionCards`,`pluginNavigation`];if(globalThis.__DSH_LIVESHARE_VIEWER__!==void 0)inject.splice(inject.indexOf(`pluginNavigation`),1);')
  once('ctx.pluginNavigation.openBundle(packageName)', 'if(globalThis.__DSH_LIVESHARE_VIEWER__!==void 0)return;ctx.pluginNavigation.openBundle(packageName)')
})
patchPackage('dsh-client-ui-schedule', ({ once }) => {
  once('className:TaskManagerPage_module_css_default.pageHeading,', 'className:TaskManagerPage_module_css_default.pageHeading,"data-window-drag":true,')
})
patchPackage('dsh-client-ui-open-in-app', ({ once }) => {
  once('gnometerminal:`app.gnometerminal`,', 'gnometerminal:`app.gnometerminal`,ptyxis:`app.ptyxis`,gnomeconsole:`app.gnomeconsole`,')
  once('"app.gnometerminal":`GNOME Terminal`,', '"app.gnometerminal":`GNOME Terminal`,"app.ptyxis":`Ptyxis`,"app.gnomeconsole":`GNOME Console`,')
})
// The Tokens Anywhere page edits its routes with the official catalog and retry editors, under each protocol's reasoning rules.
patchPackage('dsh-client-ui-settings-models', ({ once }) => {
  once('const injected=()=>({controller,hooks:{snapshot:controller.store},operations,schema,t});',
    'const injected=()=>({controller,hooks:{snapshot:controller.store},operations,schema,t,desktopCatalog:{ModelListEditor,EditorFooter,modelDrafts,validateDeepSeekModels,validateReasoningEfforts,reasoningLevelChoices,protocolReasoningLevels,RetryPolicyEditor,retryPolicyDefaults,retryPolicyFailure}});')
})
