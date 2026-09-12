import { useCallback, useEffect, useState } from "react";
import {
  controlLiveClipBatch,
  getLiveClipBatch,
} from "../api/client";

const stageOrder = [
  ["transcribing", "字幕转写"],
  ["planning", "切片规划"],
  ["rendering", "视频渲染"],
  ["qa", "质量检查"],
  ["exporting", "工程导出"],
] as const;

type BatchJob = {
  status: string;
  currentStage: string;
  progressPercent: number;
  stages: Record<string, any>;
};

type BatchAction = "pause" | "resume" | "retry";

export function normalizeBatchResponse(response: any): BatchJob {
  const data = response?.data || {};
  const state = data.batch_state || {};
  return {
    status: state.status || "queued",
    currentStage: state.current_stage || "transcribing",
    progressPercent: Number(data.progress_percent || 0),
    stages: state.stages || {},
  };
}

export function availableBatchActions(status: string): BatchAction[] {
  if (status === "queued" || status === "running") return ["pause"];
  if (status === "paused") return ["resume"];
  if (status === "failed") return ["retry"];
  return [];
}

export function BatchStageProgress({ taskId }: { taskId: string }) {
  const [job, setJob] = useState<BatchJob | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await getLiveClipBatch(taskId);
      if (response?.status !== "ok") {
        setError(response?.message || "无法读取批量任务状态");
        return;
      }
      setJob(normalizeBatchResponse(response));
      setError("");
    } catch (reason: any) {
      setError(reason?.message || "无法读取批量任务状态");
    }
  }, [taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAction(action: BatchAction) {
    setBusy(action);
    try {
      const response = await controlLiveClipBatch(taskId, action);
      if (response?.status !== "ok") {
        setError(response?.data?.errors?.[0]?.message || "批量任务控制失败");
        return;
      }
      setJob(normalizeBatchResponse(response));
      setError("");
    } catch (reason: any) {
      setError(reason?.message || "批量任务控制失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <BatchStageProgressView
      busy={busy}
      error={error}
      job={job}
      onAction={handleAction}
      onRefresh={refresh}
    />
  );
}

export function BatchStageProgressView({
  busy,
  error,
  job,
  onAction,
  onRefresh,
}: {
  busy: string;
  error: string;
  job: BatchJob | null;
  onAction: (action: BatchAction) => void;
  onRefresh: () => void;
}) {
  const actions = availableBatchActions(job?.status || "");
  return (
    <section className="batch-stage-progress commerce-card" id="liveClipBatchProgress">
      <div className="section-head">
        <div>
          <h3>批量任务进度</h3>
          <p>{job ? `${job.progressPercent}% · ${job.status}` : "正在读取状态"}</p>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={onRefresh}>刷新</button>
      </div>
      <div className="batch-progress-track" aria-label="批量任务总进度">
        <span style={{ width: `${job?.progressPercent || 0}%` }} />
      </div>
      <div className="batch-stage-list">
        {stageOrder.map(([key, label]) => {
          const stage = job?.stages?.[key] || {};
          return (
            <div className={`batch-stage-row ${stage.status || "pending"}`} key={key}>
              <strong>{label}</strong>
              <span>{stage.status || "pending"}</span>
              <small>{stage.progress || 0}% · 尝试 {stage.attempts || 0} 次</small>
              {stage.error ? <em>{stage.error}</em> : null}
            </div>
          );
        })}
      </div>
      {error ? <p className="batch-stage-error">{error}</p> : null}
      <div className="batch-stage-actions">
        {actions.includes("pause") ? <button type="button" disabled={Boolean(busy)} onClick={() => onAction("pause")}>暂停</button> : null}
        {actions.includes("resume") ? <button type="button" disabled={Boolean(busy)} onClick={() => onAction("resume")}>继续</button> : null}
        {actions.includes("retry") ? <button type="button" disabled={Boolean(busy)} onClick={() => onAction("retry")}>重试失败阶段</button> : null}
      </div>
    </section>
  );
}
