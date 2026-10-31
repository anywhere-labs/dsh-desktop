import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = ['0.2.1-rc.3', '0.2.1-rc.5', '0.2.2-alpha.2'];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const t = (key, args) => args === undefined ? key : `${key}:${JSON.stringify(args)}`;
const noop = () => {};

// Execute the actual patched browser bundle, not copied functions or patch-text assertions.
// The lightweight hook seat keeps state between explicit renders without a DOM/Electron.
function harness(version) {
  if (process.env.DSH_TEST_INSTALLED_MULTI_ROOT === '1') {
    const channel = { '0.2.1-rc.3': 'dsh-plugin-desktop', '0.2.1-rc.5': 'dsh-desktop-next', '0.2.2-alpha.2': 'dsh-plugin-desktop-beta' }[version];
    const require = createRequire(path.join(root, channel, 'package.json'));
    const manifest = require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json');
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, version);
    return browserHarness(readFileSync(path.join(path.dirname(manifest), 'lib/client.js'), 'utf8'));
  }
  const temporary = mkdtempSync(path.join(tmpdir(), 'dsh-multi-root-ui-'));
  let code;
  try {
    execFileSync('tar', ['-xzf', path.join(root, 'vendor/dsh-runtime', version, `deepseek-ai-dsh-client-ui-workspace-${version}.tgz`), '-C', temporary]);
    execFileSync('git', ['apply', '--check', path.join(root, 'patches', `dsh-client-ui-workspace@${version}.patch`)], { cwd: path.join(temporary, 'package') });
    execFileSync('git', ['apply', path.join(root, 'patches', `dsh-client-ui-workspace@${version}.patch`)], { cwd: path.join(temporary, 'package') });
    code = readFileSync(path.join(temporary, 'package/lib/client.js'), 'utf8');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return browserHarness(code);
}

function browserHarness(code) {
  let cursor = 0;
  const seats = [];
  const effects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in seats)) seats[index] = typeof initial === 'function' ? initial() : initial;
      return [seats[index], (value) => { seats[index] = typeof value === 'function' ? value(seats[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return seats[index] ??= { current: initial };
    },
    useMemo(factory) { return factory(); },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      previous?.cleanup?.();
      effects[index] = { deps, cleanup: fn() };
    },
    Fragment: 'Fragment',
    Component: class {},
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const primitives = new Proxy({ useRowDragPreview: () => ({ start: noop, clear: () => false }) }, { get: (object, key) => key in object ? object[key] : key });
  const require = (id) => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    if (id === '@deepseek-ai/cordis') return { Service: class {} };
    return {};
  };
  let api;
  const document = { querySelector: () => ({}), addEventListener: noop, removeEventListener: noop };
  const window = { setTimeout, clearTimeout, addEventListener: noop, removeEventListener: noop,
    __ModuleLoader__: { load({ factory }) { api = factory(require).__test; } } };
  const expose = 'exports.__test = { workspaceRoots, folderRefusal, WorkspacePickFlow, WorkspacePicker, WorkspaceBrowser, ProjectRowItem, FolderRowItem, SessionTree, deriveGroups };\n';
  assert.ok(code.includes('return module.exports;'));
  vm.runInNewContext(code.replace('return module.exports;', `${expose}return module.exports;`), { window, document, Error, setTimeout, clearTimeout, console });
  return {
    api,
    render(component, props) { cursor = 0; return component(props); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

function nodes(tree, predicate) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!('type' in value && 'props' in value)) return;
    if (predicate(value)) found.push(value);
    Object.values(value.props).forEach(visit);
  };
  visit(tree);
  return found;
}
function pickFlow(h, overrides = {}) {
  let owner;
  const props = {
    t, open: false, useWorkspaces: (select) => select({ items: [], phase: 'ready' }),
    createWorkspace: async () => ({ workspaceId: 'w' }),
    setWorkspaceRoots: async () => {}, useDirectoryFlow: (select) => select(true),
    renderDirectoryFlow(value) { owner = value; return null; }, onPick: noop, onClose: noop,
    ...overrides,
  };
  return { props, render: () => h.render(h.api.WorkspacePickFlow, props), owner: () => owner };
}
function browser(h, overrides = {}) {
  const workspace = { workspaceId: 'w', path: '/one', roots: ['/one', '/two'], title: 'Project', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const snapshot = { items: [workspace], phase: 'ready', state: 'ready', archivedSessionIds: [], pinnedSessionIds: [] };
  const props = {
    t, wide: true, usePanelInfo: (select) => select({ activePanelId: null }),
    expandSidebar: noop, useSessions: (select) => select({ ids: [], byId: {} }),
    useSessionStatus: (select) => select({}), useRemoteAccess: () => true, useSessionAccess: () => true,
    useWorkspaceAccess: () => true, useWorkspaces: (select) => select(snapshot),
    useStore: (select) => select({ groupBy: 'workspace', orderBy: 'manual', groupExpansion: {}, sessionOrderByAccount: {} }),
    actions: new Proxy({}, { get: () => noop }), startSession: noop, open: noop,
    requestSessionRename: noop, notifyArchivedNotOpenable: noop, renameWorkspace: async () => {},
    deleteWorkspace: async () => {}, insertWorkspaceBefore: async () => {}, unarchiveSession: async () => {},
    createWorkspace: async () => workspace, searchSessions: async () => ({ items: [] }), searchResultLimit: 20,
    useDirectoryFlow: (select) => select(true), useHostInfo: (select) => select({ home: '/home' }),
    useShortcuts: (select) => select([]), useWorkspaceShortcuts: (select) => select({ searchRequest: 0, addRequested: false }),
    requestSearch: noop, requestAddWorkspace: noop, closeAddWorkspace: noop, setDirectoryBusy: noop,
    setWorkspaceRoots: async () => {}, renderSlot: (_slot, owner) => owner,
    ...overrides,
  };
  const render = () => h.render(h.api.WorkspaceBrowser, props);
  const treeProps = (tree) => nodes(tree, (node) => node.type === h.api.SessionTree)[0].props;
  const directoryOwner = (tree) => nodes(tree, (node) => node.type === h.api.WorkspacePickFlow)[0].props.renderDirectoryFlow({});
  return { render, treeProps, directoryOwner, snapshot, props };
}

for (const version of versions) {
  test(`${version}: old records, folder rows, badge and menu keep primary semantics`, () => {
    const h = harness(version);
    assert.deepEqual([...h.api.workspaceRoots({ path: '/old' })], ['/old']);
    assert.deepEqual([...h.api.workspaceRoots({ path: '/old', roots: [] })], ['/old']);
    assert.deepEqual([...h.api.workspaceRoots({ path: '/one', roots: ['/one', '/two'] })], ['/one', '/two']);
    const derived = h.api.deriveGroups({ ids: [], byId: {} }, [{ workspaceId: 'w', path: '/one', roots: ['/one', '/two'], sessionIds: [], title: 'Project', createdAt: '2026-01-01T00:00:00Z' }], { archivedSessionIds: [], pinnedSessionIds: [], archivedFilter: 'default' }, new Map(), { expandedGroups: ['w'] });
    assert.deepEqual([...derived[0].roots], ['/one', '/two']);
    const folder = h.api.FolderRowItem({ path: '/one', scopeKey: 'w', primary: true, t });
    assert.equal(folder.props.title, '/one');
    assert.ok(nodes(folder, (node) => node.props.children === 'folder.primary').length);
    let row = h.render(h.api.ProjectRowItem, { group: { workspaceId: 'w', key: 'w', roots: ['/one', '/two'], label: 'Project', expanded: true }, actions: { rename: noop, delete: noop, addFolder: noop, manageFolders: noop }, foldersAvailable: true, t, useWorkspaceAccess: () => true });
    while (typeof row.type === 'function') row = h.render(row.type, row.props);
    assert.ok(nodes(row, (node) => node.props.children === '+1').length);
    const menu = nodes(row, (node) => node.type === 'Menu')[0];
    assert.ok(menu.props.items.some((item) => item.id === 'addFolder'));
    assert.ok(menu.props.items.some((item) => item.id === 'manageFolders'));
    h.unmount();
  });

  test(`${version}: expanded tree shows every root and folding hides child folders`, () => {
    const h = harness(version);
    const ui = browser(h);
    const props = ui.treeProps(ui.render());
    const treeHost = harness(version);
    props.groupExpansion = { w: true };
    props.useSessionStatus = (select) => select(new Map());
    let tree = treeHost.render(treeHost.api.SessionTree, props);
    const folders = nodes(tree, (node) => node.type === treeHost.api.FolderRowItem);
    assert.deepEqual(folders.map((node) => node.props.path), ['/one', '/two']);
    assert.deepEqual(folders.map((node) => node.props.primary), [true, false]);
    props.groupExpansion = { w: false };
    tree = treeHost.render(treeHost.api.SessionTree, props);
    assert.equal(nodes(tree, (node) => node.type === treeHost.api.FolderRowItem).length, 0);
    treeHost.unmount(); h.unmount();
  });

  test(`${version}: multi-pick commits all roots before opening, coalesces repeats`, async () => {
    const h = harness(version);
    const calls = [];
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const flow = pickFlow(h, {
      createWorkspace: async ({ path }) => { calls.push(['create', path]); return { workspaceId: 'w' }; },
      setWorkspaceRoots: async (id, roots) => { calls.push(['roots', id, [...roots]]); await pending; },
      onPick: (id) => calls.push(['open', id]),
    });
    const wrapper = h.api.WorkspacePicker({ ...flow.props, renderSlot: noop });
    assert.equal(wrapper.props.setWorkspaceRoots, flow.props.setWorkspaceRoots);
    flow.render();
    flow.owner().onPickedDirectories(['/one', '/two']);
    flow.owner().onPickedDirectories(['/other']);
    await flush();
    assert.deepEqual(calls, [['create', '/one'], ['roots', 'w', ['/one', '/two']]]);
    finish(); await flush();
    assert.deepEqual(calls.at(-1), ['open', 'w']);
    h.unmount();
  });

  test(`${version}: single-pick compatibility and cancellation never write extra roots`, async () => {
    const h = harness(version); const calls = [];
    const flow = pickFlow(h, { createWorkspace: async ({ path }) => { calls.push(path); return { workspaceId: 'w' }; }, setWorkspaceRoots: () => { throw new Error('unexpected'); }, onPick: (id) => calls.push(id) });
    flow.render(); flow.owner().onCancel(); flow.owner().onPickedDirectories([]); await flush();
    assert.deepEqual(calls, []);
    flow.owner().onPicked('/one'); await flush();
    assert.deepEqual(calls, ['/one', 'w']); h.unmount();
  });

  test(`${version}: a rejected root set stays visible and never opens partial workspace`, async () => {
    const h = harness(version); let opened = false;
    const flow = pickFlow(h, { setWorkspaceRoots: async () => { throw new Error('second root unavailable'); }, onPick: () => { opened = true; } });
    flow.render(); flow.owner().onPickedDirectories(['/one', '/two']); await flush();
    const tree = flow.render();
    assert.equal(opened, false);
    assert.ok(nodes(tree, (node) => node.props.children === 'second root unavailable').length);
    assert.ok(nodes(tree, (node) => node.type === 'Modal' && node.props.open).length); h.unmount();
  });

  test(`${version}: unmount during adoption cannot open a stale renderer`, async () => {
    const h = harness(version); let resolve; let opened = false; let wrote = false;
    const flow = pickFlow(h, { createWorkspace: () => new Promise((done) => { resolve = done; }), setWorkspaceRoots: async () => { wrote = true; }, onPick: () => { opened = true; } });
    flow.render(); flow.owner().onPickedDirectories(['/one', '/two']); h.unmount(); resolve({ workspaceId: 'w' }); await flush();
    assert.equal(opened, false); assert.equal(wrote, false);
  });

  test(`${version}: add-folder selection appends once and cancellation does not mutate`, async () => {
    const h = harness(version); const writes = [];
    const ui = browser(h, { setWorkspaceRoots: async (id, roots) => { writes.push([id, [...roots]]); } });
    let tree = ui.render(); ui.treeProps(tree).onAddFolderRequest('w'); tree = ui.render();
    ui.directoryOwner(tree).onCancel(); tree = ui.render(); assert.deepEqual(writes, []);
    ui.treeProps(tree).onAddFolderRequest('w'); tree = ui.render();
    ui.directoryOwner(tree).onPickedDirectories(['/three', '/four']);
    ui.directoryOwner(tree).onPickedDirectories(['/five']); await flush();
    assert.deepEqual(writes, [['w', ['/one', '/two', '/three', '/four']]]); h.unmount();
  });

  test(`${version}: manage folders explains primary changes and reports in-use session names`, async () => {
    const h = harness(version);
    const failure = Object.assign(new Error('still in use'), { name: 'WorkspaceSetRootsError', rpcError: { code: 'workspace/roots-in-use', details: { sessionIds: ['s'] } } });
    const ui = browser(h, { useSessions: (select) => select({ ids: ['s'], byId: { s: { id: 's', title: 'Backend', retainedBy: {}, blank: false, updatedAt: '2026-01-01T00:00:00Z' } } }), setWorkspaceRoots: async () => { throw failure; } });
    let tree = ui.render(); ui.treeProps(tree).onManageFoldersRequest('w'); tree = ui.render();
    assert.ok(nodes(tree, (node) => node.props.children === 'folder.primaryHint').length);
    const remove = nodes(tree, (node) => node.type === 'Button' && node.props.children === 'folder.remove')[0];
    remove.props.onClick(); await flush(); tree = ui.render();
    assert.ok(nodes(tree, (node) => node.props.role === 'alert' && String(node.props.children).includes('Backend')).length);
    ui.snapshot.items[0].roots = ['/one']; tree = ui.render();
    assert.ok(nodes(tree, (node) => node.type === 'Button' && node.props.children === 'folder.remove').every((node) => node.props.disabled));
    assert.equal(h.api.folderRefusal(Object.assign(new Error(), { name: 'WorkspaceSetRootsError' })), undefined);
    h.unmount();
  });
}

test('alpha.2: folder actions retain resource-scoped endpoint access checks', () => {
  const h = harness('0.2.2-alpha.2'); const requested = [];
  const props = { group: { workspaceId: 'w', key: 'w', roots: ['/one', '/two'], label: 'Project', expanded: true }, actions: { rename: noop, delete: noop, addFolder: noop, manageFolders: noop }, foldersAvailable: true, t,
    useWorkspaceAccess: (id, endpoint) => { requested.push([id, endpoint]); return endpoint !== 'workspace/setRoots'; } };
  let row = h.render(h.api.ProjectRowItem, props);
  while (typeof row.type === 'function') row = h.render(row.type, row.props);
  assert.ok(requested.some(([id, endpoint]) => id === 'w' && endpoint === 'workspace/setRoots'));
  assert.ok(nodes(row, (node) => node.type === 'Menu')[0].props.items.every((item) => item.id !== 'addFolder' && item.id !== 'manageFolders'));
  h.unmount();
});
