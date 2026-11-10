import { apply } from '/home/fate/.dsh/profiles/desktop/plugins/dsh-byte-guard-recovery/index.js';

// ---- fake harness -----------------------------------------------------
function makeCtx({ pruner, compaction, meter }) {
  const handlers = {};
  const logs = [];
  const ctx = {
    on: (name, fn) => { handlers[name] = fn; },
    get: (name) => ({ toolResultPruner: pruner, compaction, tokenMeter: meter })[name],
    logger: {
      info: m => logs.push(['I', m]),
      warn: m => logs.push(['W', m]),
    },
    handlers, logs,
  };
  return ctx;
}

class FakeSession {
  constructor(events) {
    // events: array of {type, data} in append order; seq = index
    this.log = events.map((e, seq) => ({ seq, type: e.type, data: e.data }));
    this.nodes = this.log.filter(e => ['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'].includes(e.type)).map(e => e.seq);
    this.appended = [];
  }
  get surface() { return { nodes: this.nodes, replaceGeneration: 0, contentGeneration: 0 }; }
  eventAt(seq) { return this.log[seq]; }
  deriveEventMessage(event) { return event.data?.message ?? (event.type === 'user/message' ? event.data : null); }
  append(type, data, opts) {
    const seq = this.log.length;
    const event = { seq, type, data, ...(opts?.surfaceOp ? { surfaceOp: opts.surfaceOp, sourceEventSeqs: opts.sourceEventSeqs } : {}) };
    // mimic session validation of a replace
    if (opts?.surfaceOp && opts.surfaceOp.op === 'replace') {
      const { startSeq, endSeq } = opts.surfaceOp;
      const si = this.nodes.indexOf(startSeq);
      const ei = this.nodes.indexOf(endSeq);
      if (si < 1) throw new Error(`node 0 head protected / start ${startSeq} not on surface (idx ${si})`);
      if (ei < si) throw new Error('reversed range');
      const shadowed = this.nodes.slice(si, ei + 1);
      for (const s of shadowed) if (!opts.sourceEventSeqs.includes(s)) throw new Error(`missing sourceEventSeq ${s}`);
      if (startSeq >= seq || endSeq >= seq) throw new Error('replace must reference earlier events');
      this.nodes.splice(si, ei - si + 1, seq);
      if (type !== 'user/message') throw new Error(`unexpected discard replacement type ${type}`);
      const msg = data;
      if (typeof msg.id !== 'string' || msg.id === '' || msg.role !== 'user' || !Array.isArray(msg.content) || msg.source?.kind !== 'byte-guard-discard') {
        throw new Error(`bad checkpoint message shape ${JSON.stringify(msg)}`);
      }
    }
    if (type === 'compaction/prune') {
      if (opts) throw new Error('prune must not carry surface metadata');
      this.pendingClaim = data.shadowedRange;
    } else if (opts?.surfaceOp?.op === 'replace') {
      if (!this.pendingClaim || this.pendingClaim.start !== opts.surfaceOp.startSeq || this.pendingClaim.end !== opts.surfaceOp.endSeq) {
        throw new Error(`replace without adjacent shadow price (claim ${JSON.stringify(this.pendingClaim)})`);
      }
      this.pendingClaim = undefined;
    } else {
      this.pendingClaim = undefined;
      if (type === 'user/message') this.nodes.push(seq);
    }
    this.log.push(event);
    this.appended.push(event);
    return event;
  }
}

function msg(role, content, extra = {}) {
  return { role, content, id: `${role}-${Math.random().toString(36).slice(2)}`, source: { kind: role === 'assistant' ? 'model' : 'user', provider: 'p', model: 'm' }, ...extra };
}

function history(n, { toolEvery = 0 } = {}) {
  const events = [{ type: 'system/message', data: msg('system', [{ type: 'text', text: 'sys' }], { source: { kind: 'system-prompt' } }) }];
  for (let i = 0; i < n; i++) {
    if (toolEvery && i % toolEvery === 0 && i > 0) {
      events.push({ type: 'assistant/message', data: { message: msg('assistant', [{ type: 'tool-call', callId: `c${i}`, toolName: 't', arguments: {} }]) } });
      events.push({ type: 'tool/result', data: { message: msg('tool', [{ type: 'text', text: 'res' }], { source: { kind: 'tool', callId: `c${i}` }, toolCallId: `c${i}` }) } });
    } else {
      events.push({ type: 'user/message', data: msg('user', [{ type: 'text', text: `turn ${i} ${'x'.repeat(50)}` }]) });
    }
  }
  return events;
}

const BYTE_ERR = Object.assign(new Error('pi-ai request body is estimated at 2108859 bytes, exceeding the 2097152-byte bound even without images; start a new session or shorten the input'), { code: 'INVALID_REQUEST' });
const agent = { session: null };
const signal = new AbortController().signal;

async function drive(ctx, session) {
  agent.session = session;
  let delegated = false;
  const out = await ctx.handlers['agent/request-error']({ agent, failure: BYTE_ERR, signal }, () => { delegated = true; });
  return { out, delegated };
}

// ---- cases ------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// case 1: no pruner, no compaction -> discard oldest 25%
{
  const meter = { estimateMessage: m => (m.content?.[0]?.text?.length ?? 10) / 4 };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction: null, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(100));
  const { out } = await drive(ctx, session);
  const prune = session.appended.find(e => e.type === 'compaction/prune');
  const repl = session.appended.find(e => e.type === 'user/message' && e.surfaceOp);
  const span = repl.surfaceOp.endSeq - repl.surfaceOp.startSeq + 1;
  check('1 retry after discard', out?.kind === 'retry', JSON.stringify(out));
  check('1 head protected', repl.surfaceOp.startSeq > 0 && session.nodes[0] === 0, `start=${repl.surfaceOp.startSeq}`);
  check('1 tail protected', session.nodes.length >= 20, `${session.nodes.length}`);
  check('1 ~25% window', span >= 18 && span <= 21, `span=${span}`);
  check('1 shadow price present', prune?.data.shadowedSeqs.length === span);
  check('1 sourceEventSeqs cover span', repl.sourceEventSeqs.length === span);
  check('1 warn logged', ctx.logs.some(l => l[0] === 'W' && l[1].includes('discarded')), JSON.stringify(ctx.logs));
}

// case 2: compaction succeeds -> no discard
{
  const meter = { estimateMessage: () => 5 };
  const calls = [];
  const compaction = { compactRegion: async (s, e) => { calls.push([s, e]); return { shadowedRange: { start: s, end: e } }; } };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(100));
  const { out } = await drive(ctx, session);
  check('2 retry after compaction', out?.kind === 'retry');
  check('2 compaction called once', calls.length === 1);
  check('2 no discard written', !session.appended.some(e => e.type === 'compaction/prune'));
}

// case 3: compaction "not smaller" -> discard, and next attempt skips compaction
{
  const meter = { estimateMessage: () => 5 };
  let calls = 0;
  const compaction = { compactRegion: async () => { calls++; throw new Error('summary is not smaller than the shadowed content (900 estimated framed tokens >= 800)'); } };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(100));
  const a = await drive(ctx, session);
  const b = await drive(ctx, session);
  check('3 retries', a.out?.kind === 'retry' && b.out?.kind === 'retry');
  check('3 compaction tried once only', calls === 1, `calls=${calls}`);
  check('3 two discards landed', session.appended.filter(e => e.type === 'compaction/prune').length === 2);
}

// case 4: tool-pairing — window full of an open call batch snaps to a balanced cut
{
  const meter = { estimateMessage: () => 5 };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction: null, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(60, { toolEvery: 3 }));
  const { out } = await drive(ctx, session);
  const repl = session.appended.find(e => e.type === 'user/message' && e.surfaceOp);
  const endEvent = session.eventAt(repl.surfaceOp.endSeq);
  const after = endEvent.type === 'tool/result' || endEvent.type === 'user/message';
  check('4 retry', out?.kind === 'retry');
  check('4 end cut not mid tool-call', after, endEvent.type);
}

// case 5: attempts exhausted -> delegate with a loud warn
{
  const meter = { estimateMessage: () => 5 };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction: null, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(60));
  const r = [];
  for (let i = 0; i < 6; i++) r.push(await drive(ctx, session));
  check('5 first three retried', r.slice(0, 3).every(x => x.out?.kind === 'retry'), JSON.stringify(r.map(x => x.out ?? 'next')));
  check('5 later delegated', r[3].delegated && r[4].delegated && r[5].delegated, JSON.stringify(r.map(x => x.out ?? 'next')));
  check('5 give-up logged', ctx.logs.some(l => l[1].includes('giving up') || l[1].includes('giving up after') || l[1].includes('attempt(s)')), JSON.stringify(ctx.logs.map(l => l[1])));
}

// case 6: prune sheds content -> retry without touching compaction
{
  const meter = { estimateMessage: () => 5 };
  let prunes = 0;
  const pruner = { pruneSession: () => { prunes++; return prunes === 1 ? { pruned: [{ originalSeq: 1 }], charsRemoved: 5215 } : { pruned: [], charsRemoved: 0 }; } };
  const ctx = makeCtx({ pruner, compaction: { compactRegion: async () => ({}) }, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(100));
  const a = await drive(ctx, session);
  const b = await drive(ctx, session);
  check('6 prune retried', a.out?.kind === 'retry');
  check('6 second attempt compacted', b.out?.kind === 'retry' && prunes === 2);
}

// case 7: everything in the protected tail -> no discardable region
{
  const meter = { estimateMessage: () => 5 };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction: { compactRegion: async () => { throw new Error('boom'); } }, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(6));
  const { out, delegated } = await drive(ctx, session);
  check('7 delegated', delegated === true && out === undefined, JSON.stringify(out));
  check('7 no discardable log', ctx.logs.some(l => l[1].includes('no discardable region')), JSON.stringify(ctx.logs.map(l => l[1])));
}

// case 8: compaction busy (lock) -> stop, do not discard
{
  const meter = { estimateMessage: () => 5 };
  const compaction = { compactRegion: async () => { throw new Error("compaction: compaction already in progress; the session compaction lock is already active"); } };
  const ctx = makeCtx({ pruner: { pruneSession: () => ({ pruned: [], charsRemoved: 0 }) }, compaction, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(100));
  const { delegated } = await drive(ctx, session);
  check('8 delegated on lock', delegated === true);
  check('8 nothing discarded', !session.appended.some(e => e.type === 'compaction/prune'));
}

// case 9: summary-error prunes only when content actually sheds
{
  const meter = { estimateMessage: () => 5 };
  let sheds = true;
  const pruner = { pruneSession: () => sheds ? { pruned: [{ originalSeq: 1 }], charsRemoved: 10 } : { pruned: [], charsRemoved: 0 } };
  const ctx = makeCtx({ pruner, compaction: null, meter });
  apply(ctx, undefined);
  const session = new FakeSession(history(10));
  const first = ctx.handlers['compaction/summary-error']({ session, error: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  sheds = false;
  const second = ctx.handlers['compaction/summary-error']({ session, error: BYTE_ERR, signal: new AbortController().signal }, () => 'next');
  check('9 retry summary after prune', first === true);
  check('9 no empty retry loop', second === 'next', String(second));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
