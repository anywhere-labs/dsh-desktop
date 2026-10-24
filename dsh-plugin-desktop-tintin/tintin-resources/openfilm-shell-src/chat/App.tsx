/**
 * The chat beside Studio: a conversation with an agent (the app's own, or the person's own Claude Code or Codex) about
 * the project Studio shows; switching projects there switches the conversations here.
 *
 * Kept on this Mac: the sessions per project folder (lib/local-sessions), each turn and what the agent did in it
 * (lib/local-agent-run's saved turns).
 */
import React from 'react';
import { ArrowDown, Blocks, Coins, CornerDownLeft, LibraryBig, Loader2, Plus, ShieldQuestion, Square, SquareSlash, X } from 'lucide-react';
import { buildPromptDisplay, type Turn } from '@openfilm/shared';
import { useT, useUiLocale } from '@/i18n';
import { ConversationSessionBar } from '@/components/ConversationSessionBar';
import { ProjectConversation, primeStoredTranscript } from '@/components/ProjectConversation';
import { ProjectStarters } from '@/components/ProjectStarters';
import { AttachmentPreview, type AttachmentPreviewItem } from '@/components/AttachmentPreview';
import { ATTACHMENT_CARD, ATTACHMENT_THUMB, AttachmentCardBody, PlayMark } from '@/components/AttachmentCard';
import { attachmentPlace } from '@/lib/attachment-place';
import { ModelPopover } from '@/components/ModelPopover';
import { AddSkillDialog, type PickedSkill } from '@/components/AddSkill';
import { SKILLS_CHANGED } from 'openfilm/studio-ui/lib/project-sources.ts';
import { CardActions, CardButton, ComposerCard } from '@/components/ComposerCard';
import { LocalAgentQuestionCard } from '@/components/TurnQuestionCard';
import { Tooltip } from '@/components/Tooltip';
import { StickToBottomContext, useStickToBottom, useTailSpacer } from '@/components/useStickToBottom';
import { PromptEditor, PromptPill, PromptPillHoverContext, PromptPillRevealContext, activatedSkillIds, fileReferenceId, fileReferencePath, promptReferenceToken, resolvePromptReferences, skillReferenceId, skillReferencePackage, splitPromptReferenceText, type MentionProvider, type PromptEditorHandle, type PromptEditorState, type PromptPillHover, type PromptReference } from '@/components/prompt-editor';
import { filesFromTransfer, transferHasFiles } from '@/lib/composer-attachments';
import { attachmentIcon } from '@/lib/project-resources';
import { PROMPT_PICTURES_MAX, attachedPictures, attachedText, attachmentBlocker, formatFileSize, turnAttachments, useDesktopAttachments } from '@/lib/desktop-attachments';
import { deriveProjectTurns } from '@/lib/project-versions';
import { makePlaceholder, mergeAssetLists } from '@/lib/asset-lists';
import { isEmptyBackgroundTurn } from '@/lib/unprompted';
import {
  answerLocalAgentPermission,
  answerLocalAgentQuestion,
  cancelLocalAgentTurn,
  canSteer,
  createLocalAgentTurn,
  finishRunningLocalTurn,
  loadLocalAgentTurns,
  localAgentTurn,
  makeLocalAgentTurnId,
  onUnpromptedTurn,
  recoverLocalAgentTurns,
  registerRunningLocalTurn,
  runLocalAgentTurn,
  runningLocalTurns,
  recoverLoggedTurns,
  restingItems,
  saveLocalAgentTurn,
  steerLocalAgentTurn,
  useAgentCommands,
  useAgentContext,
  useLocalAgentTurn,
  type LocalAgentTurn,
  type LocalTranscriptStore,
} from '@/lib/local-agent-run';
import { desktopBridge, type LocalAgentId, type LocalAgentTurnMeta, type PromptImage } from '@/lib/desktop-bridge';
import { referencePictures } from '@/lib/ref-pictures';
import type { TurnFileChanges } from '@/lib/file-changes';
import { readBalance, type TurnBalance } from '@/lib/balance';
import { BalanceNotice } from '@/components/BalanceNotice';
import { CopyDiagnostics } from '@/components/CopyDiagnostics';
import { readStudioFilm } from '@/lib/studio-film';
import { studioRefsFromTransfer, transferHasStudioRefs } from '@/lib/studio-transfer';
import { agentModelSummary, agentOptions, currentAgent, effectivePrefs, offeredOption, useLocalAgents } from '@/state/local-agent-store';
import { useLiveActivityFromStore } from '@/lib/live-activity';
import { loadLastSession, loadSessions, newSession, saveLastSession, saveSessions } from '@/lib/local-sessions';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import type { TranscriptItem } from '@/lib/agent-transcript';
import { app, type FfmpegState, type Project, type SkillListing, type StudioRef, type StudioSelection } from './app-bridge';
import { Divider } from './components/Divider';
import { draftRefs, pillCard, refFromPill, refPill, sameStudioThing, selectionMoment, selectionRange, selectionRefs, studioReferencesText } from './studio-refs';
import { inChat } from './lib/chat-layer';
import { useProjectChat } from './lib/chat-store';
import { givenAfter, pagesToSend } from './lib/skill-pages';
import { ChatProjectContext, WaitingContext } from './lib/developer';

const NO_ITEMS: TranscriptItem[] = [];
const EMPTY_STORE: LocalTranscriptStore = { get: () => NO_ITEMS, subscribe: () => () => {} };

const isActive = (turn: Turn | undefined) => turn?.status === 'generating' || turn?.status === 'failing' || turn?.status === 'canceling';

/** how often a running turn is kept, at most (it changes with every word) */
const KEEP_RUNNING_MS = 1500;
/** how full the agent's context gets before the chat says a new conversation would work better */
const CONTEXT_NOTICE_SHARE = 0.85;

/** On a video's thumbnail: it plays, it is not a picture. */
/* between the chat's root (the add-skill dialog) and the project's chat: a skill added, a skill to make */
const MAKE_SKILL = 'openfilm:make-skill';

export function App({ initialProject, initialSelection, initialFfmpeg }: {
  initialProject: Project | null;
  initialSelection: StudioSelection | null;
  initialFfmpeg: FfmpegState;
}) {
  const t = useT();
  const [project, setProject] = React.useState<Project | null>(initialProject);
  const [ffmpeg, setFfmpeg] = React.useState<FfmpegState>(initialFfmpeg);
  const [browser, setBrowser] = React.useState<{ state: string; message?: string } | null>(null);
  const [studioFailed, setStudioFailed] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<StudioSelection | null>(initialSelection);
  /* the project's assets open over this column (Studio draws them; the chat keeps only its composer, below them) */
  const [assetsOpen, setAssetsOpen] = React.useState<boolean>(() => app.assetsOpen?.() ?? false);
  React.useEffect(() => {
    const stops = [
      app.onAssets(setAssetsOpen),
      app.onProject(setProject),
      app.onSelection(setSelection),
      app.onFfmpeg(setFfmpeg),
      app.onStudioBrowser(setBrowser),
      app.onStudioFailed(setStudioFailed),
    ];
    return () => { for (const stop of stops) stop(); };
  }, []);

  /* "Add a skill" in the examples (on a project or a new tab's launcher): its dialog, here at the root so it opens on
     either; naming the one added and making one with the agent only where a project's chat is */
  const [addingSkill, setAddingSkill] = React.useState(false);
  React.useEffect(() => app.onAddSkill?.(() => setAddingSkill(true)), []);

  /* the project's chat record, read from its folder before its conversation shows */
  const chatReady = useProjectChat(project);
  const ffState = typeof ffmpeg === 'object' && ffmpeg ? ffmpeg : null;
  const banners = (
    <>
      {studioFailed ? <Banner tone="error">{t('banner.studioFailed').replace('{error}', studioFailed)}</Banner> : null}
      {ffmpeg === false ? <Banner>{t('banner.ffmpegMissing')} <code className="font-mono">{navigator.platform.startsWith('Win') ? 'winget install ffmpeg' : 'brew install ffmpeg'}</code></Banner> : null}
      {ffState?.state === 'downloading' ? <Banner>{t('banner.ffmpegDownloading').replace('{n}', String(Math.round((ffState.progress ?? 0) * 100)))}</Banner> : null}
      {ffState?.state === 'failed' ? <Banner tone="error">{t('banner.ffmpegFailed').replace('{error}', ffState.message ?? '')}</Banner> : null}
      {browser?.state === 'downloading' ? <Banner>{t('banner.browserDownloading')}</Banner> : null}
      {browser?.state === 'failed' ? <Banner tone="error">{t('banner.browserFailed').replace('{error}', browser.message ?? '')}</Banner> : null}
    </>
  );

  const onProject = Boolean(project) && /^\/projects\//.test(location.pathname);
  return (
    <div className={`relative flex h-full flex-col ${assetsOpen ? '' : 'bg-[var(--dock-shell)]'}`}>
      {addingSkill ? (
        <AddSkillDialog onClose={() => setAddingSkill(false)} onAdded={async () => { window.dispatchEvent(new Event(SKILLS_CHANGED)); }}
          onPick={onProject ? (skill) => app.useSkill?.(skill) : undefined}
          onMake={onProject ? () => window.dispatchEvent(new Event(MAKE_SKILL)) : undefined} />
      ) : null}
      {/* under Studio's top bar (it runs over this, across the window): the seam on the left is the handle */}
      <Divider />
      <div className="mb-[6px] ml-[6px] mr-[6px] flex min-h-0 flex-1 flex-col">
        {project && chatReady
          ? <ChatPane key={`${project.id}:${project.path}`} project={project} banners={banners} selection={selection && selection.projectId === project.id ? selection : null} assetsOpen={assetsOpen} />
          : <aside className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[7px] bg-[var(--dock-pane)]">{banners}<Loader2 size={16} className="animate-spin text-[var(--text-faint)]" /></aside>}
      </div>
    </div>
  );
}

/**
 * One project's conversation column: the session bar, the conversation and the composer, and the turns run with
 * the person's agent (start a turn, put back a turn a reload interrupted, settle and keep it).
 */
function ChatPane({ project, banners, selection, assetsOpen }: { project: Project; banners: React.ReactNode; selection: StudioSelection | null; assetsOpen: boolean }) {
  const t = useT();
  const projectKey = project.path;

  /* ── sessions ── */
  const [sessions, setSessions] = React.useState<ProjectSessionItem[]>(() => loadSessions(projectKey));
  const [sessionId, setSessionId] = React.useState<string>(() => {
    const last = loadLastSession(projectKey);
    const list = loadSessions(projectKey);
    return last && list.some((s) => s.id === last) ? last : list[0]?.id ?? newSession().id;
  });
  React.useEffect(() => { saveLastSession(projectKey, sessionId); }, [projectKey, sessionId]);
  const touchSession = React.useCallback((id: string, patch: (s: ProjectSessionItem) => Partial<ProjectSessionItem>) => {
    setSessions((list) => {
      const now = new Date().toISOString();
      const found = list.find((s) => s.id === id);
      const base = found ?? { ...newSession(), id };
      const next = { ...base, ...patch(base), updatedAt: now };
      const out = [next, ...list.filter((s) => s.id !== id)];
      saveSessions(projectKey, out);
      return out;
    });
  }, [projectKey]);

  /* ── turns: the ones kept on this Mac, and the one running now ── */
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [rev, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const saved = loadLocalAgentTurns(projectKey, sessionId);
    for (const entry of saved) primeStoredTranscript(entry.turn.id, entry.items);
    const live = runningLocalTurns(projectKey).filter((r) => r.sessionId === sessionId).map((r) => r.turn);
    setTurns(mergeAssetLists([...saved.map((entry) => entry.turn), ...live], []));
  }, [projectKey, sessionId, rev]);

  /** This turn is over: the Mac keeps it, the conversation shows it as it ended. */
  function settleLocalTurn(meta: LocalAgentTurnMeta, turn: LocalAgentTurn, patch: Partial<Turn & TurnBalance>): Turn {
    const id = meta.turnId;
    finishRunningLocalTurn(id);
    const done: Turn = { ...(meta.turn as Turn), ...patch, updatedAt: new Date().toISOString() };
    primeStoredTranscript(id, turn.items);
    saveLocalAgentTurn(meta.projectId, done, turn.items);
    /* a turn the agent started by itself that ended with nothing in it leaves no line behind */
    setTurns((list) => (isEmptyBackgroundTurn(done, turn.items)
      ? list.filter((item) => item.id !== id)
      : list.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: done.updatedAt } : item))));
    return done;
  }

  /* the clips' files, so a clip an agent names in its reply gets its icon (lib/studio-film) */
  React.useEffect(() => { void readStudioFilm(project.id); }, [project.id]);

  /* the page was reloaded while a turn ran (the window, its session and the agent stayed): put it back */
  React.useEffect(() => {
    void recoverLocalAgentTurns(projectKey).then((list) => {
      for (const r of list) {
        registerRunningLocalTurn({
          id: r.meta.turnId, projectId: projectKey, projectTitle: r.meta.projectTitle, sessionId: r.meta.sessionId,
          agent: r.meta.agent, prompt: r.meta.prompt, startedAt: r.meta.startedAt, turn: r.meta.turn as Turn,
        });
        bump();
        void r.finished.then((result) => {
          if (result.ok) settleLocalTurn(r.meta, r.turn, result.stopReason === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' });
          else {
            const reason = result.error.replace(/^Internal error:\s*/i, '').trim() || result.error;
            const balance = readBalance(result.balance);
            r.turn.patch(balance ? { balance } : { error: reason });
            settleLocalTurn(r.meta, r.turn, { status: 'error', error: reason, ...(balance ? { balance } : {}) });
          }
        }).finally(() => { r.ack(); bump(); });
      }
      /* then the turns only the logs have (the app closed on them before they were kept): made again, and shown */
      return recoverLoggedTurns(projectKey).then((made) => { if (made) bump(); });
    });
    // settleLocalTurn only reads stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  const ordered = React.useMemo(() => [...turns].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [turns]);
  const asset = ordered.at(-1);
  const active = isActive(asset);
  const blank = ordered.length === 0;
  const opLog = React.useMemo(() => (blank ? [] : deriveProjectTurns(ordered, [], asset?.id ?? null)), [blank, ordered, asset?.id]);

  const localTurn = useLocalAgentTurn(asset?.id ?? null);
  /* why the last turn failed: as it happened, or, the chat opened again on it (the app restarted), as it was kept */
  const turnError = localTurn ? localTurn.state.error : asset?.status === 'error' && !(asset as Turn & TurnBalance).balance ? asset.error ?? null : null;
  const liveStore = localTurn?.turn.store ?? EMPTY_STORE;
  const activity = useLiveActivityFromStore(liveStore, localTurn?.state.thinking ?? false, false);

  /* ── the agent ── */
  const la = useLocalAgents();
  React.useEffect(() => { la.hydrate(); void la.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const agent = currentAgent(la);

  /* what an agent's command asks before it spends: above the composer, as the agent's own questions are */
  const spendAsks = React.useSyncExternalStore((change) => app.asks.onChange(change), app.asks.get);
  const spendAsk = spendAsks[0] ?? null;

  /* ── the composer ── */
  const thread = useStickToBottom();
  /* scrolled away from the conversation's start: what passes under the session bar fades into it */
  const [scrolled, setScrolled] = React.useState(false);
  const tail = useTailSpacer(thread.viewport, thread.pinIfFollowing, active);
  const composerRef = React.useRef<PromptEditorHandle>(null);
  /* the composer and what stands on it (a question, a permission): its height, with the 6 px under the pane, is all
     this view keeps while the assets are open */
  const composerBlockRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const block = composerBlockRef.current;
    if (!block) return undefined;
    const tell = () => app.setComposerHeight(Math.ceil(block.getBoundingClientRect().height) + 6);
    tell();
    const seen = new ResizeObserver(tell);
    seen.observe(block);
    return () => seen.disconnect();
  }, []);
  const [followUp, setFollowUp] = React.useState('');
  const [followUpRefs, setFollowUpRefs] = React.useState<PromptReference[]>([]);
  /** what the person pointed at in Studio for this message, by pill id */
  const [studioRefs, setStudioRefs] = React.useState<Map<string, StudioRef>>(() => new Map());
  const [queued, setQueued] = React.useState(false);
  const [followUpError, setFollowUpError] = React.useState<string | null>(null);
  const composerFiles = useDesktopAttachments(project.path);
  /* a file of the message being written, opened to look at */
  const [openedFile, setOpenedFile] = React.useState<AttachmentPreviewItem | null>(null);
  const attachInputRef = React.useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = React.useState(false);
  /** files of the project pointed at with @ (their pills turn back into their paths when sent) */
  const [fileRefs, setFileRefs] = React.useState<PromptReference[]>([]);
  const followUpFilled = followUp.trim().length > 0;
  /* the composer's button stops the turn while it runs, until something is written to send */
  const stopping = active && !followUpFilled;
  /** skills named with the Skills button or `/` (each pill turns into the skill's name, its SKILL.md after the message) */
  const [skillRefs, setSkillRefs] = React.useState<PromptReference[]>([]);
  const composerPills = React.useMemo(
    () => [...[...studioRefs.entries()].map(([id, ref]) => refPill(id, ref)), ...fileRefs, ...skillRefs],
    [studioRefs, fileRefs, skillRefs],
  );

  /* ── the @ menu: this moment in Studio, and the project's files (asked for when the menu opens) ── */
  const [mentionFiles, setMentionFiles] = React.useState<Array<{ path: string; kind: string; size: number }>>([]);
  const loadMentionFiles = React.useCallback(() => {
    void app.projectFiles().then((listing) => setMentionFiles([
      ...(listing.files ?? []).filter((f) => ['image', 'video', 'audio'].includes(f.kind)),
      ...(listing.pages ?? []).map((p) => ({ ...p, kind: 'mg' })),
    ])).catch(() => {});
  }, []);
  /** Studio's things become this message's pills (what each points at is kept by its pill's id) */
  const takeStudioRefs = React.useCallback((refs: StudioRef[]): PromptReference[] => {
    const pills = refs.map((ref) => refPill(undefined, ref));
    setStudioRefs((map) => {
      const next = new Map(map);
      refs.forEach((ref, i) => next.set(pills[i]!.id, ref));
      return next;
    });
    /* one pointed at here (⌘L, @) that shows the viewer: the pill is there at once, its picture follows once taken */
    refs.forEach((ref, i) => {
      if (!ref.image?.viewer) return;
      const id = pills[i]!.id;
      void app.withPicture(ref).then((done) => setStudioRefs((map) => (map.has(id) ? new Map(map).set(id, done) : map)));
    });
    return pills;
  }, []);
  /* how full the agent's context is in this conversation: said only once it is nearly full */
  const agentContext = useAgentContext(projectKey, sessionId, agent);
  const [contextNoticeOff, setContextNoticeOff] = React.useState<string | null>(null);
  const contextFull = Boolean(agentContext && agentContext.size > 0 && agentContext.used / agentContext.size >= CONTEXT_NOTICE_SHARE) && contextNoticeOff !== sessionId;

  /* the skills this message can name (the Skills button, and `/`) */
  const [skillListing, setSkillListing] = React.useState<SkillListing | null>(null);
  const reloadSkills = React.useCallback(async () => {
    const next = await app.skills?.list(project.path, agent).catch(() => null);
    if (next) setSkillListing(next);
  }, [project.path, agent]);
  React.useEffect(() => { void reloadSkills(); }, [reloadSkills]);
  /* a skill as people see it, in the language shown: its title, and what its page says (none: its name and the
     agent's description) */
  const locale = useUiLocale();
  const skillWords = React.useCallback((name: string, description = '') => {
    const shown = skillListing?.openfilm.find((s) => s.name === name)?.shown;
    const pick = (words?: Record<string, string>) => (words ? words[locale] ?? words[locale.split('-')[0]!] ?? words.en ?? Object.values(words)[0] : undefined);
    const summary = pick(shown?.summary);
    return {
      title: pick(shown?.title) ?? name,
      summary: summary ?? description,
      text: shown ? [summary, ...(pick(shown.details)?.split('\n') ?? [])].filter((w): w is string => Boolean(w)) : description ? [description] : [],
    };
  }, [skillListing, locale]);
  const skillPill = React.useCallback((skill: PickedSkill): PromptReference => {
    /* its title alone: what it does is in its hover card */
    const pill: PromptReference = { id: skillReferenceId(skill.name), kind: 'skill', label: skillWords(skill.name, skill.description).title };
    setSkillRefs((list) => (list.some((p) => p.id === pill.id) ? list : [...list, pill]));
    return pill;
  }, [skillWords]);
  const pickSkill = React.useCallback((skill: PickedSkill) => {
    const pill = skillPill(skill);
    requestAnimationFrame(() => { composerRef.current?.insertReference(pill); composerRef.current?.focus(); });
  }, [skillPill]);
  /* the skills a message can name: OpenFilm's, and of the agent's own those it has (let in, or all when it cannot be told) */
  const nameableSkills = React.useMemo(() => [
    ...(skillListing?.openfilm ?? []),
    ...(skillListing?.own.skills ?? []).filter((s) => !skillListing?.own.filtered || s.allowed),
  ], [skillListing]);
  /* a skill picked in Studio's skills: named in the message; Try now there: in a new conversation */
  const newConversation = React.useRef<() => void>(() => {});
  React.useEffect(() => app.onUseSkill?.((skill) => {
    if (skill.newConversation) newConversation.current();
    pickSkill(skill);
  }), [pickSkill]);
  /* a skill added from the examples (AddSkillDialog, at the chat's root), or turned on or off in them: the list read
     again, and the agents' sessions take it up; "make one with the agent" there: its message put in the composer */
  React.useEffect(() => {
    const changed = () => { void reloadSkills(); void app.skills?.changed?.().catch(() => {}); };
    const make = () => { composerRef.current?.setText(t('skills.makePrompt').replace('{folder}', skillListing?.mine ?? '')); composerRef.current?.focus(); };
    window.addEventListener(SKILLS_CHANGED, changed);
    window.addEventListener(MAKE_SKILL, make);
    return () => { window.removeEventListener(SKILLS_CHANGED, changed); window.removeEventListener(MAKE_SKILL, make); };
  }, [reloadSkills, skillListing, t]);
  /* the agent's own skills hidden in OpenFilm: not offered among its commands either */
  const hiddenSkills = React.useMemo(() => new Set((skillListing?.own.filtered ? skillListing.own.skills.filter((s) => !s.allowed) : []).map((s) => s.name)), [skillListing]);

  /* the agent's own commands, a `/` at the start of the message, as in its own chat: they go as typed; above them, the
     skills, each a pill */
  const agentCommands = useAgentCommands(agent);
  const commandMenu = React.useMemo(() => (agentCommands.length || nameableSkills.length ? {
    label: t('composer.commands'),
    providers: [...(nameableSkills.length ? [{
      id: 'skills',
      groupLabel: t('skills.button'),
      items: nameableSkills.map((skill) => ({
        id: skillReferenceId(skill.name),
        kind: 'skill' as const,
        icon: Blocks,
        label: skillWords(skill.name).title,
        ...(skillWords(skill.name, skill.description).summary ? { detail: skillWords(skill.name, skill.description).summary, describes: true } : {}),
        keywords: [skill.name, skillWords(skill.name).title],
        select: () => skillPill(skill),
      })),
    }] : []), ...(agentCommands.length ? [{
      id: 'commands',
      groupLabel: t('composer.commands'),
      items: agentCommands.filter((c) => !hiddenSkills.has(c.name)).map((c) => ({
        id: `command:${c.name}`,
        kind: 'file' as const,
        icon: SquareSlash,
        label: `/${c.name}`,
        /* what it does, cut to the row */
        ...(c.description ? { detail: c.description, describes: true } : {}),
        /* found by its name, as in the agent's own chat (its description would put a word in it first) */
        keywords: [c.name],
        select: () => ({ text: `/${c.name}` }),
      })),
    }] : [])],
  } : undefined), [agentCommands, nameableSkills, hiddenSkills, skillPill, skillWords, t]);
  const mentionProviders = React.useMemo<MentionProvider[]>(() => {
    const picked = selection?.refs ?? [];
    const range = selection ? selectionRange(selection) : null;
    const pickedDetail = picked.length ? `${refPill(undefined, picked[0]!).label}${picked.length > 1 ? ` +${picked.length - 1}` : ''}` : '';
    return [
      {
        id: 'moment',
        groupLabel: t('mention.groupMoment'),
        items: [{
          id: 'moment:current',
          kind: 'time',
          label: t('mention.currentTime'),
          keywords: ['current time', 'now', 'timestamp'],
          ...(selection ? { detail: refPill(undefined, { kind: 'time', time: selection.time }).label } : { disabled: true, disabledHint: t('mention.currentTimeUnavailable') }),
          select: () => (selection ? takeStudioRefs([selectionMoment(selection)]) : null),
        },
        /* the range marked on the timeline's ruler, while there is one */
        ...(range ? [{
          id: 'moment:range',
          kind: 'range' as const,
          label: t('mention.currentRange'),
          keywords: ['range', 'in out', 'marked'],
          detail: refPill(undefined, range).label,
          select: () => takeStudioRefs([range]),
        }] : []), {
          id: 'moment:selection',
          kind: 'element',
          label: t('mention.currentSelection'),
          keywords: ['selection', 'selected', 'this'],
          ...(picked.length ? { detail: pickedDetail } : { disabled: true, disabledHint: t('mention.currentSelectionNone') }),
          /* everything selected, each its own pill: the clips picked on the timeline, then the layer picked in one */
          select: () => takeStudioRefs(picked),
        }],
      },
      {
        id: 'asset',
        groupLabel: t('mention.groupAssets'),
        items: mentionFiles.map((file) => {
          const name = file.path.split('/').pop() ?? file.path;
          const pill: PromptReference = { id: fileReferenceId(file.path), kind: 'file', label: file.kind === 'mg' ? name.replace(/\.html?$/i, '') : name, detail: formatFileSize(file.size) };
          return {
            id: pill.id, kind: pill.kind, label: pill.label, detail: pill.detail, keywords: [file.path],
            select: () => { setFileRefs((list) => (list.some((p) => p.id === pill.id) ? list : [...list, pill])); return pill; },
          };
        }),
      },
      /* TinTin(2026-10-24 §9.2 用户裁决): 技能也能从 @ 菜单引用 —— 原生 + 服务端全部技能,
         与 `/` 命令菜单同源(nameableSkills), 选中即插入技能 pill(正文注入走 app.skills.texts)。 */
      ...(nameableSkills.length ? [{
        id: 'skills',
        groupLabel: t('skills.button'),
        items: nameableSkills.slice(0, 32).map((skill) => ({
          id: skillReferenceId(skill.name),
          kind: 'skill' as const,
          icon: Blocks,
          label: skillWords(skill.name).title,
          ...(skillWords(skill.name, skill.description).summary ? { detail: skillWords(skill.name, skill.description).summary, describes: true } : {}),
          keywords: [skill.name, skillWords(skill.name).title],
          select: () => skillPill(skill),
        })),
      }] : []),
    ];
  }, [selection, mentionFiles, nameableSkills, skillPill, skillWords, t, takeStudioRefs]);
  const onComposerChange = React.useCallback((state: PromptEditorState) => {
    setFollowUp(state.text);
    setFollowUpRefs(state.references);
  }, []);

  /* Studio's "Reference in chat": the thing becomes a pill where the cursor is */
  React.useEffect(() => app.onRefer((ref) => {
    const [pill] = takeStudioRefs([ref]);
    requestAnimationFrame(() => { composerRef.current?.insertReference(pill!); composerRef.current?.focus(); });
  }), [takeStudioRefs]);

  /* Studio's things pasted into the composer, or dropped on its words: pills there */
  const onTransferReferences = React.useCallback((data: DataTransfer) => {
    const refs = studioRefsFromTransfer(data);
    return refs.length ? takeStudioRefs(refs) : null;
  }, [takeStudioRefs]);

  /* ⌘L in the composer points at what Studio's ⌘L would (Studio leaves the keys pressed in the chat alone) */
  const onComposerKey = (event: React.KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'l') return;
    if (!selection || !(event.target as Element).closest?.('[data-prompt-editor]')) return;
    event.preventDefault();
    event.stopPropagation();
    composerRef.current?.insertReferences(takeStudioRefs(selectionRefs(selection)));
  };

  /* a pill's hover card, in the composer and in what was sent; clicking one there takes the person to it in Studio */
  const describePill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => {
    const name = skillReferencePackage(pill.id);
    if (name) {
      const skill = nameableSkills.find((s) => s.name === name);
      const words = skillWords(name, skill?.description);
      return { title: words.title, rows: [], text: words.text };
    }
    return pillCard(pill, t);
  }, [t, nameableSkills, skillWords]);
  const revealPill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => {
    /* a skill: its page in the Community; anything else: where it is in Studio */
    const name = skillReferencePackage(pill.id);
    if (name) { app.showExamples?.({ kind: 'skill', name }); return; }
    const ref = refFromPill(pill);
    if (ref) app.showInStudio(ref);
  }, []);
  const sentPills = React.useMemo(
    () => ({ onReveal: revealPill, revealLabel: t('library.revealReference'), describe: describePill }),
    [revealPill, describePill, t],
  );

  /*
   * Pills and Studio point at each other: a pill hovered here (in the composer, the selection coming along, what was
   * sent, the agent's replies) lights what it stands for in Studio, without going there; what the pointer is over in
   * Studio lights the pills here that point at the same thing.
   */
  const pillHover = React.useMemo(() => {
    let over: StudioRef | null = null;
    const listeners = new Set<() => void>();
    const hover: PromptPillHover = {
      hover: (pill) => {
        const path = pill && !pill.target ? fileReferencePath(pill.id) : null;
        app.highlightInStudio(pill ? refFromPill(pill) ?? (path ? { kind: 'file', path, fileKind: pill.kind } : null) : null);
      },
      lit: (pill) => {
        if (!over) return false;
        const ref = refFromPill(pill);
        return Boolean(ref && sameStudioThing(over, ref));
      },
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const set = (ref: StudioRef | null) => { over = ref; for (const listener of listeners) listener(); };
    return { hover, set };
  }, []);
  React.useEffect(() => app.onStudioHover(pillHover.set), [pillHover]);

  /* the references of the message being written, numbered in Studio as the agent will read them ([] once sent) */
  const draft = React.useMemo(
    () => draftRefs(splitPromptReferenceText(followUp).flatMap((segment) => (segment.kind === 'reference' ? [segment.id] : [])), studioRefs),
    [followUp, studioRefs],
  );
  const draftKey = draft.map((ref) => refPill(undefined, ref).id).join('|');
  React.useEffect(() => { app.draftRefsInStudio(draft); }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => { app.draftRefsInStudio([]); app.highlightInStudio(null); }, []);

  /** each open turn's way to settle (by turn id), and the agent's run each running turn belongs to */
  const settlers = React.useRef(new Map<string, (patch: Partial<Turn & TurnBalance>) => void>());
  const runs = React.useRef(new Map<string, Promise<unknown>>());
  /** the conversation shown now (a turn opened in another is kept, not shown) */
  const shownSession = React.useRef(sessionId);
  shownSession.current = sessionId;

  /* the agent working with nobody having written, in a conversation of this project: a background task of its own came
     back, and it takes it up, as in its own chat. A turn of its own, under a line saying so */
  const openTurnNow = React.useRef(openTurn);
  openTurnNow.current = openTurn;
  React.useEffect(() => onUnpromptedTurn(({ projectId, conversation, agent: by }) => {
    if (projectId !== projectKey) return null;
    const id = makeLocalAgentTurnId();
    const opened = openTurnNow.current(id, '', null, [], { conversation, by, origin: 'background' });
    return {
      turn: opened.turn,
      meta: opened.meta,
      done: (outcome) => settlers.current.get(id)?.(outcome === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' }),
    };
  }), [projectKey]);

  /**
   * One turn of the conversation: shown at once, kept, and settled by `settlers` when the agent is done with it. The
   * project's files are read as it opens (`ready`), so what it changed in them is shown under its reply.
   */
  function openTurn(
    id: string, instruction: string, promptDisplay: Turn['promptDisplay'] | null, attachments: Turn['attachments'] = [],
    /* a turn the agent started by itself (a background task of its own came back): in its own conversation, maybe not
       the one shown, by the agent of that session */
    { conversation = sessionId, by = agent, origin }: { conversation?: string; by?: LocalAgentId; origin?: 'background' } = {},
  ): { turn: LocalAgentTurn; meta: LocalAgentTurnMeta; prefs: Record<string, unknown>; ready: Promise<boolean> } {
    const agent = by;
    const sessionId = conversation;
    const shown = conversation === shownSession.current;
    const turn = createLocalAgentTurn(id, agent, ordered.length);
    const agentStore = useLocalAgents.getState();
    const options = agentOptions(agentStore, agent);
    const prefs = effectivePrefs(agentStore.prefs, agent, agentStore.roster, options);
    const summary = agentModelSummary(options, prefs);
    /* how hard it thinks, as the menu offers it */
    const effortOption = options?.find((o) => o.category === 'thought_level');
    const effort = effortOption && offeredOption(agent, agentStore.roster, effortOption) ? summary.effort : null;
    const modelLabel = [summary.model, effort].filter(Boolean).join(' · ');
    const started: Turn = {
      ...makePlaceholder(id, 'video', instruction, { projectId: projectKey, sessionId }),
      ...(promptDisplay ? { promptDisplay } : {}),
      ...(attachments?.length ? { attachments } : {}),
      localAgent: { id: agent, model: modelLabel || null },
      ...(origin ? { origin } : {}),
    } as Turn;
    if (shown) setTurns((list) => mergeAssetLists([started], list));
    /* the conversation is named by the words: a reference reads as its name there, not as "[1: name]" */
    const title = instruction.replace(/\[\d+: ([^\]]*)\]/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 80);
    touchSession(sessionId, (s) => ({ title: s.title || title, turns: s.turns + 1 }));
    const meta: LocalAgentTurnMeta = {
      turnId: id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction,
      turnNo: ordered.length, startedAt: Date.now(), turn: started,
    };
    registerRunningLocalTurn({ id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction, startedAt: meta.startedAt, turn: started });
    /* the project's files as the turn found them (read before the agent is sent anything); once the turn settles,
       what it changed in them is kept with it and shown under its reply. The turn settles first: comparing the files
       is not worth keeping the person waiting for */
    const ready = app.chat.snapshot(project.path, id).then(() => true, () => false);
    /* kept as it goes, not only once it ends: the app closed (or crashed) on a turn, it is still there, read back as
       interrupted, what it did so far shown and the next message going on from there */
    let keeping: ReturnType<typeof setTimeout> | null = null;
    const keep = () => { keeping = null; if (settlers.current.has(id)) saveLocalAgentTurn(meta.projectId, { ...started, updatedAt: new Date().toISOString() }, restingItems(turn.items)); };
    const stopKeeping = turn.store.subscribe(() => { keeping ??= setTimeout(keep, KEEP_RUNNING_MS); });
    settlers.current.set(id, (patch) => {
      settlers.current.delete(id);
      if (keeping) clearTimeout(keeping);
      stopKeeping();
      const done = settleLocalTurn(meta, turn, patch);
      void ready.then(async (taken) => {
        const found = taken ? await app.chat.changes(project.path, id).catch(() => null) : null;
        const fileChanges = found?.files ?? [];
        if (!fileChanges.length) return;
        const kept: Turn & TurnFileChanges = { ...done, fileChanges };
        saveLocalAgentTurn(meta.projectId, kept, turn.items);
        setTurns((list) => list.map((item) => (item.id === id ? { ...item, fileChanges } : item)));
      });
    });
    keep();
    return { turn, meta, prefs, ready };
  }

  /**
   * Send a turn to the agent: what it is sent (`prepared`: the text, and the pictures) may take a moment to make. It
   * settles the turn the agent's run ends on: this one, or the last message sent into it while it ran (steerTurn).
   */
  function runTurn(opened: ReturnType<typeof openTurn>, prepared: Promise<{ text: string; images: PromptImage[]; skills?: string[] }>): void {
    const { turn, meta, prefs, ready } = opened;
    const id = meta.turnId;
    const finish = (lastTurnId: string | undefined, patch: Partial<Turn & TurnBalance>) => {
      settlers.current.get(lastTurnId ?? id)?.(patch);
      settlers.current.get(id)?.(patch);
    };
    /* the agent's own session of this conversation, gone on with (after a restart too); a new one is kept for next time */
    const resume = sessions.find((s) => s.id === sessionId)?.agentSessions?.[agent] ?? null;
    const run = Promise.all([prepared, ready]).then(([{ text, images, skills }]) => runLocalAgentTurn({
      projectId: projectKey,
      conversation: sessionId,
      resume,
      agent,
      cwd: project.path,
      text,
      images,
      turn,
      options: prefs,
      meta,
      onSessionInfo: (info) => {
        useLocalAgents.getState().noteOptions(agent, info.configOptions);
        /* a session it could not take up again has none of the skills' pages from before: those of this message only */
        const fresh = !info.resumed || info.sessionId !== resume;
        if (info.sessionId && fresh) {
          touchSession(sessionId, (s) => ({
            agentSessions: { ...s.agentSessions, [agent]: info.sessionId },
            skillsGiven: givenAfter(s.skillsGiven, agent, info.sessionId, skills ?? [], { fresh }),
          }));
        }
      },
    })).then(
      ({ stopReason, lastTurnId }) => finish(lastTurnId, stopReason === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' }),
      (error: unknown) => {
        /* the ACP adapter wraps the agent's own message as JSON-RPC "Internal error: …": the message is the reason */
        const reason = (error instanceof Error ? error.message : String(error)).replace(/^Internal error:\s*/i, '').trim() || String(error);
        /* the service the app's own agent runs on has no balance left: said as such, with its page, not as an error */
        const balance = readBalance((error as { balance?: unknown } | null)?.balance);
        const lastTurnId = (error as { lastTurnId?: string } | null)?.lastTurnId;
        (localAgentTurn(lastTurnId ?? id) ?? turn).patch(balance ? { balance } : { error: reason });
        finish(lastTurnId, { status: 'error', error: reason, ...(balance ? { balance } : {}) });
      },
    ).finally(() => { runs.current.delete(id); });
    runs.current.set(id, run);
  }

  /**
   * A message sent while a turn runs, as in the agent's own chat: into that turn, the agent reading it at its next step
   * (an agent that takes steering). It shows as a turn of its own, what the agent says from then on under it, and the
   * running one is done. One that did not join (the turn ended meanwhile) is sent once that run ends.
   */
  function steerTurn(fromId: string, opened: ReturnType<typeof openTurn>, prepared: Promise<{ text: string; images: PromptImage[]; skills?: string[] }>): void {
    /* the agent's run going now (one at a time in a conversation): a message that did not join waits for it */
    const run = [...runs.current.values()].at(-1) ?? Promise.resolve();
    void Promise.all([prepared, opened.ready]).then(async ([{ text, images, skills }]) => {
      if (await steerLocalAgentTurn(fromId, opened.turn, text, images)) {
        settlers.current.get(fromId)?.({ status: 'ready' });
        return;
      }
      await run.catch(() => {});
      runTurn(opened, Promise.resolve({ text, images, ...(skills ? { skills } : {}) }));
    });
  }

  function submitFollowUp(): void {
    if (!followUpFilled) return;
    /* while a turn runs: into it, for an agent that takes that; else it waits for the turn to end */
    const steer = active && asset ? canSteer(asset.id) : false;
    if (active && !steer) { setQueued(true); return; }
    setQueued(false);
    /* the sentence as the agent reads it: a pill becomes "[n: name]", and what each number is follows, in a block */
    const used: StudioRef[] = [];
    const instruction = resolvePromptReferences(followUp, (pillId, index) => {
      const ref = studioRefs.get(pillId);
      if (!ref) return null;
      used[index - 1] = ref;
      return `[${index}: ${refPill(pillId, ref).label}]`;
    }, (pillId) => { const name = skillReferencePackage(pillId); return name ? `skill “${name}”` : null; }).trim();
    /* the skills it names, for this message: each one's SKILL.md follows it, unseen in the chat, the first time this
       conversation's agent session meets that skill (lib/skill-pages) */
    const agentSession = sessions.find((s) => s.id === sessionId)?.agentSessions?.[agent] ?? null;
    const skillNames = pagesToSend(activatedSkillIds(followUpRefs), sessions.find((s) => s.id === sessionId)?.skillsGiven, agent, agentSession);
    if (!instruction) return;
    const blocker = attachmentBlocker(composerFiles.files, t);
    if (blocker) { setFollowUpError(blocker); return; }
    setFollowUpError(null);
    const promptDisplay = buildPromptDisplay(followUp, followUpRefs);
    thread.scrollToBottom({ smooth: true });
    composerRef.current?.clear();
    setFollowUp('');
    setFollowUpRefs([]);
    setStudioRefs(new Map());
    setFileRefs([]);
    setSkillRefs([]);
    const files = composerFiles.take();
    const id = makeLocalAgentTurnId();
    const said = instruction + attachedText(files);
    const refs = used.filter(Boolean);
    const stage = selection?.stage ?? null;
    /* each reference's picture is kept in the project for the agent (the block names it), and sent to one that takes pictures */
    const skillTexts = skillNames.length ? (app.skills?.texts(project.path, agent, skillNames).catch(() => []) ?? Promise.resolve([])) : Promise.resolve([]);
    if (skillNames.length) touchSession(sessionId, (s) => ({ skillsGiven: givenAfter(s.skillsGiven, agent, agentSession, skillNames) }));
    /* an example pointed at: its folder fetched now if it is not yet (the turn waits, as it waits for its reply) */
    const withFolders = Promise.all(refs.map(async (ref) => (ref.kind === 'example' && !ref.folder
      ? { ...ref, folder: await app.exampleFolder?.(ref.id).catch(() => undefined) } : ref)));
    /* the pictures sent: the references' first, then the attached ones while there is room (the rest by their path) */
    const prepared = withFolders.then((ready) => Promise.all([referencePictures(ready, { project: project.path, turnId: id }), skillTexts])
      .then(async ([{ pictures, images }, skills]) => ({
        text: said + studioReferencesText(ready, { stage, pictures }) + skills.map((s) => `\n\n${s.text}`).join(''),
        images: [...images, ...await attachedPictures(files, PROMPT_PICTURES_MAX - images.length)],
        skills: skills.map((s) => s.name),
      })));
    const opened = openTurn(id, instruction, promptDisplay ?? null, turnAttachments(files));
    if (steer && asset) steerTurn(asset.id, opened, prepared);
    else runTurn(opened, prepared);
  }

  /* queued while the turn ran (an agent that cannot take a message mid-turn): sent as soon as it ends */
  React.useEffect(() => { if (queued && !active) submitFollowUp(); }, [queued, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNewSession = () => {
    if (active) return;
    setSessionId(newSession().id);
    composerRef.current?.focus();
  };
  newConversation.current = onNewSession;
  const onSelectSession = (id: string) => { if (!active) setSessionId(id); };
  const onRenameSession = async (title: string) => { touchSession(sessionId, () => ({ title })); };
  const shownSessions = React.useMemo(
    () => (sessions.some((s) => s.id === sessionId) ? sessions : [{ ...newSession(), id: sessionId }, ...sessions]),
    [sessions, sessionId],
  );

  const agentName = agent === 'byok' ? t('composer.agentOwnKey') : la.roster?.find((a) => a.id === agent)?.name ?? agent;

  const editComposerCard = (
    <div className="flex flex-col gap-1">
      {contextFull ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-3 pr-1.5 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">{t('composer.contextFull')}</span>
          <button type="button" onClick={onNewSession}
            className="h-6 shrink-0 rounded-[6px] px-2 text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('composer.contextFullNew')}</button>
          <button type="button" onClick={() => setContextNoticeOff(sessionId)} aria-label={t('project.close')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={12} /></button>
        </div>
      ) : null}
      <div
        /* a file from the disk dropped on the card is brought along (it goes into the project); Studio's things
           dropped on it become pills */
        onKeyDownCapture={onComposerKey}
        onDragOver={(event) => {
          if (!transferHasStudioRefs(event.dataTransfer) && ![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropping(false);
        }}
        onDrop={(event) => {
          setDropping(false);
          /* Studio's first (a file of its media pane may carry the file too): dropped on the words, the editor has
             put the pills where it was let go; on the rest of the card, they go where the cursor was */
          if (transferHasStudioRefs(event.dataTransfer)) {
            if (!event.nativeEvent.defaultPrevented) {
              composerRef.current?.insertReferences(takeStudioRefs(studioRefsFromTransfer(event.dataTransfer)), { x: event.clientX, y: event.clientY });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!transferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          composerFiles.add(filesFromTransfer(event.dataTransfer));
        }}
        data-prompt-shell=""
        className={`rounded-[12px] border bg-[var(--composer-bg)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-colors duration-200 ${
          dropping ? 'border-[var(--accent)]' : 'border-[var(--composer-border)] focus-within:border-[var(--composer-border-active)]'
        }`}
      >
        {composerFiles.files.length > 0 && (
          /* whole rows: up to three show at once, only more than that scrolls */
          <div className="flex max-h-[144px] flex-wrap gap-1.5 overflow-y-auto px-3.5 pt-3">
            {composerFiles.files.map((file) => {
              const Icon = attachmentIcon({ name: file.name, mediaType: file.mediaType, folder: file.folder });
              const remove = (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(event) => { event.stopPropagation(); composerFiles.drop(file.id); }}
                  aria-label={t(file.kind === 'image' ? 'composer.removeImage' : 'composer.removeFile')}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <X size={10} />
                </span>
              );
              const busy = file.state === 'pending' ? <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white drop-shadow" /> : null;
              /* a picture shows itself; a video, a frame of itself with a play mark (once one is had) */
              const picture = file.kind === 'image' ? file.previewUrl : file.thumb;
              /* clicked, it opens to look at: a picture large, a video played, a text read; a folder, shown where it is */
              const folderPath = file.folder && file.state === 'ready' ? file.path : undefined;
              const open = file.previewUrl || folderPath ? {
                role: 'button' as const,
                tabIndex: 0,
                'aria-label': t(folderPath ? 'composer.revealFolder' : 'composer.openAttachment').replace('{name}', file.name),
                onClick: () => (folderPath
                  ? void desktopBridge()?.revealPath(folderPath)
                  : setOpenedFile({ name: file.name, kind: file.kind, url: file.previewUrl!, ...(file.mediaType ? { mediaType: file.mediaType } : {}) })),
                onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (event.currentTarget as HTMLElement).click(); } },
              } : {};
              return picture ? (
                <div key={file.id} title={file.error ?? file.path ?? file.name} {...open}
                  className={`group ${ATTACHMENT_THUMB} transition ${file.previewUrl ? 'cursor-pointer' : ''} ${file.state === 'failed' ? 'border-[var(--danger)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
                  <img src={picture} alt={file.name} className={`h-full w-full object-cover transition ${file.state === 'ready' ? '' : 'opacity-45'}`} />
                  {file.kind !== 'image' && !busy ? <PlayMark /> : null}
                  {busy}
                  {remove}
                </div>
              ) : (
                <div key={file.id} title={file.error ?? file.path ?? file.name} {...open}
                  className={`group ${ATTACHMENT_CARD} transition ${file.previewUrl || folderPath ? 'cursor-pointer' : ''} ${file.state === 'failed' ? 'border-[var(--danger)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
                  <AttachmentCardBody
                    icon={file.state === 'pending' ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                    name={file.name}
                    /* a folder's size is not read: where it is says more */
                    detail={file.state === 'failed' ? 'Not added' : file.folder ? (file.path ? attachmentPlace(file.path) : null) : formatFileSize(file.size)}
                  />
                  {remove}
                </div>
              );
            })}
          </div>
        )}
        {openedFile ? <AttachmentPreview item={openedFile} onClose={() => setOpenedFile(null)} /> : null}
        <div className="flex items-end gap-1 py-2.5 pl-3.5 pr-2">
          <div className="min-w-0 flex-1">
            <PromptEditor
              ref={composerRef}
              defaultValue=""
              references={composerPills}
              onChange={onComposerChange}
              onSubmit={submitFollowUp}
              onReveal={revealPill}
              describe={describePill}
              onTransferReferences={onTransferReferences}
              revealLabel={t('library.revealReference')}
              removeLabel={t('library.removeReference')}
              placeholder={t(blank ? 'project.composerPlaceholderBlank' : 'project.composerPlaceholder')}
              minHeight={22}
              maxHeight={158}
              contentClassName="text-[14px] leading-[22px] text-[var(--chat-text)]"
              onPasteFiles={(files) => composerFiles.add(files)}
              mentions={{ providers: mentionProviders, label: t('mention.menu'), onOpen: loadMentionFiles }}
              commands={commandMenu}
            />
          </div>
          {/* while it works: Stop, or Send once something is written (it goes into the turn, or after it); Esc stops */}
          <Tooltip label={stopping ? t('project.stop') : t('project.sendFollowUp')} shortcut={stopping ? 'Esc' : 'Enter'}>
            <button
              type="button"
              onClick={stopping ? () => { if (asset) void cancelLocalAgentTurn(asset.id); } : submitFollowUp}
              disabled={stopping ? false : !followUpFilled}
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[var(--text-dim)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
              aria-label={stopping ? t('project.stop') : t('project.sendFollowUp')}
            >
              {stopping ? <Square size={14} /> : <CornerDownLeft size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-0.5 px-0.5">
        <ModelPopover placement="top" align="start" />
        <div className="min-w-0 flex-1" />
        <input
          ref={attachInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => { composerFiles.add(Array.from(event.target.files ?? [])); event.target.value = ''; }}
        />
        <Tooltip label={t('project.addAttachment')}>
          <button type="button" onClick={() => attachInputRef.current?.click()} className="openfilm-composer-tool" aria-label={t('project.addAttachment')}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        {app.showExamples ? (
          <Tooltip label={t('community.tooltip')}>
            <button type="button" onClick={() => app.showExamples?.()} className="openfilm-composer-tool" aria-label={t('community.button')}>
              <Blocks size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip label={t('project.assets')}>
          <button type="button" onClick={() => app.setAssetsOpen(!assetsOpen)} aria-pressed={assetsOpen} className="openfilm-composer-tool" aria-label={t('project.assets')}>
            <LibraryBig size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  /* Esc stops the turn while it runs (the send button's other half) */
  React.useEffect(() => {
    if (!active || !asset) return undefined;
    /* only an Esc pressed in the chat: one in Studio closes Studio's menu or dialog, it does not stop the agent */
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && inChat(event.target)) void cancelLocalAgentTurn(asset.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, asset]);

  return (
    <ChatProjectContext.Provider value={projectKey}>
      <PromptPillHoverContext.Provider value={pillHover.hover}>
        <WaitingContext.Provider value={Boolean(localTurn?.state.question || localTurn?.state.permission || spendAsk)}>
          <StickToBottomContext.Provider value={thread}>
            {/* with the assets open only the composer shows, at the bottom: the drawer above it is Studio's, and the two
                read as one pane */}
            <aside className={`relative flex min-h-0 flex-col overflow-hidden bg-[var(--dock-pane)] ${assetsOpen ? 'mt-auto shrink-0 rounded-b-[7px]' : 'flex-1 rounded-[7px]'}`}>
              {assetsOpen ? null : banners}
              <div className={`relative min-h-0 min-w-0 flex-1 flex-col ${assetsOpen ? 'hidden' : 'flex'}`}>
                <ConversationSessionBar
                  sessions={shownSessions}
                  currentSessionId={sessionId}
                  onNewSession={onNewSession}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  busy={active}
                />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  {/* the first message well below the session bar, as a chat app opens a conversation; the last well above
                      the composer, room for the way back to it */}
                  <div
                    ref={thread.viewportRef}
                    onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
                    className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable] px-4${blank ? ' justify-center py-3.5' : ' pt-8 pb-24'}`}
                  >
                    {blank ? (
                      <div ref={thread.contentRef}>
                        <ProjectStarters
                          onPick={(text) => { composerRef.current?.setText(text); composerRef.current?.focus(); }}
                          onAttach={() => attachInputRef.current?.click()}
                        />
                      </div>
                    ) : (
                      <div ref={thread.contentRef} className="min-w-0 shrink-0">
                        <PromptPillRevealContext.Provider value={sentPills}>
                          <LiveConversation
                            store={liveStore}
                            turns={opLog}
                            liveAssetId={active ? asset!.id : null}
                            liveActive={active}
                            liveActivity={activity}
                            lastTurnRef={tail.lastTurnRef}
                          />
                        </PromptPillRevealContext.Provider>
                      </div>
                    )}
                  </div>
                  <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[var(--dock-pane)] to-transparent transition-opacity duration-150 ${scrolled && !blank ? 'opacity-100' : 'opacity-0'}`} />
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--dock-pane)] to-transparent" />
                  {!blank && !thread.atBottom && (
                    <Tooltip label={t('project.jumpToLatest')}>
                      <button
                        type="button"
                        onClick={() => thread.scrollToBottom({ smooth: true })}
                        aria-label={t('project.jumpToLatest')}
                        className="absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-dim)] shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                      >
                        <ArrowDown size={17} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>

              <div ref={composerBlockRef} className={`relative flex shrink-0 flex-col px-4 pb-1.5 ${assetsOpen ? 'pt-2' : ''}`}>
                <div className="flex flex-col gap-2">
                  {spendAsk ? (
                    <ComposerCard role="alertdialog" icon={<Coins size={14} />} title={spendAsk.title}
                      body={spendAsk.body ? <span className="break-words">{spendAsk.body}</span> : undefined}>
                      <CardActions>
                        <CardButton weight="quiet" onClick={() => app.asks.answer(spendAsk.id, false)}>{spendAsk.denyLabel}</CardButton>
                        <CardButton weight="primary" onClick={() => app.asks.answer(spendAsk.id, true)}>{spendAsk.allowLabel}</CardButton>
                      </CardActions>
                    </ComposerCard>
                  ) : null}
                  {localTurn?.state.question ? (
                    <LocalAgentQuestionCard
                      key={localTurn.state.question.requestId}
                      questions={localTurn.state.question.questions}
                      onDone={(answers) => { if (asset) void answerLocalAgentQuestion(asset.id, answers); }}
                    />
                  ) : null}
                  {localTurn?.state.permission ? (
                    <ComposerCard
                      role="alertdialog"
                      icon={<ShieldQuestion size={14} />}
                      title={t('composer.agentPermissionTitle').replace('{name}', agentName)}
                      body={localTurn.state.permission.title ? (
                        <span className="break-words font-mono text-[11.5px]">{localTurn.state.permission.title}</span>
                      ) : undefined}
                    >
                      <CardActions className="flex-wrap">
                        <CardButton weight="quiet" onClick={() => { if (asset) void answerLocalAgentPermission(asset.id, null); }}>
                          {t('composer.agentPermissionDeny')}
                        </CardButton>
                        {localTurn.state.permission.options.map((option, index) => (
                          <CardButton
                            key={option.optionId}
                            weight={index === 0 && option.kind.startsWith('allow') ? 'primary' : 'secondary'}
                            onClick={() => { if (asset) void answerLocalAgentPermission(asset.id, option.optionId); }}
                          >
                            {option.name}
                          </CardButton>
                        ))}
                      </CardActions>
                    </ComposerCard>
                  ) : null}
                  {turnError ? (
                    <p role="alert" className="text-xs text-[var(--err)]">
                      {turnError}{' '}
                      {/* what to send when it keeps failing */}
                      <span className="text-[var(--text-muted)]"><CopyDiagnostics /></span>
                    </p>
                  ) : null}
                  {localTurn?.state.balance ? <BalanceNotice balance={localTurn.state.balance} /> : null}
                  {followUpError && <p className="text-xs text-[var(--err)]">{followUpError}</p>}
                  {queued && active ? (
                    <p role="status" className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span className="min-w-0 flex-1">{t('composer.queued')}</span>
                      <button type="button" onClick={() => setQueued(false)} className="shrink-0 underline underline-offset-2 hover:text-[var(--text)]">{t('composer.queuedCancel')}</button>
                    </p>
                  ) : null}
                  {editComposerCard}
                </div>
              </div>
            </aside>
          </StickToBottomContext.Provider>
        </WaitingContext.Provider>
      </PromptPillHoverContext.Provider>
    </ChatProjectContext.Provider>
  );
}

/** The conversation subscribes to the transcript on its own, so streamed tokens re-render only it, not the whole page. */
function LiveConversation({ store, ...rest }: { store: LocalTranscriptStore } & Omit<React.ComponentProps<typeof ProjectConversation>, 'liveTranscript'>) {
  const transcript = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  return <ProjectConversation {...rest} liveTranscript={transcript} />;
}

function Banner({ tone = 'plain', action, children }: { tone?: 'plain' | 'error'; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[12px] leading-snug ${tone === 'error' ? 'border-[color-mix(in_srgb,var(--err)_25%,transparent)] text-[var(--err)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <CardButton weight="secondary" className="h-6 px-2" onClick={action.onClick}>{action.label}</CardButton> : null}
    </div>
  );
}
