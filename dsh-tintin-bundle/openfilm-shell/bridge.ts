/**
 * The window is one page: Studio's editor, and the chat in the column Studio leaves for it. This is what each gets
 * from the other and from the app, in the page:
 *
 *   · window.openfilmHost    Studio's host (its lib/host.ts StudioHost): the window's controls, the chat's column,
 *                            "Reference in chat", Settings → Agents.
 *   · window.openfilmDesktop the chat's bridge (chat/src/app-bridge.ts and lib/desktop-bridge.ts).
 *
 * What only the app can do (the agents, a file on the disk, the window, updates) is the preload's `openfilmNative`
 * (TinTin 的 studio-preload.ts 实现;官方为 src/preload.cjs)。Imported before Studio's modules and the chat's:
 * Studio reads its host as it loads.
 *
 * TinTin 适配(2026-10-23 移植,原文件 apps/desktop/shell/bridge.ts):
 *   1. name 'TinTin';2. update 面恒 off(更新走 TinTin 桌面自身通道);3. tabs 为单视图壳的桩;
 *   4. capture/审批由主进程实现(审批=官方 approve 口径自动放行,阶段 1 已定)。
 */
import { flushSync } from 'react-dom';
import type { CommunityItem, HostAgent, HostAsk, HostProject as Project, HostUpdate, HostUpdateState, StudioCommand, StudioHost, StudioRef, StudioSelection } from 'openfilm/studio-ui/lib/host.ts';

type Listener<T> = (value: T) => void;
type Stop = () => void;
type Theme = 'light' | 'dark';

interface Native {
  platform: string;
  hello(): Promise<{ flavor: string; version: string; ffmpeg: unknown; update: unknown; chatOpen: boolean; chatWidth: number; chatMin: number; studioMin: number; fullScreen: boolean }>;
  pathForFile(file: File): string;
  revealPath(path: string): Promise<void>;
  pickFolder(options?: { title?: string; button?: string; at?: string }): Promise<string | null>;
  capture(rect: { x: number; y: number; width: number; height: number }): Promise<string | null>;
  agents: NonNullable<StudioHost['agents']>;
  /* the window's tabs (TinTin: 单视图壳的桩) */
  tabs: NonNullable<StudioHost['tabs']>;
  localAgents: Record<string, unknown>;
  chat: Record<string, (...args: never[]) => Promise<unknown>>;
  /* the composer's Skills button */
  skills: Record<string, (...args: never[]) => Promise<unknown>>;
  prefs: { get(): Promise<AppPrefs>; set(next: Partial<AppPrefs>): Promise<unknown>; onChange(listener: Listener<AppPrefs>): Stop };
  saveLayout(layout: { chatOpen: boolean; chatWidth: number }): void;
  setTheme(theme: Theme): void;
  setLanguage(language: string): void;
  onFullScreen(listener: Listener<boolean>): Stop;
  onToggleChat(listener: Listener<void>): Stop;
  onOpenSettings(listener: Listener<void>): Stop;
  onStudioBrowser(listener: Listener<unknown>): Stop;
  onFfmpeg(listener: Listener<unknown>): Stop;
  onUpdate(listener: Listener<unknown>): Stop;
  restartToUpdate(): Promise<{ ok: boolean; error?: string }>;
  updateState(): Promise<unknown>;
  checkForUpdate(): Promise<unknown>;
}

const native = (window as unknown as { openfilmNative: Native }).openfilmNative;
const hello = native.hello();

/* 诊断改由影片视图底部的日志条承载(client-ui 轮询 has-shell 诊断), 页内不再挂角标。 */

/** A value that tells its listeners when it changes. */
function signal<T>(value: T) {
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const listener of listeners) listener(next); },
    on(listener: Listener<T>): Stop { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
const events = <T,>() => signal<T>(undefined as T);

/* ── the chat's column: open or not, how wide, and the assets drawer over it ── */
const TOP_BAR = 32;
const column = document.getElementById('of-chat')!;
const layout = { open: true, width: 420, min: 340, studioMin: 640 };
/** the assets open in the column (Studio draws them, above the composer); `bottom`: the composer's height, all the
    chat shows then */
const assets = { open: false, bottom: 120 };
const assetsSignal = signal(false);
const chatOpenSignal = signal(true);

/** The column's width as the window allows it: Studio keeps its least width, the chat its own while it fits. */
const shownWidth = () => (layout.open ? Math.max(Math.min(layout.width, innerWidth - layout.studioMin), Math.min(layout.min, innerWidth)) : 0);
const panelState = () => ({ open: layout.open, width: shownWidth(), assets: { open: assets.open && layout.open, bottom: assets.bottom } });
const panelListeners = new Set<Listener<ReturnType<typeof panelState>>>();

/** 聊天列必现(2026-10-23 用户明确: 会话框不能是隐藏态)—— 只有手动的收起开关能藏它。 */
function place() {
  column.hidden = !layout.open;
  column.style.width = `${shownWidth()}px`;
  column.style.top = `${TOP_BAR}px`;
  column.toggleAttribute('data-assets-open', assets.open && layout.open);
  const state = panelState();
  for (const listener of panelListeners) listener(state);
}
addEventListener('resize', place);

function setChatOpen(open: boolean) {
  if (open === layout.open) return;
  layout.open = open;
  flushSync(() => {
    if (!open && assets.open) { assets.open = false; assetsSignal.set(false); }
    place();
    chatOpenSignal.set(open);
  });
  native.saveLayout({ chatOpen: layout.open, chatWidth: layout.width });
}
function setChatWidth(width: number, done = false) {
  if (!Number.isFinite(width)) return;
  layout.width = Math.round(Math.max(layout.min, Math.min(width, innerWidth - layout.studioMin)));
  place();
  if (done) native.saveLayout({ chatOpen: layout.open, chatWidth: layout.width });
}
function setAssetsOpen(open: boolean) {
  if (open && !layout.open) setChatOpen(true);
  assets.open = open && layout.open;
  flushSync(() => {
    assetsSignal.set(assets.open);
    place();
  });
}
native.onToggleChat(() => setChatOpen(!layout.open));

/* ── the theme and the language are the page's (Studio sets them on <html>) ── */
const root = document.documentElement;
const themeOf = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light');
const theme = signal<Theme>(themeOf());
const language = signal(root.lang || 'en');
new MutationObserver(() => {
  if (themeOf() !== theme.get()) theme.set(themeOf());
  if ((root.lang || 'en') !== language.get()) language.set(root.lang || 'en');
}).observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });
/* the window behind the page, and the system's menus and dialogs, take the same theme */
native.setTheme(theme.get());
theme.on((next) => native.setTheme(next));
/* and the app keeps the language, for the window it shows before the page (an update installed at launch) */
native.setLanguage(language.get());
language.on((next) => native.setLanguage(next));

/* ── the project Studio shows: TinTin 按「影片目录」解析 —— 嵌入页在 /open, 不走 /projects 路由;
   影片目录由 studio-preload 轮询 openfilm:currentProject 经 tintinFilmDir 提供 ── */
const project = signal<Project | null>(null);
let projectReady: Promise<void> = Promise.resolve();
let projectRequest = 0;
function projectChanged(next: Project, request?: number) {
  if (request === undefined) projectRequest += 1;
  else if (request !== projectRequest) return;
  const current = project.get();
  if (current?.id === next.id && current.name === next.name && current.path === next.path) return;
  project.set({ id: next.id, name: next.name, path: next.path });
  place(); /* 项目解析落地即重排: 聊天列此刻才具备显示条件(嵌入无 /projects 路由) */
}
async function follow() {
  /* TinTin: 按「影片目录」匹配 Studio 的项目(影片目录由 studio-preload 轮询
     openfilm:currentProject 经 tintinFilmDir 提供; 嵌入页在 /open, 无 /projects 路由)。 */
  const request = ++projectRequest;
  let filmDir: string | null = null;
  try {
    const filmDirBridge = (window as unknown as { tintinFilmDir?: () => Promise<string> }).tintinFilmDir;
    if (typeof filmDirBridge === 'function') filmDir = await filmDirBridge();
  } catch { filmDir = null }
  filmDir = typeof filmDir === 'string' && filmDir ? filmDir.replace(/[\\/]+$/, '') : null;
  if (!filmDir) return; // Keep the chat mounted while the project list covers it.
  try {
    const res = await fetch('/api/projects');
    const body = await res.json() as { projects?: Project[] };
    const found = (body.projects ?? []).find((p) => p.path.replace(/[\\/]+$/, '') === filmDir);
    if (found) projectChanged({ id: found.id, name: found.name, path: found.path }, request);
  } catch { /* told next time the address changes */ }
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History['pushState']>) => { original(...args); projectReady = follow(); place(); };
}
addEventListener('popstate', () => { projectReady = follow(); place(); });
projectReady = follow();
/* TinTin: 影片目录由 studio-preload 轮询提供 —— 周期性按目录重解析项目并重排
   (嵌入页无 /projects 路由可依赖; place 在项目落地后必须重跑, 否则聊天列停留隐藏态) */
setInterval(() => { void follow().then(() => place()) }, 2500);
/* TinTin: 影片目录由 studio-preload 轮询提供 —— 周期性按目录重解析项目(无路由可依赖) */
setInterval(() => { void follow() }, 2500);

/* ── between Studio and the chat: what is selected, what is referenced, what Studio is asked to show ── */
const selection = signal<StudioSelection | null>(null);
const refer = events<StudioRef>();
/* a skill picked in the examples (Studio's ExamplesDialog), to be named in the message; and "Add a skill" there */
const skillPicked = events<{ name: string; description: string; newConversation?: boolean }>();
const skillAdd = events<void>();
/** what the pointer is over in Studio (null: nothing), for the chat to light its pills that point at it */
const hover = signal<StudioRef | null>(null);
let command: ((command: StudioCommand) => void) | null = null;
const fullScreen = signal(false);
native.onFullScreen((full) => fullScreen.set(full));

/*
 * ── a reference's picture of the viewer (StudioRefImage `viewer`): what the person sees there now, taken by the app as
 * they point at it. The picture's overlays (selection frames, handles, Studio's toolbars) step aside for that frame;
 * the subtitles stay, they are part of the picture. Without a viewer on screen, or when the app cannot take it, the
 * reference goes without a picture.
 */
let pictured: Promise<void> = Promise.resolve();
const captureStyle = document.createElement('style');
captureStyle.textContent = '[data-capturing] [data-film-select], [data-capturing] [data-capture-hide] { visibility: hidden !important; }';
document.head.append(captureStyle);
const nextFrame = () => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())); });
async function withPicture(ref: StudioRef): Promise<StudioRef> {
  const image = ref.image;
  if (!image?.viewer) return ref;
  const { image: _viewer, ...bare } = ref;
  document.documentElement.toggleAttribute('data-capturing', true);
  try {
    await nextFrame();
    const film = [...document.querySelectorAll<HTMLIFrameElement>('iframe[title="film"]')]
      .find((f) => f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== 'hidden');
    if (!film) return bare as StudioRef;
    const r = film.getBoundingClientRect();
    let box = { x: r.left, y: r.top, width: r.width, height: r.height };
    if (image.crop && image.stage?.w) {
      const k = r.width / image.stage.w;
      /* an element is shown with what is around it (a line of text alone is a strip the agent cannot place); a region
         is what the person drew, as drawn */
      const pad = ref.kind === 'layer' ? Math.max(120, Math.max(image.crop.w, image.crop.h) / 2) : 0;
      const crop = { x: image.crop.x - pad, y: image.crop.y - pad, w: image.crop.w + 2 * pad, h: image.crop.h + 2 * pad };
      const left = Math.max(r.left, r.left + crop.x * k);
      const top = Math.max(r.top, r.top + crop.y * k);
      const right = Math.min(r.right, r.left + (crop.x + crop.w) * k);
      const bottom = Math.min(r.bottom, r.top + (crop.y + crop.h) * k);
      box = { x: left, y: top, width: right - left, height: bottom - top };
    }
    const jpeg = await native.capture(box).catch(() => null);
    return (jpeg ? { ...bare, image: { src: `data:image/jpeg;base64,${jpeg}` } } : bare) as StudioRef;
  } finally {
    document.documentElement.toggleAttribute('data-capturing', false);
  }
}

/* ── what an agent's command asks before it spends (Studio words it): the chat shows it above its composer ── */
const asks = signal<HostAsk[]>([]);
let answerAsk: (id: string, allow: boolean) => void = () => {};

/* ── Settings → Developer (kept by the app): Studio switches it, the chat shows each turn's log and changes by it ── */
interface AppPrefs { developer: boolean; changes: boolean }
const developerOf = (prefs: AppPrefs) => ({ logs: prefs.developer === true, changes: prefs.changes !== false });
const developer = {
  get: async () => developerOf(await native.prefs.get()),
  set: (next: { logs?: boolean; changes?: boolean }) => native.prefs.set({
    ...(typeof next.logs === 'boolean' ? { developer: next.logs } : {}),
    ...(typeof next.changes === 'boolean' ? { changes: next.changes } : {}),
  }),
  onChange: (listener: Listener<{ logs: boolean; changes: boolean }>) => native.prefs.onChange((prefs) => listener(developerOf(prefs))),
};

/* ── the app's update: TinTin 桌面的更新走自身通道, Studio 顶栏恒 off ── */
const WAITING = ['agent-busy', 'exporting', 'install-failed'] as const;
function shownUpdate(state: unknown): HostUpdate | null {
  const s = state as { status?: string; availableVersion?: string | null; error?: string | null } | null;
  if (!s || (s.status !== 'ready' && s.status !== 'installing')) return null;
  const waiting = WAITING.find((w) => w === s.error) ?? null;
  return { status: s.status, version: s.availableVersion ?? '', waiting };
}
const update: NonNullable<StudioHost['update']> = {
  onChange(listener) {
    let told = false;
    void hello.then((h) => { if (!told) listener(shownUpdate(h.update)); });
    return native.onUpdate((state) => { told = true; listener(shownUpdate(state)); });
  },
  restart: native.restartToUpdate,
  onState(listener) {
    let told = false;
    void native.updateState().then((s) => { if (!told && s) listener(s as HostUpdateState); });
    return native.onUpdate((s) => { told = true; if (s) listener(s as HostUpdateState); });
  },
  check: async () => (await native.checkForUpdate()) as HostUpdateState | null,
};

/* ── Studio's host ── */
const mac = native.platform === 'darwin';
const windows = native.platform === 'win32';
/** the window's own controls: macOS's traffic lights end at 66 px (Studio's logo a little after them); Windows draws
    its buttons over the top bar's right */
const INSET = 74;
const INSET_RIGHT = 138;

const host: StudioHost = {
  version: 1,
  name: 'TinTin',
  projectChanged,
  ...(mac ? { titlebar: { inset: INSET, onChange: (listener: Listener<number>) => { fullScreen.on((full) => listener(full ? 6 : INSET)); } } } : {}),
  ...(windows ? { titlebar: { inset: 6, insetRight: INSET_RIGHT } } : {}),
  /* in order, each with its picture: two pointed at quickly must not swap or share a screenshot */
  refer: (ref) => {
    if (!layout.open) setChatOpen(true);
    pictured = pictured.then(() => withPicture(ref)).then((done) => refer.set(done));
  },
  onSelection: (next) => selection.set(next),
  onHover: (ref) => hover.set(ref ?? null),
  onCommand: (listener) => { command = listener; },
  settings: { onOpen: (listener) => native.onOpenSettings(listener) },
  /* read live: Studio may read the panel before or after the kept layout arrives */
  panel: {
    label: 'Chat',
    get open() { return layout.open; },
    get width() { return shownWidth(); },
    get assets() { return panelState().assets; },
    setOpen: setChatOpen,
    setAssetsOpen,
    setWidth: (width, done) => setChatWidth(width, done === true),
    onChange: (listener) => { panelListeners.add(listener); listener(panelState()); },
  },
  agents: native.agents,
  asks: { show: (list, answer) => { answerAsk = answer; asks.set(list); } },
  developer,
  update,
  folders: { pick: native.pickFolder, pathOf: native.pathForFile },
  tabs: native.tabs,
  useSkill: (skill) => skillPicked.set(skill),
  skills: { add: () => skillAdd.set(undefined) },
};
(window as unknown as { openfilmHost: StudioHost }).openfilmHost = host;

/* the layout the app kept: the panel starts as it was, before Studio first reads it */
const ready = hello.then((h) => {
  layout.open = h.chatOpen;
  layout.width = h.chatWidth;
  layout.min = h.chatMin;
  layout.studioMin = h.studioMin;
  fullScreen.set(h.fullScreen);
  chatOpenSignal.set(layout.open);
  place();
  return h;
});

/* ── the chat's bridge ── */
/** Where a reference takes the person: the clip selected, the moment, the range marked, the box shown, the track, the
    file. A layer whose place on the picture Studio told is shown as that box (it is what was pointed at); one without,
    by its clip. */
function commandFor(ref: StudioRef): StudioCommand {
  switch (ref.kind) {
    case 'clip': return { type: 'select-clip', id: ref.id, loc: ref.loc, seek: true };
    case 'layer': return ref.box && typeof ref.time === 'number'
      ? { type: 'show-box', time: ref.time, box: ref.box }
      : { type: 'select-clip', id: ref.clipId, loc: ref.loc, seek: true };
    case 'region': return { type: 'show-box', time: ref.time, box: ref.box };
    case 'time': return { type: 'seek', time: ref.time };
    case 'range': return { type: 'show-range', start: ref.start, end: ref.end };
    case 'track': return { type: 'show-track', track: ref.track };
    case 'file': return { type: 'show-file', path: ref.path };
    case 'subtitle': return { type: 'show-subtitle', start: ref.start, end: ref.end };
    /* another film: the examples, where it came from */
    case 'example': return { type: 'show-examples', open: { kind: 'example', id: ref.id } };
  }
}

(window as unknown as { openfilmDesktop: unknown }).openfilmDesktop = {
  bridgeVersion: '1',
  platform: native.platform,
  pathForFile: native.pathForFile,
  revealPath: native.revealPath,
  agents: {
    list: native.agents.list,
    connect: native.agents.connect,
    onChange: native.agents.onChange,
  },
  localAgents: native.localAgents,
  openSettings: (section: string) => command?.({ type: 'settings', section: section === 'providers' ? 'providers' : 'agents' }),
  async hello() {
    const h = await ready;
    await projectReady;
    return {
      platform: native.platform, flavor: h.flavor, theme: theme.get(), language: language.get(), chatOpen: layout.open,
      project: project.get(), selection: selection.get(), ffmpeg: h.ffmpeg, version: h.version, chatMin: layout.min,
    };
  },
  onTheme: theme.on,
  onLanguage: language.on,
  onProject: (listener: Listener<Project>) => project.on((p) => { if (p) listener(p); }),
  onChatOpen: chatOpenSignal.on,
  onStudioBrowser: native.onStudioBrowser,
  /* Studio failing to start leaves no page to tell: the app shows that itself */
  onStudioFailed: () => () => {},
  onRefer: refer.on,
  onSelection: (listener: Listener<StudioSelection>) => selection.on((s) => { if (s) listener(s); }),
  onFfmpeg: native.onFfmpeg,
  showInStudio: (ref: StudioRef) => command?.(commandFor(ref)),
  /* an example's folder on this computer (Studio fetches it when needed), for a reference to one in a message sent */
  async exampleFolder(id: string) {
    const res = await fetch(`/api/examples/${encodeURIComponent(id)}/folder`, { method: 'POST' });
    const body = await res.json().catch(() => ({})) as { folder?: string; error?: string };
    if (!res.ok || !body.folder) throw new Error(body.error ?? `Studio answered ${res.status}`);
    return body.folder;
  },
  /* the composer's examples button: the examples over the film, to point at one or name a skill */
  showExamples: (open?: CommunityItem) => command?.({ type: 'show-examples', ...(open ? { open } : {}) }),
  onUseSkill: skillPicked.on,
  onAddSkill: skillAdd.on,
  useSkill: (skill: { name: string; description: string; newConversation?: boolean }) => skillPicked.set(skill),
  /* a reference made in the chat (⌘L there, the @ menu) gets its picture as Studio's own do */
  withPicture: (ref: StudioRef) => { const done = pictured.then(() => withPicture(ref)); pictured = done.then(() => {}); return done; },
  /* what a pill hovered in the chat points at, lit in Studio while it is (null: none); and the references of the
     message being written, numbered there */
  highlightInStudio: (ref: StudioRef | null) => command?.({ type: 'highlight', ref }),
  draftRefsInStudio: (refs: StudioRef[]) => command?.({ type: 'draft-refs', refs }),
  onStudioHover: hover.on,
  /* the project's files, for the @ menu: Studio's own listing (this page is Studio's, so its API is too) */
  async projectFiles() {
    const id = project.get()?.id;
    if (!id) return { files: [] };
    try { return await (await fetch(`/api/projects/${encodeURIComponent(id)}/files`)).json(); } catch { return { files: [] }; }
  },
  setChatWidth: (width: number, done?: boolean) => setChatWidth(width, done === true),
  setChatOpen,
  assetsOpen: () => assets.open,
  setAssetsOpen,
  onAssets: assetsSignal.on,
  setComposerHeight(px: number) {
    const bottom = Math.round(px);
    if (!Number.isFinite(bottom) || bottom < 40 || bottom === assets.bottom) return;
    assets.bottom = bottom;
    place();
  },
  /* a menu of the chat's floats in its own layer over everything: nothing to make room for */
  setMenuOpen() {},
  /* the chat's record of each project, in its .film/chat and .film/logs */
  chat: native.chat,
  skills: native.skills,
  asks: { get: asks.get, onChange: asks.on, answer: (id: string, allow: boolean) => answerAsk(id, allow) },
  developer,
};

export type { HostAgent };
