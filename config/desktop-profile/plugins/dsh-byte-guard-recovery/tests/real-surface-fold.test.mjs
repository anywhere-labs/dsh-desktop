import { foldSurface, deriveEventMessage } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/core/session/src/index.ts';
import { foldSurfaceProjection } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/llm/token-meter/src/surface-projection.ts';
import { estimateMessage } from '/home/fate/Tools/Deepseek/dsh-desktop/deepseek-harness/packages/llm/token-meter/src/estimate.ts';
import { apply } from '/home/fate/.dsh/profiles/desktop/plugins/dsh-byte-guard-recovery/index.js';

// ---- real session fold over a synthetic log ---------------------------
const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);

class RealFoldSession {
  constructor(events) {
    this.events = events.map((e, seq) => ({ ...e, seq }));
    this.replaceGeneration = 0;
    this.recomputes = 0;
  }
  // every append is validated by replaying the whole log through the real fold
  append(type, data, opts) {
    const candidate = { seq: this.events.length, type, data, ...toSurfaceFields(opts) };
    const next = [...this.events, candidate];
    const folded = foldSurface(next, []);
    this.recomputes += 1;
    this.events = next.map((e, seq) => ({ ...e, seq }));
    this._nodes = folded.nodes;
    this.replaceGeneration = folded.replacements.length;
    return this.events[this.events.length - 1];
  }
  get surface() {
    if (!this._nodes) this._nodes = foldSurface(this.events, []).nodes;
    return { nodes: this._nodes, replaceGeneration: this.replaceGeneration, contentGeneration: 0 };
  }
  eventAt(seq) { return this.events[seq]; }
  deriveEventMessage(event) { return deriveEventMessage(event); }
}

function toSurfaceFields(opts) {
  if (!opts) return {};
  return { ...(opts.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp }), ...(opts.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs }) };
}

function m(role, content, source, extra = {}) {
  return { id: `${role}-${Math.random().toString(36).slice(2)}`, role, content, source, ...extra };
}

function buildLog(n, toolEvery) {
  const events = [
    { type: 'system/message', surfaceOp: 'append', data: { message: m('system', [{ type: 'text', text: 'you are a coding agent' }], { kind: 'system-prompt' }) } },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
  ];
  for (let i = 0; i < n; i++) {
    if (toolEvery && i % toolEvery === 0 && i > 0) {
      events.push({ type: 'assistant/message', surfaceOp: 'append', data: { message: m('assistant', [{ type: 'tool-call', id: `c${i}`, name: 'read', arguments: '{"path":"a"}' }], { kind: 'model', provider: 'github-copilot', model: 'gpt-6-sol' }) } });
      events.push({ type: 'tool/result', surfaceOp: 'append', data: { message: m('tool', [{ type: 'text', text: `result ${i} ${'y'.repeat(400)}` }], { kind: 'tool', callId: `c${i}` }, { toolCallId: `c${i}` }) } });
    } else {
      events.push({ type: 'user/message', surfaceOp: 'append', data: m('user', [{ type: 'text', text: `prompt ${i} ${'x'.repeat(300)}` }], { kind: 'user' }) });
    }
  }
  return events;
}

/** Pressure meter fold: replay the real O(1) projection over the whole log. */
function pressureTotal(events) {
  let claim;
  let total = 0;
  for (const event of events) {
    const folded = foldSurfaceProjection(claim, event);
    total += folded.deltaTokens;
    claim = folded.claim;
  }
  return total;
}

const BYTE_ERR = Object.assign(
  new Error('pi-ai request body is estimated at 2108859 bytes, exceeding the 2097152-byte bound even without images; start a new session or shorten the input'),
  { code: 'INVALID_REQUEST' },
);

const agent = { session: null };
const logs = [];
const ctx = {
  on: (name, fn) => { ctx.handlers[name] = fn; },
  get: (name) => ({
    toolResultPruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) },
    compaction: undefined,
    tokenMeter: { estimateMessage },
  })[name],
  logger: { info: x => logs.push(['I', x]), warn: x => logs.push(['W', x]) },
  handlers: {},
};
apply(ctx, undefined);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { cond ? (pass++, console.log(`ok   ${name}`)) : (fail++, console.log(`FAIL ${name} ${detail}`)); };

// --- flat history: the real fold must accept the discard pair ----------
{
  const session = new RealFoldSession(buildLog(80, 0));
  const before = pressureTotal(session.events);
  const beforeNodes = session.surface.nodes.length;
  agent.session = session;
  const out = await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  const after = pressureTotal(session.events);
  const replacements = session.events.filter(e => e.surfaceOp && e.surfaceOp.op === 'replace');
  check('flat: retried', out?.kind === 'retry', JSON.stringify(out));
  check('flat: one replacement node', replacements.length === 1);
  check('flat: surface shrank', session.surface.nodes.length < beforeNodes, `${beforeNodes} -> ${session.surface.nodes.length}`);
  check('flat: pressure total dropped', after < before, `${before} -> ${after}`);
  check('flat: node 0 still system head', session.eventAt(session.surface.nodes[0]).type === 'system/message');
  const tail = session.surface.nodes.slice(-20);
  check('flat: tail intact', session.eventAt(tail[0]).data.content?.[0]?.text?.startsWith('prompt 6') === true, JSON.stringify(session.eventAt(tail[0]).data?.content?.[0]?.text?.slice(0, 12)));
}

// --- interleaved tool pairs: real fold + balance snapping --------------
{
  const session = new RealFoldSession(buildLog(90, 3));
  const before = pressureTotal(session.events);
  agent.session = session;
  let out;
  for (let i = 0; i < 3 && out?.kind !== 'retry'; i++) {
    out = await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  }
  out = out ?? await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  const after = pressureTotal(session.events);
  check('tools: retried', out?.kind === 'retry', JSON.stringify(out));
  check('tools: pressure dropped', after < before, `${before} -> ${after}`);
  // no orphan tool result: every tool/result on the surface has its assistant call before it
  const open = new Set();
  let orphan = 0;
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event.type === 'assistant/message') for (const b of event.data.message.content) if (b.type === 'tool-call') open.add(b.id);
    if (event.type === 'tool/result') { if (!open.has(event.data.message.toolCallId)) orphan += 1; else open.delete(event.data.message.toolCallId); }
  }
  check('tools: no orphan tool result on surface', orphan === 0, `orphans=${orphan}`);
}

// --- derived messages still project after the discard ------------------
{
  const session = new RealFoldSession(buildLog(40, 0));
  agent.session = session;
  await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  const messages = session.surface.nodes.map(seq => session.deriveEventMessage(session.eventAt(seq))).filter(x => x !== null);
  const placeholder = messages.find(msg => msg?.source?.kind === 'byte-guard-discard');
  check('projection: discard placeholder visible to the model', placeholder !== undefined);
  check('projection: placeholder cites no fabricated model call', placeholder !== undefined && placeholder.source.compactionId === undefined);
  check('projection: all nodes derive through the real fold', messages.length > 0, `${messages.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('plugin log:', logs.map(l => l[1]).join('\n'));
process.exit(fail ? 1 : 0);
