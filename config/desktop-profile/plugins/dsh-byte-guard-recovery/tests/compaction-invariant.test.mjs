import { foldSurface, deriveEventMessage } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/core/session/src/index.ts';
import { apply as installCompactionInvariant } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/compaction/compaction/src/invariant.ts';
import { foldSurfaceProjection } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/llm/token-meter/src/surface-projection.ts';
import { estimateMessage } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/llm/token-meter/src/estimate.ts';
import { apply as plugin } from '/home/fate/.dsh/profiles/desktop/plugins/dsh-byte-guard-recovery/index.js';

// ---- a session whose appends run the REAL compaction invariant --------
const invariantEvents = [];
let failCount = 0;
const failMessages = [];

class GuardedSession {
  constructor(events) {
    this.events = events.map((e, seq) => ({ ...e, seq }));
    this.handlers = {};
    this._nodes = foldSurface(this.events, []).nodes;
    this.replaceGeneration = 0;
  }
  snapshotEvents() { return this.events; }
  get surface() { return { nodes: this._nodes, replaceGeneration: this.replaceGeneration, contentGeneration: 0 }; }
  eventAt(seq) { return this.events[seq]; }
  deriveEventMessage(event) { return deriveEventMessage(event); }
  on(name, fn) { this.handlers[name] = fn; }
  append(type, data, opts) {
    const event = {
      seq: this.events.length, type, data,
      ...(opts?.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp }),
      ...(opts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs }),
    };
    // cordis pre-commit: internal/dispatch runs invariant validation first
    for (const fn of Object.values(this.handlers)) void fn;
    this.dispatch('internal/dispatch', 'session/event', [this, event]);
    const candidate = [...this.events, event];
    const folded = foldSurface(candidate, []);
    this.events = candidate.map((e, seq) => ({ ...e, seq }));
    this._nodes = folded.nodes;
    this.replaceGeneration = folded.replacements.length;
    // post-commit: session/event observers advance the invariant trace
    this.dispatch('session/event', null, [this, event]);
    return event;
  }
  dispatch(mode, eventName, args) {
    for (const [name, fn] of Object.entries(this.pluginHandlers ?? {})) void name;
    if (eventName === null) { this.handlers[mode](...args); invariantEvents.push(args[1]); return; }
    if (mode === 'internal/dispatch') { this.handlers['internal/dispatch'](mode, eventName, args); invariantEvents.push(args[1]); return; }
    this.handlers['session/event'](this, args[1]);
  }
}

function m(role, content, source, extra = {}) {
  return { id: `${role}-${Math.random().toString(36).slice(2)}`, role, content, source, ...extra };
}

function buildLog(n, toolEvery) {
  const events = [
    { type: 'system/message', surfaceOp: 'append', data: { message: m('system', [{ type: 'text', text: 'sys' }], { kind: 'system-prompt' }) } },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
  ];
  for (let i = 0; i < n; i++) {
    if (toolEvery && i % toolEvery === 0 && i > 0) {
      events.push({ type: 'assistant/message', surfaceOp: 'append', data: { message: m('assistant', [{ type: 'tool-call', id: `c${i}`, name: 'read', arguments: '{}' }], { kind: 'model', provider: 'github-copilot', model: 'gpt-6-sol' }) } });
      events.push({ type: 'tool/result', surfaceOp: 'append', data: { message: m('tool', [{ type: 'text', text: `res ${i} ${'y'.repeat(400)}` }], { kind: 'tool', callId: `c${i}` }, { toolCallId: `c${i}` }) } });
    } else {
      events.push({ type: 'user/message', surfaceOp: 'append', data: m('user', [{ type: 'text', text: `prompt ${i} ${'x'.repeat(300)}` }], { kind: 'user' }) });
    }
  }
  return events;
}

const session = new GuardedSession(buildLog(70, 4));

const invariantCtx = {
  invariants: {
    register: (_pkg, install) => install(invariantCtx, (message) => { failCount += 1; failMessages.push(message); throw new Error(`invariant: ${message}`); }),
  },
  sessions: { list: () => [session], messageProjections: [] },
  on: (name, fn) => { session.handlers[name] = fn; },
};
await installCompactionInvariant(invariantCtx);

// ---- drive the plugin against the guarded session ---------------------
const logs = [];
const ctx = {
  handlers: {},
  on: (name, fn) => { ctx.handlers[name] = fn; },
  get: (name) => ({
    toolResultPruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) },
    compaction: undefined,
    tokenMeter: { estimateMessage },
  })[name],
  logger: { info: x => logs.push(['I', x]), warn: x => logs.push(['W', x]) },
};
plugin(ctx, undefined);

const BYTE_ERR = Object.assign(
  new Error('pi-ai request body is estimated at 2108859 bytes, exceeding the 2097152-byte bound even without images'),
  { code: 'INVALID_REQUEST' },
);
const agent = { session };
const signal = new AbortController().signal;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { cond ? (pass++, console.log(`ok   ${name}`)) : (fail++, console.log(`FAIL ${name} ${detail}`)); };

function pressureTotal(events) {
  let claim, total = 0;
  for (const e of events) { const f = foldSurfaceProjection(claim, e); total += f.deltaTokens; claim = f.claim; }
  return total;
}

const before = pressureTotal(session.events);
const outs = [];
for (let i = 0; i < 3; i++) outs.push(await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal }, () => 'next'));
const after = pressureTotal(session.events);

const discards = session.events.filter(e => e.type === 'user/message' && e.surfaceOp?.op === 'replace');
const prices = session.events.filter(e => e.type === 'compaction/prune');

check('invariant accepted every discard append', failCount === 0 && discards.length === 3, `fails=${failCount} ${failMessages.join(' | ')}`);
check('three retries', outs.every(o => o?.kind === 'retry'), JSON.stringify(outs));
check('pressure dropped by the real fold', after < before * 0.6, `${before} -> ${after}`);
check('no compaction bracket invented', !session.events.some(e => ['compaction/start', 'compaction/summary', 'compaction/end'].includes(e.type)));
check('placeholder kind is plugin-owned', discards.every(e => e.data.source.kind === 'byte-guard-discard' && e.data.source.compactionId === undefined));
check('each replacement cites its whole span', discards.every((e, i) => {
  const { startSeq, endSeq } = e.surfaceOp;
  const si = prices[i].data.shadowedSeqs[0];
  const ei = prices[i].data.shadowedSeqs.at(-1);
  return si === startSeq && ei === endSeq && e.sourceEventSeqs.length === prices[i].data.shadowedSeqs.length;
}));
check('system head survived', session.eventAt(session.surface.nodes[0]).type === 'system/message');
check('no orphan tool result', (() => {
  const open = new Set();
  for (const seq of session.surface.nodes) {
    const e = session.eventAt(seq);
    if (e.type === 'assistant/message') for (const b of e.data.message.content) if (b.type === 'tool-call') open.add(b.id);
    if (e.type === 'tool/result') { if (!open.has(e.data.message.toolCallId)) return false; open.delete(e.data.message.toolCallId); }
  }
  return true;
})());

// reload path: replay the whole durable log through seed() with a fresh trace
const reloaded = new GuardedSession(session.events);
reloaded.handlers = {};
let reloadFails = 0;
const reloadCtx = {
  invariants: { register: (_p, install) => install(reloadCtx, () => { reloadFails += 1; }) },
  sessions: { list: () => [reloaded], messageProjections: [] },
  on: (name, fn) => { reloaded.handlers[name] = fn; },
};
await installCompactionInvariant(reloadCtx);
check('replay from a cold trace accepts the log', reloadFails === 0, `fails=${reloadFails}`);

console.log(`\n${pass} passed, ${fail} failed`);
console.log('log:', logs.map(l => l[1]).join('\n'));
process.exit(fail ? 1 : 0);
