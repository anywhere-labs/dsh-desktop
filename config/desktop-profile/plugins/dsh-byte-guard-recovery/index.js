/**
 * dsh-byte-guard-recovery —— 请求体字节超限时的原地恢复（不换会话）。
 *
 * 背景：dsh-llm-pi-ai 的 maxRequestBytes 本地保险丝（或端点 HTTP 413）会让
 * 超长会话的每轮请求在发送前被拒，官方三条恢复链都接不住这个场景——
 * dsh-compaction-image-offload 只在「有图可卸」时重试，dsh-compaction-basic 的
 * 溢出恢复只认 CONTEXT_WINDOW_EXCEEDED 错误码，压力压缩按 token 计价所以
 * 大窗口模型永远先撞字节闸。本插件补上缺口：
 *
 *   agent/request-error (INVALID_REQUEST + 字节超限措辞)
 *     → 第 1 级：toolResultPruner.pruneSession() 修剪超大工具输出（不调模型）
 *     → 第 2 级：compaction.compactRegion() 就地摘要最旧一段（活动轮可用；
 *               不能用 compactNow()，它要求 idle agent，在活动轮里必然抛 busy）
 *     → 第 3 级（抛弃）：不调模型的整段丢弃 —— 按 shadow-price 协议写
 *               compaction/prune + user/message 覆盖，占位消息带
 *               byte-guard-discard 来源，会话日志保留原文可回放
 *     → 每级真正缩小表层后返回 { kind: 'retry' } 透明重试原请求
 *     → 连续尝试封顶 maxAttempts 次（默认 3），agent 回到 idle 时清零
 *
 * 抛弃窗口：每轮丢最旧的 discardRatio（默认 25%）表层节点，配对平衡取整，
 * 保护首条 system/developer 之前的头部与最近 keepRecentNodes（默认 20）条。
 * 第 2 级一旦被确定性拒绝（摘要不比原文小 / 摘要调用自身撞字节闸），本次
 * 故障内直接走抛弃，不再重复烧模型调用。
 *
 * 不覆盖：单条不可再拆的超大节点，或 system + 工具 schema 本身就超限时，
 * 表层压缩无法修复（引擎契约也这么写），只记日志并放行原错误。
 *
 * 另挂 compaction/summary-error：摘要调用自身撞字节上限时，修剪一次后让
 * 后端重试摘要（只有真剪掉内容才放行重试，防循环）。
 *
 * 零运行时依赖：服务全部走 ctx.get 按需取用，缺失时自动降级放行原错误。
 *
 * @module dsh-byte-guard-recovery
 */

export const name = 'byte-guard-recovery';

/** pi-ai 本地字节保险丝（maxRequestBytes）拦截时的错误消息（LlmError, code=INVALID_REQUEST）。 */
const LOCAL_BYTE_GUARD_RE = /request body is estimated at \d+ bytes, exceeding the \d+-byte bound/;
/** 端点侧 413 / payload too large —— 与 @deepseek-ai/dsh-llm 的 isRequestTooLargeError 同款判定。 */
const ENDPOINT_TOO_LARGE_RE = /\b413\b|failed to buffer the request body:\s*length limit exceeded|\b(?:payload|request body|request entity)[\s_-]+too[\s_-]+large\b/i;
/** 引擎在调用模型之前就拒绝的区间错误；这类错误换区间也没救，直接抛弃。 */
const RANGE_REJECTED_RE = /not a balanced boundary|not found in surface|is after end seq/i;
/** 压缩锁被占用；此时整段丢弃会让进行中的压缩失败，只能放行原错误。 */
const BUSY_RE = /compaction lock|no open turn|requires an idle agent/i;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_KEEP_RECENT_NODES = 20;
const DEFAULT_DISCARD_RATIO = 0.25;

/**
 * 判定是否为「请求体字节数被拒」——区别于模型上下文窗口溢出，
 * 恢复手段是缩小请求（修剪/压缩/抛弃），而非重发或换模型。
 * @param {unknown} failure - agent/request-error 的 failure 或 compaction/summary-error 的 error。
 * @returns {boolean}
 */
function isByteGuardFailure(failure) {
  if (!failure || typeof failure !== 'object') return false;
  if (failure.code !== 'INVALID_REQUEST') return false;
  const message = String(failure.message ?? '');
  return LOCAL_BYTE_GUARD_RE.test(message) || ENDPOINT_TOO_LARGE_RE.test(message);
}

/**
 * 校验并归一插件配置；非法值回落到默认值。
 * @param {object} config - 原始插件配置（可缺省）。
 * @returns {{maxAttempts:number,keepRecentNodes:number,discardRatio:number,compactEnabled:boolean}}
 */
function resolveConfig(config) {
  const maxAttempts = Number(config?.maxAttempts);
  const keepRecentNodes = Number(config?.keepRecentNodes);
  const discardRatio = Number(config?.discardRatio);
  const compactEnabled = config?.compact?.enabled;
  return {
    maxAttempts: Number.isSafeInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10
      ? maxAttempts : DEFAULT_MAX_ATTEMPTS,
    keepRecentNodes: Number.isSafeInteger(keepRecentNodes) && keepRecentNodes >= 4 && keepRecentNodes <= 200
      ? keepRecentNodes : DEFAULT_KEEP_RECENT_NODES,
    discardRatio: Number.isFinite(discardRatio) && discardRatio >= 0.05 && discardRatio <= 0.9
      ? discardRatio : DEFAULT_DISCARD_RATIO,
    compactEnabled: compactEnabled === false ? false : true,
  };
}

function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : '';
  return cause ? `${error.message} (${cause})` : error.message;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `byte-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 尝试修剪会话表层超大的工具结果。
 * @param {object} ctx - 插件上下文。
 * @param {object} session - 目标会话。
 * @returns {boolean} 是否实际剪掉内容。
 */
function pruneOnce(ctx, session) {
  const pruner = ctx.get('toolResultPruner');
  if (!pruner) return false;
  const result = pruner.pruneSession(session);
  if (!result || result.pruned.length === 0) return false;
  ctx.logger.info(
    `byte-guard-recovery: pruned ${result.pruned.length} oversized tool result(s), ${result.charsRemoved} chars removed`
  );
  return true;
}

/** 表层头部：第一条非 system/developer 节点之前的位置都受保护。 */
function headBoundary(session, nodes) {
  let index = 0;
  while (index < nodes.length) {
    const type = session.eventAt(nodes[index])?.type;
    if (type === 'system/message' || type === 'developer/message') index += 1;
    else break;
  }
  return index;
}

/**
 * 复刻 dsh-compaction 的配对平衡口径：每个切点之前未回应的 tool-call 数为 0。
 * @param {object} session - 目标会话。
 * @param {number[]} nodes - 当前表层 seq 列表。
 * @returns {{before:boolean[],afterEnd:boolean}} before[i] 是第 i 个节点之前的切点。
 */
function balancedCuts(session, nodes) {
  const before = [];
  let inProgress = 0;
  for (const seq of nodes) {
    before.push(inProgress === 0);
    const event = session.eventAt(seq);
    if (event?.type === 'assistant/message') {
      const content = event.data?.message?.content ?? [];
      inProgress += content.filter(block => block?.type === 'tool-call').length;
    } else if (event?.type === 'tool/result') {
      inProgress -= 1;
    }
  }
  return { before, afterEnd: inProgress === 0 };
}

/**
 * 选出「最旧的一段可安全整段替换区间」：跳过受保护头部与最近尾部，
 * 两端都落在配对平衡切点上，宽度为可用区间的 discardRatio。
 * @param {object} session - 目标会话。
 * @param {object} options - 归一后的配置。
 * @returns {{startSeq:number,endSeq:number,nodeCount:number}|null} 无可用区间时 null。
 */
function pickOldestRegion(session, options) {
  const nodes = [...session.surface.nodes];
  if (nodes.length === 0) return null;
  const cuts = balancedCuts(session, nodes);
  // after(i) === before(i + 1)，末尾切点单独取。
  const balancedAfter = index => index + 1 < nodes.length ? cuts.before[index + 1] : cuts.afterEnd;

  const head = headBoundary(session, nodes);
  let start = head;
  while (start < nodes.length && !cuts.before[start]) start += 1;
  const tailFloor = Math.max(head, nodes.length - options.keepRecentNodes);
  if (start >= tailFloor) return null;

  const available = tailFloor - start;
  const wanted = Math.max(1, Math.floor(available * options.discardRatio));
  let end = Math.min(tailFloor, start + wanted) - 1;
  while (end >= start && !balancedAfter(end)) end -= 1;
  if (end < start) return null;
  return { startSeq: nodes[start], endSeq: nodes[end], nodeCount: end - start + 1 };
}

/**
 * 不调模型的整段抛弃：按 shadow-price 协议先记价格再覆盖整段区间。
 * 与被修剪的工具输出一样，原文仍留在会话日志里，回放与历史导出无损。
 * @param {object} ctx - 插件上下文。
 * @param {object} session - 目标会话。
 * @param {{startSeq:number,endSeq:number,nodeCount:number}} region - 已验证的区间。
 * @param {string} reason - 记入日志的触发行。
 * @returns {boolean} 是否实际落下替换。
 */
function discardRegion(ctx, session, region, reason) {
  const meter = ctx.get('tokenMeter');
  if (!meter) {
    ctx.logger.warn('byte-guard-recovery: no tokenMeter; cannot write a consistent shadow price, skipping discard');
    return false;
  }
  const nodes = [...session.surface.nodes];
  const startIdx = nodes.indexOf(region.startSeq);
  const endIdx = nodes.indexOf(region.endSeq);
  if (startIdx < 1 || endIdx < startIdx) {
    ctx.logger.warn(`byte-guard-recovery: discard range ${region.startSeq}-${region.endSeq} is no longer usable`);
    return false;
  }
  const shadowedSeqs = nodes.slice(startIdx, endIdx + 1);
  let shadowedTokenCount = 0;
  for (const seq of shadowedSeqs) {
    const event = session.eventAt(seq);
    const message = event === undefined ? null : session.deriveEventMessage(event);
    if (message !== null) shadowedTokenCount += meter.estimateMessage(message);
  }

  // 价格事件与替换必须同步相邻，否则 token 计量的 O(1) 折叠会失配。
  session.append('compaction/prune', {
    shadowedRange: { start: region.startSeq, end: region.endSeq },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
  });
  // 来源用本插件自己的 kind：dsh-compaction 的 invariant 会拒绝没有配对
  // compaction/start 的 compact-checkpoint 替换，而伪造一档摘要记录等于
  // 谎报一次模型调用。user 消息的 source.kind 是可扩展词汇，消费方对未知
  // kind 走 fall-through。
  session.append('user/message', {
    role: 'user',
    id: newId(),
    content: [{
      type: 'text',
      text: `<discarded-context reason="request-size">
${shadowedSeqs.length} of the oldest messages were removed without summarization so this request \
fits the endpoint's 2 MiB body limit. Their content is unavailable; if you need an earlier detail, \
ask the user or re-read the relevant file.
</discarded-context>`,
    }],
    source: { kind: 'byte-guard-discard' },
  }, {
    surfaceOp: { op: 'replace', startSeq: region.startSeq, endSeq: region.endSeq },
    sourceEventSeqs: [...shadowedSeqs],
  });
  ctx.logger.warn(
    `byte-guard-recovery: discarded ${shadowedSeqs.length} oldest surface node(s) `
    + `(span ${region.startSeq}->${region.endSeq} by surface position, ${shadowedTokenCount} estimated tokens) `
    + `without summarization; reason: ${reason}`
  );
  return true;
}

/**
 * 插件入口：注册请求错误恢复与摘要错误修复两个监听器。
 * @param {object} ctx - 宿主上下文（cordis）。
 * @param {object} [config] - 插件配置。
 */
export function apply(ctx, config) {
  const options = resolveConfig(config);
  /** 每个 agent 单次故障的连续恢复次数与状态；agent 回到 idle（一轮结束）时清零。 */
  const state = new Map();

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') state.delete(agent);
  });

  ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
    if (signal?.aborted || !isByteGuardFailure(failure)) return next();
    const current = state.get(agent) ?? { attempts: 0, discardOnly: false };
    if (current.attempts >= options.maxAttempts) {
      ctx.logger.warn(
        `byte-guard-recovery: giving up after ${current.attempts} recovery attempt(s) `
        + `(surface nodes ${agent.session.surface.nodes.length}); the oversized content is in the `
        + `protected head/tail or a single node, or compaction and pruning cannot fit the body limit`
      );
      return next();
    }
    current.attempts += 1;
    state.set(agent, current);

    // 第 1 级：修剪超大工具输出。零模型开销；原文保留在会话日志，回放不受影响。
    try {
      if (pruneOnce(ctx, agent.session)) return { kind: 'retry' };
    } catch (error) {
      ctx.logger.warn(`byte-guard-recovery: prune failed (${errorText(error)}); escalating to compaction`);
    }

    const region = pickOldestRegion(agent.session, options);
    if (region === null) {
      ctx.logger.warn(
        `byte-guard-recovery: no discardable region (surface nodes ${agent.session.surface.nodes.length}, `
        + `head + last ${options.keepRecentNodes} nodes protected); giving up`
      );
      return next();
    }

    // 第 2 级：活动轮可用的就地摘要。compactNow() 走 runMaintenance，在活动轮必抛 busy。
    const compaction = ctx.get('compaction');
    if (!compaction) {
      ctx.logger.warn('byte-guard-recovery: no compaction service; falling back to discarding history');
    } else if (options.compactEnabled && !current.discardOnly) {
      try {
        const result = await compaction.compactRegion(region.startSeq, region.endSeq, agent, signal);
        if (result) {
          ctx.logger.info(
            `byte-guard-recovery: summarized ${region.nodeCount} oldest node(s) `
            + `(span ${region.startSeq}->${region.endSeq} by surface position); retrying the request`
          );
          return { kind: 'retry' };
        }
      } catch (error) {
        const text = errorText(error);
        ctx.logger.warn(`byte-guard-recovery: in-turn compaction rejected (${text})`);
        if (BUSY_RE.test(text)) return next();
        if (!RANGE_REJECTED_RE.test(text)) current.discardOnly = true;
      }
    }

    // 第 3 级：抛弃最旧一段，保证一定缩小模型可见内容。摘要失败前的修剪会
    // 改写表层 seq，所以区间重新取。
    const discardTarget = pickOldestRegion(agent.session, options);
    if (discardTarget === null) {
      ctx.logger.warn('byte-guard-recovery: no balanced discardable region left on the current surface');
      return next();
    }
    if (discardRegion(ctx, agent.session, discardTarget,
      current.discardOnly ? 'compaction unusable' : 'no oversized tool result left')) {
      return { kind: 'retry' };
    }
    return next();
  });

  ctx.on('compaction/summary-error', ({ session, error, signal }, next) => {
    if (signal?.aborted || !isByteGuardFailure(error)) return next();
    try {
      // 只有真剪掉内容才让后端重试；否则区间不变、必然再次撞闸。
      if (pruneOnce(ctx, session)) return true;
    } catch {
      // 摘要修复是尽力而为；失败则放行原错误。
    }
    return next();
  });
}
