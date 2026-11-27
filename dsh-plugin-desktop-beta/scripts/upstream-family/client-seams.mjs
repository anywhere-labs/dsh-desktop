/** Reproduce the rc.2 Desktop UI seams from the untouched, vendored official packages.
 * Run with Node from any directory. Every edit must match once; changed upstream bytes fail closed.
 * Existing official views and their controllers remain the owners of onboarding and plugin management.
 */
import assert from 'node:assert/strict'
import { localizeInstalledDialog } from './localize-install.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OFFICIAL_CONNECTORS, OFFICIAL_OAR_SUBAGENTS } from '../../src/upstream-family-labels.ts'

const root = resolve(import.meta.dirname, '../../..')
const require = createRequire(join(root, 'dsh-plugin-desktop-beta/package.json'))
// The existing Vite toolchain supplies the source-map editor and composer.
const MagicString = require('magic-string')
const remapping = require('@jridgewell/remapping')
const ts = require('typescript')
const version = '0.2.3-alpha.2'
/** The languages official catalog entries carry, as upstream's catalog generator requires them. */
const CATALOG_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh']

/**
 * Read a connector's catalog entry from its vendored tarball, as upstream's catalog generator reads an on-demand
 * bundle: its localized title and description, and its icon as a data URI. No provider code is evaluated.
 */
function connectorCatalogEntry(name) {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-client-seam-catalog-'))
  try {
    execFileSync('tar', ['-xzf', join(root, `vendor/dsh-runtime/${version}/deepseek-ai-${name.slice('@deepseek-ai/'.length)}-${version}.tgz`), '-C', temp])
    const dir = join(temp, 'package')
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(manifest.name, name)
    assert.ok(manifest.dsh?.bundle?.patch !== undefined && manifest.dsh.bundle.platforms === undefined, `${name}: expected a bundle for every platform`)
    assert.ok(typeof manifest.icon === 'string' && manifest.icon.endsWith('.svg'), `${name}: expected an SVG icon`)
    const title = {}
    const description = {}
    for (const language of CATALOG_LANGUAGES) {
      const { meta } = JSON.parse(readFileSync(join(dir, 'locale', `${language}.json`), 'utf8'))
      assert.ok(typeof meta?.title === 'string' && meta.title.trim() !== '' && typeof meta.description === 'string'
        && meta.description.trim() !== '', `${name}: expected ${language} title and description`)
      title[language] = meta.title
      description[language] = meta.description
    }
    const icon = `data:image/svg+xml;base64,${readFileSync(join(dir, manifest.icon)).toString('base64')}`
    return { packageName: name, meta: { title, description, icon } }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

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

// One body element scrolls every view of the Plugins page, and upstream leaves its position to whatever the last view
// left. Each view's position is recorded as the body scrolls, so a deeper view (a plugin's page, a component row's
// page, a More list) returns to the place its parent view was left at.
function desktopScrollMemory() {
  const positions = new Map()
  let body = null
  let key
  let depth = 0
  const record = () => { if (body !== null && key !== undefined) positions.set(key, body.scrollTop) }
  return {
    ref: element => {
      body?.removeEventListener('scroll', record)
      body = element
      body?.addEventListener('scroll', record, { passive: true })
    },
    view: (next, nextDepth) => {
      const back = key !== undefined && nextDepth < depth
      key = next
      depth = nextDepth
      // A view left before it was ever scrolled was left at its top.
      if (back && body !== null) body.scrollTop = positions.get(next) ?? 0
    },
  }
}

// The official sidebar keeps its pin choices in memory, so every launch shows its entries again. Desktop keeps them
// with the official store's localStorage persistence under a key of its own; a stored value other than a list of
// panel ids is dropped before the store reads it.
function desktopPanelPinsPersistence() {
  if (typeof localStorage === 'undefined') return undefined
  const name = 'dsh-desktop.sidebar.panel-pins'
  try {
    const raw = localStorage.getItem(name)
    const value = raw === null ? null : JSON.parse(raw)
    if (raw !== null && !(Array.isArray(value?.unpinned) && value.unpinned.every(id => typeof id === 'string'))) localStorage.removeItem(name)
  } catch {
    // An unparsable value is dropped as well; storage that refuses even that keeps the choices in memory.
    try { localStorage.removeItem(name) } catch { return undefined }
  }
  return { persist: { name } }
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

// An anchor inset wrapped in max() is no longer a linear function of anchor(top). Blink compensates a scrolling
// anchor after layout, so the clamp keeps an upward popover at 12px and it drifts away from its trigger as the
// conversation above it scrolls. Upstream's ModelSelect.module.css keeps its insets linear for the same reason.
const LINEAR_CHAT_INSETS = [
  ['top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:max(12px, calc(anchor(top) + 8px));left:max(12px, anchor(left));',
    'top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:calc(anchor(top) + 8px);left:max(12px, anchor(left));'],
  ['top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:max(12px, calc(anchor(top) + 8px));left:12px;right:12px;margin:0',
    'top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:calc(anchor(top) + 8px);left:12px;right:12px;margin:0'],
]
// The same clamp in the menu primitives, and in the frontend build that bundles their stylesheet.
const LINEAR_MENU_INSETS = [
  ['[data-anchor-side=top]{top:var(--dsh-menu-window-top);bottom:max(12px, calc(anchor(top) + 4px));',
    '[data-anchor-side=top]{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);'],
  ['@position-try --dsh-menu-above{top:var(--dsh-menu-window-top);bottom:max(12px, calc(anchor(top) + 4px));',
    '@position-try --dsh-menu-above{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);'],
  ['@position-try --dsh-menu-wide-above{top:var(--dsh-menu-window-top);bottom:max(12px, calc(anchor(top) + 4px));',
    '@position-try --dsh-menu-wide-above{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);'],
]
const linearAnchors = (edits, { once }) => { for (const [before, after] of edits) once(before, after) }

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
  once('function SubjectCard(', `${localizeInstalledDialog.toString()}\nfunction SubjectCard(`)
  once('title:confirmed?.title??subject.name??subject.spec', 'title:subject.displayTitle??confirmed?.title??subject.name??subject.spec')
  once('install:state.install,t,onClose:props.closeInstall', 'install:localizeInstalledDialog(state.install,state.packages,resolveText),t,onClose:props.closeInstall')
  once('const SLOTS=[', 'const SLOTS=[`plugins.group`,`plugins.bundle.hidden`,`plugins.item.hidden`,')
  once('let ledger={items:[],', 'let ledger={items:[],groups:[],hiddenBundles:new Set,hiddenItems:new Set,')
  // A Desktop group names its member bundles, in page order, through the face its registration injects.
  once('bundles:keysOf(`plugins.bundle.config`)', 'groups:ctx.slots.entries(`plugins.group`).map(entry=>({id:entry.options.id??``,label:(0,_deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(entry.options.label)??``,bundles:[...entry.inject?.().bundles??[]]})),hiddenBundles:keysOf(`plugins.bundle.hidden`),hiddenItems:keysOf(`plugins.item.hidden`),bundles:keysOf(`plugins.bundle.config`)')
  once('const listed=state.packages.filter(pkg=>!HIDDEN_BUNDLES', 'const available=state.packages.filter(pkg=>!HIDDEN_BUNDLES')
  once('const mine=listed.filter', 'const desktopGroupBundles=new Set(ledger.groups.flatMap(group=>group.bundles));const listed=available.filter(pkg=>!ledger.hiddenBundles.has(pkg.name));const mine=listed.filter')
  // Group members leave the official groups and More list; a group's own section and More page draw the official cards.
  once('const official=listed.filter(pkg=>pkg.official)', 'const official=listed.filter(pkg=>pkg.official&&!desktopGroupBundles.has(pkg.name))')
  once('?listed.find(pkg=>pkg.name===view.name)', '?available.find(pkg=>pkg.name===view.name)')
  once('const more=ordered;', 'const more=ordered;const desktopGroups=ledger.groups.map(group=>({...group,packages:group.bundles.flatMap(name=>listed.filter(pkg=>pkg.name===name))})).filter(group=>group.packages.length>0);const openGroup=view.group===void 0?void 0:desktopGroups.find(group=>group.id===view.group);')
  // The main list shows a group like the official experimental group: its title, More, and the members the profile enabled.
  once('return(0,react_jsx_runtime.jsxs)(`section`,{className:PluginManagerPage_module_css_default.page,', 'const renderDesktopGroup=group=>{const cards=group.packages.filter(pkg=>pkg.enabled).map(packageCard);return(0,react_jsx_runtime.jsxs)(`section`,{className:PluginManagerPage_module_css_default.group,"data-plugin-scope":`global`,"data-plugin-group":`desktop-${group.id}`,children:[(0,react_jsx_runtime.jsxs)(`div`,{className:PluginManagerPage_module_css_default.groupHead,children:[(0,react_jsx_runtime.jsx)(`h3`,{className:PluginManagerPage_module_css_default.groupTitle,children:group.label}),(0,react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button,{size:`sm`,className:PluginManagerPage_module_css_default.groupMore,onClick:()=>{setView({kind:`more`,group:group.id})},children:[t(`moreAction`),(0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular,{size:14,"aria-hidden":`true`})]})]}),cards.length>0?(0,react_jsx_runtime.jsx)(`ul`,{className:PluginManagerPage_module_css_default.cards,children:cards}):null]},`desktop-group:${group.id}`)};return(0,react_jsx_runtime.jsxs)(`section`,{className:PluginManagerPage_module_css_default.page,')
  once('renderGroup(`basic`,t(`basicTitle`),basicCards)', 'desktopGroups.map(renderDesktopGroup),renderGroup(`basic`,t(`basicTitle`),basicCards)')
  // A group's More page is the official one with the group's title, its notice and its members.
  once('children:t(`moreTitle`)', 'children:openGroup!==void 0?openGroup.label:t(`moreTitle`)')
  once('children:(0,react_jsx_runtime.jsx)(`ul`,{className:PluginManagerPage_module_css_default.cards,children:more.map(packageCard)})', 'children:(0,react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment,{children:[openGroup===void 0?null:renderSlot(`plugins.group`,{group:openGroup.id},{only:openGroup.id}),(0,react_jsx_runtime.jsx)(`ul`,{className:PluginManagerPage_module_css_default.cards,children:(openGroup===void 0?more:openGroup.packages).map(packageCard)})]})')
  // A member's page and its rows return to the group's More page, which the breadcrumb names.
  once('name:pkg.name,...showsMoreList?{from:`more`}:{}', 'name:pkg.name,...showsMoreList?{from:`more`,...openGroup===void 0?{}:{group:openGroup.id}}:{}')
  once('name:activated.name,...showsMoreList?{from:`more`}:{}', 'name:activated.name,...showsMoreList?{from:`more`,...openGroup===void 0?{}:{group:openGroup.id}}:{}')
  once('backToMore?{from:`more`}:{}', 'backToMore?{from:`more`,...openGroup===void 0?{}:{group:openGroup.id}}:{}')
  once('setView({kind:backToMore?`more`:`list`})', 'setView({kind:backToMore?`more`:`list`,...backToMore&&openGroup!==void 0?{group:openGroup.id}:{}})')
  once('inMore:backToMore,', 'inMore:backToMore,moreLabel:backToMore&&openGroup!==void 0?openGroup.label:void 0,')
  once('renderFactory,inMore,versions,detail,onBack', 'renderFactory,inMore,moreLabel,versions,detail,onBack')
  once('{name:t(`moreTitle`)}', '{name:moreLabel??t(`moreTitle`)}')
  once('crumbText:t(inMore?`moreTitle`:`crumbRoot`)', 'crumbText:inMore&&moreLabel!==void 0?moreLabel:t(inMore?`moreTitle`:`crumbRoot`)')
  // The OAR subagents Desktop lists among its Beta plugins keep the Experimental tag the official cards draw.
  if (OFFICIAL_OAR_SUBAGENTS !== undefined) once('const EXPERIMENTAL_BUNDLES=new Set([', `const EXPERIMENTAL_BUNDLES=new Set([\`${OFFICIAL_OAR_SUBAGENTS.bundle}\`,`)
  once('const basicCards=ledger.items.map(', 'const basicCards=ledger.items.filter(item=>!ledger.hiddenItems.has(item.id)).map(')
  once('children:{"plugins.add.actions":', 'children:{"plugins.overview":{kind:"list",scope:"root"},"plugins.group":{kind:"list",scope:"root"},"plugins.bundle.hidden":{kind:"keyed",scope:"root"},"plugins.item.hidden":{kind:"keyed",scope:"root"},"plugins.add.actions":')
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
  // Returning from a deeper view restores the scroll position of the list, More page or tab it was opened from.
  once('function PluginManagerPage(props){', `${desktopScrollMemory}\nfunction PluginManagerPage(props){`)
  once('const[headerRef]=(0,react.useState)(props.createHeaderRef);', 'const[headerRef]=(0,react.useState)(props.createHeaderRef);const[desktopScroll]=(0,react.useState)(desktopScrollMemory);')
  once('const installedPanel=', 'const desktopScrollView=showsMoreList?[`more:${view.group??``}`,1]:showsMainList?[`list:${tab}`,0]:openRow!==void 0?[`row:${view.name}:${view.rowId}`,3]:openPkg!==void 0?[`package:${view.name}`,2]:[`item:${view.id}`,2];(0,react.useLayoutEffect)(()=>{desktopScroll.view(...desktopScrollView)},desktopScrollView);const installedPanel=')
  once('"data-plugin-body":true,', '"data-plugin-body":true,ref:desktopScroll.ref,')
  append('lib/types/client/slot-contract.d.ts', `declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.overview': { kind: 'list'; scope: 'root'; owner: {
      onOpenBundle(name: string): void;
      onOpenItem(id: string): void;
    } };
    'plugins.bundle.hidden': { kind: 'keyed'; scope: 'root' };
    'plugins.item.hidden': { kind: 'keyed'; scope: 'root' };
    /** A group of bundles with its own section and More page; the entry renders the notice above its cards and injects \`{ bundles }\`, its members in order. */
    'plugins.group': { kind: 'list'; scope: 'root'; owner: { group: string } };
  }
}`)
})

// Pinning or unpinning a sidebar entry survives a restart of the application.
patchPackage('dsh-client-ui-sidebar', ({ once }) => {
  once('function createPanelPins(){', `${desktopPanelPinsPersistence}\nfunction createPanelPins(){`)
  once('createSnapshotStore)({unpinned:NO_PANELS})', 'createSnapshotStore)({unpinned:NO_PANELS},desktopPanelPinsPersistence())')
})

// The official connector plugins the release publishes without listing them install on demand like the official
// subagents, and leave a Profile updated to another release as those do.
if (OFFICIAL_CONNECTORS !== undefined) {
  patchPackage('dsh-official-bundles', ({ once }) => {
    const entries = OFFICIAL_CONNECTORS.map(name => JSON.stringify(connectorCatalogEntry(name), null, '\t')).join(', ')
    once('}];\n//#endregion\nexport {', `}];\n// DSH Desktop offers the official connector plugins this release publishes without listing them.\nOFFICIAL_ON_DEMAND_CATALOG.push(${entries});\nON_DEMAND_BUNDLES.push(${OFFICIAL_CONNECTORS.map(name => JSON.stringify(name)).join(', ')});\n//#endregion\nexport {`)
  }, () => 'lib/index.js')
}

// Plugins can still deliver a damaged in-memory draft to the editor, outside the persisted-draft decoder.
patchPackage('dsh-client-ui-conversation', ({ once }) => {
  once('function resolveDraftInput(input){', `function resolveDraftInput(input){
    if (typeof input !== 'string' && (typeof input !== 'object' || input === null
      || typeof input.text !== 'string' || !Array.isArray(input.references))) {
      return {text: typeof input?.text === 'string' ? input.text : '', references: []};
    }
  `)
  once('setDraft(text,undoable=false){const clean=text.replace(REFERENCE_PLACEHOLDER_RE,',
    'setDraft(text,undoable=false){const clean=(typeof text === "string" ? text : "").replace(REFERENCE_PLACEHOLDER_RE,')
  // The ContextMeter's panel and position fallback above the sticky composer follow the anchor linearly.
  linearAnchors(LINEAR_CHAT_INSETS, { once })
})

// The StatsPills dialog's panel and its position fallback above the composer follow the anchor linearly.
patchPackage('dsh-client-ui-chat', edit => linearAnchors(LINEAR_CHAT_INSETS, edit))

patchPackage('dsh-client-ui-approval', ({ once }) => {
  once('position-area:none;top:var(--dsh-warning-window-top);bottom:max(12px, calc(anchor(top) + 8px));left:12px;right:max(12px, anchor(',
    'position-area:none;top:var(--dsh-warning-window-top);bottom:calc(anchor(top) + 8px);left:12px;right:max(12px, anchor(')
})

// Menus that open above their trigger, and the wide variant, keep the inset linear too.
patchPackage('dsh-client-ui-primitives', edit => linearAnchors(LINEAR_MENU_INSETS, edit), () => 'lib/index.js')

// The published frontend bundles the primitives' stylesheet into its entry chunk.
patchPackage('dsh-web-frontend', edit => linearAnchors(LINEAR_MENU_INSETS, edit), cwd => {
  const folder = 'dist/assets'
  const matches = readdirSync(join(cwd, folder)).filter(file => /^index-.*\.js$/u.test(file)
    && readFileSync(join(cwd, folder, file), 'utf8').includes('--dsh-menu-wide-above'))
  assert.equal(matches.length, 1, 'official web frontend entry chunk')
  return `${folder}/${matches[0]}`
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
  const desktopPatch = readFileSync(join(root, `patches/dsh-sandbox-windows-acl@${version}.patch`), 'utf8')
  const aclPatch = desktopPatch.slice(desktopPatch.indexOf('diff --git a/lib/types-')).replaceAll('types-DXWX0PXB.js', typesFile)
  execFileSync('git', ['apply', '-'], { cwd, input: aclPatch })
  once('import { join } from "node:path";', 'import { join } from "node:path";\nimport { spawn } from "node:child_process";\nimport { createRequire } from "node:module";')
  once('async function main() {', readFileSync(new URL('./windows-console-bootstrap.js', import.meta.url), 'utf8') + '\nasync function main() {')
  once('const api = await win32();', 'await ensureConsoleHost();\n\tconst api = await win32();')
}, () => 'lib/runner.js')

// These master fixes remain necessary in rc.2; upstream has not absorbed them. Each edit only inserts lines.
patchPackage('dsh-sandbox-local', ({ once }) => {
  once('import { join } from "node:path";', 'import { join } from "node:path";\nimport { dirname } from "node:path";')
  once('args.push("--tmpfs", "/tmp");', 'args.push("--tmpfs", "/tmp");\n\t\t// Preserve the read-only AppImage runner mount beneath the masked /tmp.\n\t\tconst executableDir = dirname(process.execPath);\n\t\tif (executableDir.startsWith("/tmp/")) args.push("--ro-bind", executableDir, executableDir);')
  // A removed private temp is recreated rather than handed out again; the upstream line becomes the else branch.
  once('const existing = this.tempCapabilities.get(key);\n\t\tif (existing !== void 0) return existing;',
    'const existing = this.tempCapabilities.get(key);\n\t\tif (existing !== void 0 && !existsSync(existing.dir)) {\n\t\t\tthis.tempCapabilities.delete(key);\n\t\t\tthis.ctx.logger.warn(`sandbox-local: windows-acl private temp ${existing.dir} was removed; creating a new one`);\n\t\t\ttry { existing.grant.dispose(); } catch (error) { this.ctx.logger.warn(error); }\n\t\t} else\n\t\tif (existing !== void 0) return existing;');
}, () => 'lib/index.js')

patchPackage('dsh-experimental-client-ui-cot-translation', ({ once }) => {
  once('if(!initial.ok)throw initial.error;', 'if(!initial.ok&&initial.error?.code===`remote-access/denied`)return;if(!initial.ok)throw initial.error;')
})
// dsh 0.2.3 plugin recommendations inject `pluginNavigation` only for the card body, so a LiveShare reader's page
// activates them without a Desktop patch.
patchPackage('dsh-client-ui-schedule', ({ once }) => {
  once('className:TaskManagerPage_module_css_default.pageHeading,', 'className:TaskManagerPage_module_css_default.pageHeading,"data-window-drag":true,')
})
patchPackage('dsh-client-ui-open-in-app', ({ once }) => {
  once('gnometerminal:`app.gnometerminal`,', 'gnometerminal:`app.gnometerminal`,ptyxis:`app.ptyxis`,gnomeconsole:`app.gnomeconsole`,')
  once('"app.gnometerminal":`GNOME Terminal`,', '"app.gnometerminal":`GNOME Terminal`,"app.ptyxis":`Ptyxis`,"app.gnomeconsole":`GNOME Console`,')
})
