import { useEffect, useRef, useState } from "react";
import {
  getLiveClipTranscript,
  getLiveClipTranscriptExportUrl,
  normalizeLiveClipTranscript,
  rerenderLiveClipTranscript,
  updateLiveClipTranscript,
} from "../api/client";
import { TranscriptTimelineLane } from "./TranscriptTimelineLane";

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  segment_id?: string;
  sequence_no?: number;
  emphasis_tags?: string[];
  hook_candidate?: boolean;
};

type WorkspaceState = {
  revision: number;
  segments: TranscriptSegment[];
  conflict: boolean;
};

export function editTranscriptSegment(
  segments: TranscriptSegment[],
  index: number,
  field: keyof TranscriptSegment,
  value: string | number,
) {
  if (field !== "text" && String(value).trim() === "") return segments;
  return segments.map((segment, row) => row === index ? { ...segment, [field]: field === "text" ? String(value) : Number(value) } : segment);
}

export function mergeTranscriptSegments(segments: TranscriptSegment[], selected: number[]) {
  const indexes = [...new Set(selected)].filter((index) => index >= 0 && index < segments.length).sort((a, b) => a - b);
  if (indexes.length < 2) return segments;
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) {
    throw new Error("只能合并连续字幕");
  }
  const selectedSet = new Set(indexes);
  const merged = {
    start: segments[indexes[0]].start,
    end: segments[indexes[indexes.length - 1]].end,
    text: indexes.map((index) => segments[index].text.trim()).filter(Boolean).join(" "),
  };
  return segments.flatMap((segment, index) => index === indexes[0] ? [merged] : selectedSet.has(index) ? [] : [segment]);
}

export function deleteTranscriptSegments(segments: TranscriptSegment[], selected: number[]) {
  const selectedSet = new Set(selected);
  return segments.filter((_, index) => !selectedSet.has(index));
}

export function splitTranscriptSegment(segments: TranscriptSegment[], index: number) {
  const segment = segments[index];
  if (!segment) return segments;
  const text = segment.text.trim();
  const whitespace = text.lastIndexOf(" ", Math.floor(text.length / 2));
  const splitAt = whitespace > 0 ? whitespace : Math.ceil(text.length / 2);
  const firstText = text.slice(0, splitAt).trim();
  const secondText = text.slice(splitAt).trim();
  if (!firstText || !secondText) return segments;
  const startMs = Math.round(segment.start * 1000);
  const endMs = Math.round(segment.end * 1000);
  if (endMs - startMs < 2) throw new Error("字幕片段至少需要 2ms 才能拆分");
  const midpoint = (startMs + Math.floor((endMs - startMs) / 2)) / 1000;
  return [
    ...segments.slice(0, index),
    { start: segment.start, end: midpoint, text: firstText },
    { start: midpoint, end: segment.end, text: secondText },
    ...segments.slice(index + 1),
  ];
}

export function trySplitTranscriptSegment(segments: TranscriptSegment[], index: number) {
  try {
    return { segments: splitTranscriptSegment(segments, index), error: "" };
  } catch (error: any) {
    return { segments, error: error?.message || "字幕拆分失败" };
  }
}

export function validateEditableSegments(segments: TranscriptSegment[]) {
  let previousStart = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
      return `第 ${index + 1} 条字幕时间必须是有限数字`;
    }
    if (segment.start < 0 || segment.end < 0) {
      return `第 ${index + 1} 条字幕时间必须为非负数`;
    }
    if (segment.end <= segment.start) {
      return `第 ${index + 1} 条字幕结束时间必须晚于开始时间`;
    }
    if (segment.start < previousStart) {
      return `第 ${index + 1} 条字幕时间顺序错误`;
    }
    previousStart = segment.start;
  }
  return "";
}

type RequestToken = { generation: number; taskId: string };

export function createRequestGenerationGuard() {
  let generation = 0;
  let currentTaskId = "";
  return {
    next(taskId: string): RequestToken {
      currentTaskId = taskId;
      generation += 1;
      return { generation, taskId };
    },
    isCurrent(token: RequestToken) {
      return token.generation === generation && token.taskId === currentTaskId;
    },
  };
}

export function buildTranscriptUpdatePayload(revision: number, segments: TranscriptSegment[]) {
  return { revision, segments };
}

export function buildTranscriptNormalizePayload(revision: number, mergeGapMs: number) {
  return { revision, merge_gap_ms: mergeGapMs };
}

export function buildTranscriptUpdateRequest(taskId: string, revision: number, segments: TranscriptSegment[]) {
  return { taskId, body: buildTranscriptUpdatePayload(revision, segments) };
}

export function buildTranscriptNormalizeRequest(taskId: string, revision: number, mergeGapMs = 500) {
  return { taskId, body: buildTranscriptNormalizePayload(revision, mergeGapMs) };
}

export function buildTranscriptRerenderRequest(
  taskId: string,
  revision: number,
  templateIds: string[] = [],
  activeTemplateId = "",
) {
  const body: Record<string, unknown> = { revision };
  if (templateIds.length) body.template_ids = templateIds;
  if (activeTemplateId) body.active_template_id = activeTemplateId;
  return { taskId, body };
}

export function reduceTranscriptResponse(state: WorkspaceState, response: any): WorkspaceState {
  if (response?.status === "blocked" && (response.missing_inputs || []).includes("transcript_revision")) {
    return { ...state, conflict: true };
  }
  if (response?.status === "ok") {
    return {
      revision: Number(response.data?.revision ?? state.revision),
      segments: response.data?.segments ?? state.segments,
      conflict: false,
    };
  }
  return state;
}

export const applyTranscriptMutation = reduceTranscriptResponse;

function duration(segment: TranscriptSegment) {
  return Math.max(0, segment.end - segment.start);
}

type TranscriptWorkspaceProps = {
  taskId: string;
  templateIds?: string[];
  activeTemplateId?: string;
  onRerendered?: (response: any) => void;
  rerunActive?: boolean;
};

export function TranscriptWorkspace({
  taskId,
  templateIds = [],
  activeTemplateId = "",
  onRerendered,
  rerunActive = false,
}: TranscriptWorkspaceProps) {
  const [status, setStatus] = useState<"loading" | "ok" | "blocked">("loading");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<WorkspaceState>({ revision: 1, segments: [], conflict: false });
  const [selected, setSelected] = useState<number[]>([]);
  const [mergeGapMs, setMergeGapMs] = useState(500);
  const [busy, setBusy] = useState("");
  const requestGuard = useRef(createRequestGenerationGuard());

  async function refresh() {
    const token = requestGuard.current.next(taskId);
    setBusy("refresh");
    try {
      const response = await getLiveClipTranscript(taskId);
      if (!requestGuard.current.isCurrent(token)) return;
      if (response?.status === "ok") {
        setState({
          revision: Number(response.data?.revision || 1),
          segments: response.data?.segments || [],
          conflict: false,
        });
        setStatus("ok");
        setMessage("");
      } else {
        setStatus("blocked");
        setMessage(response?.message || `字幕不可用：${(response?.missing_inputs || []).join("、") || "暂无转写结果"}`);
      }
      setSelected([]);
    } catch (error: any) {
      if (!requestGuard.current.isCurrent(token)) return;
      setStatus("blocked");
      setMessage(error?.message || "字幕状态读取失败");
    } finally {
      if (requestGuard.current.isCurrent(token)) setBusy("");
    }
  }

  useEffect(() => {
    void refresh();
  }, [taskId]);

  function updateSegments(segments: TranscriptSegment[]) {
    if (busy) return;
    setState((current) => ({ ...current, segments, conflict: false }));
    setSelected([]);
    setMessage("");
  }

  async function save() {
    const validationError = validateEditableSegments(state.segments);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const token = requestGuard.current.next(taskId);
    setBusy("save");
    try {
      const request = buildTranscriptUpdateRequest(taskId, state.revision, state.segments);
      const response = await updateLiveClipTranscript(request.taskId, request.body);
      if (!requestGuard.current.isCurrent(token)) return;
      setState((current) => reduceTranscriptResponse(current, response));
      if (response?.status !== "ok" && !(response?.missing_inputs || []).includes("transcript_revision")) {
        setMessage(response?.message || "字幕保存失败");
      }
    } catch (error: any) {
      if (requestGuard.current.isCurrent(token)) setMessage(error?.message || "字幕保存失败");
    } finally {
      if (requestGuard.current.isCurrent(token)) setBusy("");
    }
  }

  async function rerender() {
    const validationError = validateEditableSegments(state.segments);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const token = requestGuard.current.next(taskId);
    setBusy("rerender");
    try {
      const saveRequest = buildTranscriptUpdateRequest(taskId, state.revision, state.segments);
      const saveResponse = await updateLiveClipTranscript(saveRequest.taskId, saveRequest.body);
      if (!requestGuard.current.isCurrent(token)) return;
      const savedState = reduceTranscriptResponse(state, saveResponse);
      setState(savedState);
      if (saveResponse?.status !== "ok") {
        setMessage(saveResponse?.message || "字幕保存失败");
        return;
      }
      const rerenderRequest = buildTranscriptRerenderRequest(
        taskId,
        savedState.revision,
        templateIds,
        activeTemplateId,
      );
      const rerenderResponse = await rerenderLiveClipTranscript(rerenderRequest.taskId, rerenderRequest.body);
      if (!requestGuard.current.isCurrent(token)) return;
      if (rerenderResponse?.status === "ok") onRerendered?.(rerenderResponse);
      setMessage(
        rerenderResponse?.status === "ok"
          ? "包装层已重新生成，请重新提交审核。"
          : rerenderResponse?.message || "重新包装失败"
      );
    } catch (error: any) {
      if (requestGuard.current.isCurrent(token)) setMessage(error?.message || "重新包装失败");
    } finally {
      if (requestGuard.current.isCurrent(token)) setBusy("");
    }
  }

  async function normalize() {
    const token = requestGuard.current.next(taskId);
    setBusy("normalize");
    try {
      const request = buildTranscriptNormalizeRequest(taskId, state.revision, mergeGapMs);
      const response = await normalizeLiveClipTranscript(request.taskId, request.body);
      if (!requestGuard.current.isCurrent(token)) return;
      setState((current) => reduceTranscriptResponse(current, response));
      if (response?.status !== "ok") setMessage(response?.message || "字幕整理失败");
    } catch (error: any) {
      if (requestGuard.current.isCurrent(token)) setMessage(error?.message || "字幕整理失败");
    } finally {
      if (requestGuard.current.isCurrent(token)) setBusy("");
    }
  }

  function toggle(index: number) {
    if (busy) return;
    setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  }

  function merge() {
    try {
      updateSegments(mergeTranscriptSegments(state.segments, selected));
    } catch (error: any) {
      setMessage(error?.message || "字幕合并失败");
    }
  }

  function split(index: number) {
    const result = trySplitTranscriptSegment(state.segments, index);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    updateSegments(result.segments);
  }

  return <TranscriptWorkspaceView
    busy={busy}
    conflict={state.conflict}
    mergeGapMs={mergeGapMs}
    message={message}
    onDelete={() => updateSegments(deleteTranscriptSegments(state.segments, selected))}
    onEdit={(index, field, value) => updateSegments(editTranscriptSegment(state.segments, index, field, value))}
    onMerge={merge}
    onMergeGapChange={setMergeGapMs}
    onNormalize={normalize}
    onRefresh={refresh}
    onRerender={rerender}
    onSave={save}
    onSelect={toggle}
    onSplit={split}
    revision={state.revision}
    segments={state.segments}
    selected={selected}
    status={status}
    taskId={taskId}
    rerunActive={rerunActive}
  />;
}

type TranscriptWorkspaceViewProps = {
  busy: string;
  conflict: boolean;
  mergeGapMs: number;
  message: string;
  onDelete: () => void;
  onEdit: (index: number, field: keyof TranscriptSegment, value: string | number) => void;
  onMerge: () => void;
  onMergeGapChange: (value: number) => void;
  onNormalize: () => void;
  onRefresh: () => void;
  onRerender: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
  onSplit: (index: number) => void;
  revision: number;
  segments: TranscriptSegment[];
  selected: number[];
  status: "loading" | "ok" | "blocked";
  taskId: string;
  rerunActive?: boolean;
};

export function TranscriptWorkspaceView({
  busy,
  conflict,
  mergeGapMs,
  message,
  onDelete,
  onEdit,
  onMerge,
  onMergeGapChange,
  onNormalize,
  onRefresh,
  onRerender,
  onSave,
  onSelect,
  onSplit,
  revision,
  segments,
  selected,
  status,
  taskId,
  rerunActive = false,
}: TranscriptWorkspaceViewProps) {
  const locked = status !== "ok" || Boolean(busy) || Boolean(rerunActive);
  return (
    <section className="transcript-workspace" id="liveClipTranscriptWorkspace">
      <header className="transcript-toolbar">
        <div>
          <h3>{rerunActive ? "本轮生成中" : "字幕时间轴"}</h3>
          <small>{rerunActive ? "字幕编辑与重新包装暂时锁定，待本轮结果完成后恢复" : `Revision ${revision}`}</small>
        </div>
        <div className="transcript-actions">
          <button disabled={selected.length < 2 || locked} onClick={onMerge} type="button">合并所选</button>
          <button disabled={!selected.length || locked} onClick={onDelete} type="button">删除所选</button>
          <label>间隔 ms<input disabled={locked} min="0" onChange={(event) => onMergeGapChange(Number(event.target.value))} type="number" value={mergeGapMs} /></label>
          <button disabled={locked} onClick={onNormalize} type="button">自动整理</button>
          <button className="primary" disabled={locked} onClick={onSave} type="button">保存字幕</button>
          <button className="primary" disabled={locked} onClick={onRerender} type="button">重新包装成片</button>
          {status === "ok" && !busy && !rerunActive ? <a href={getLiveClipTranscriptExportUrl(taskId, "txt")}>导出 TXT</a> : null}
          {status === "ok" && !busy && !rerunActive ? <a href={getLiveClipTranscriptExportUrl(taskId, "srt")}>导出 SRT</a> : null}
          {status === "ok" && !busy && !rerunActive ? <a href={getLiveClipTranscriptExportUrl(taskId, "ass")}>导出 ASS</a> : null}
          {status === "ok" && !busy && !rerunActive ? <a href={getLiveClipTranscriptExportUrl(taskId, "timeline")}>导出时间线</a> : null}
        </div>
      </header>

      {conflict ? <div className="transcript-conflict" role="alert">字幕已被其他操作更新<button onClick={onRefresh} type="button">刷新</button></div> : null}
      {status === "loading" ? <div className="transcript-empty">正在读取字幕状态...</div> : null}
      {status === "blocked" ? <div className="transcript-empty error" role="status">{message}<button onClick={onRefresh} type="button">刷新</button></div> : null}
      {status === "ok" && rerunActive ? <div className="transcript-empty" role="status">本轮生成中，字幕编辑与重新包装暂时锁定，待本轮结果完成后恢复。</div> : null}
      {status === "ok" && message ? <div className="transcript-empty error" role="status">{message}</div> : null}
      {status === "ok" ? (
        <>
          <TranscriptTimelineLane segments={segments} selected={selected} />
          <div className="transcript-table-wrap">
            <table className="transcript-table">
              <thead><tr><th>选择</th><th>序号</th><th>开始</th><th>结束</th><th>时长</th><th>间隔ms</th><th>文案</th><th>操作</th></tr></thead>
              <tbody>
                {segments.map((segment, index) => {
                  const gap = index ? Math.round((segment.start - segments[index - 1].end) * 1000) : 0;
                  return (
                    <tr key={`${index}-${segment.start}`}>
                      <td><input aria-label={`选择第${index + 1}条`} checked={selected.includes(index)} disabled={locked} onChange={() => onSelect(index)} type="checkbox" /></td>
                      <td>{segment.sequence_no || index + 1}</td>
                      <td><input aria-label={`第${index + 1}条开始`} disabled={locked} min="0" onChange={(event) => onEdit(index, "start", event.target.value)} step="0.001" type="number" value={segment.start} /></td>
                      <td><input aria-label={`第${index + 1}条结束`} disabled={locked} min="0" onChange={(event) => onEdit(index, "end", event.target.value)} step="0.001" type="number" value={segment.end} /></td>
                      <td>{duration(segment).toFixed(3)}s</td>
                      <td>{gap}</td>
                      <td><textarea aria-label={`第${index + 1}条文案`} disabled={locked} onChange={(event) => onEdit(index, "text", event.target.value)} value={segment.text} /></td>
                      <td><button disabled={locked} onClick={() => onSplit(index)} type="button">拆分</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!segments.length ? <div className="transcript-empty">当前字幕没有可编辑片段。</div> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
