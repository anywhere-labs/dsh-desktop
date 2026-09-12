from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.task import CausalTrace, Task, TaskResult


STAGES = ["transcribing", "planning", "rendering", "qa", "exporting"]
STAGE_STATUSES = {"pending", "running", "completed", "failed"}
JOB_STATUSES = {"queued", "running", "pausing", "paused", "failed", "completed"}
ACTIVE_BATCH_STATUSES = {"queued", "running", "pausing", "paused"}


def new_job_state() -> dict:
    return {
        "attempt_id": uuid.uuid4().hex,
        "status": "queued",
        "current_stage": "transcribing",
        "pause_requested": False,
        "stages": {stage: _new_stage() for stage in STAGES},
        "updated_at": _now(),
    }


def load_job_state(value: dict | None) -> dict:
    state = new_job_state()
    if not value:
        return state
    unknown = set((value.get("stages") or {}).keys()) - set(STAGES)
    if unknown:
        raise ValueError(f"unknown job stages: {sorted(unknown)}")
    status = value.get("status", "queued")
    if status not in JOB_STATUSES:
        raise ValueError("invalid job status")
    state.update({
        "attempt_id": value.get("attempt_id") or state["attempt_id"],
        "status": status,
        "current_stage": value.get("current_stage") or state["current_stage"],
        "pause_requested": bool(value.get("pause_requested", False)),
        "updated_at": value.get("updated_at") or state["updated_at"],
    })
    for stage, item in (value.get("stages") or {}).items():
        stage_state = {**_new_stage(), **deepcopy(item)}
        if stage_state["status"] not in STAGE_STATUSES:
            raise ValueError(f"invalid status for stage {stage}")
        state["stages"][stage] = stage_state
    return state


def next_stage(state: dict) -> str | None:
    loaded = load_job_state(state)
    for stage in STAGES:
        if loaded["stages"][stage]["status"] != "completed":
            return stage
    return None


def start_stage(state: dict, stage: str) -> dict:
    loaded = load_job_state(state)
    expected = next_stage(loaded)
    if stage not in STAGES or stage != expected:
        raise ValueError(f"next stage must be {expected}")
    item = loaded["stages"][stage]
    if item["status"] not in {"pending", "failed"}:
        raise ValueError(f"stage {stage} cannot start from {item['status']}")
    item.update({
        "status": "running",
        "attempts": int(item.get("attempts") or 0) + 1,
        "started_at": _now(),
        "finished_at": None,
        "error": None,
        "progress": max(0, int(item.get("progress") or 0)),
    })
    loaded.update({
        "status": "running",
        "current_stage": stage,
        "updated_at": _now(),
    })
    return loaded


def complete_stage(
    state: dict, stage: str, artifact: dict | None = None
) -> dict:
    loaded = load_job_state(state)
    _require_running(loaded, stage)
    item = loaded["stages"][stage]
    item.update({
        "status": "completed",
        "progress": 100,
        "artifact": deepcopy(artifact or item.get("artifact") or {}),
        "finished_at": _now(),
        "error": None,
    })
    following = next_stage(loaded)
    loaded.update({
        "status": "completed" if following is None else "running",
        "current_stage": following or stage,
        "updated_at": _now(),
    })
    return loaded


def fail_stage(state: dict, stage: str, error: str) -> dict:
    loaded = load_job_state(state)
    _require_running(loaded, stage)
    loaded["stages"][stage].update({
        "status": "failed",
        "error": str(error),
        "finished_at": _now(),
    })
    loaded.update({
        "status": "failed",
        "current_stage": stage,
        "updated_at": _now(),
    })
    return loaded


def request_pause(state: dict) -> dict:
    loaded = load_job_state(state)
    if loaded["status"] in {"completed", "failed"}:
        raise ValueError(f"cannot pause {loaded['status']} job")
    loaded["pause_requested"] = True
    loaded["status"] = "pausing"
    loaded["updated_at"] = _now()
    return loaded


def pause_between_stages(state: dict) -> dict:
    loaded = load_job_state(state)
    if not loaded["pause_requested"]:
        return loaded
    if any(item["status"] == "running" for item in loaded["stages"].values()):
        raise ValueError("pause is only allowed between stages")
    loaded["status"] = "paused"
    loaded["updated_at"] = _now()
    return loaded


def resume_job(state: dict) -> dict:
    loaded = load_job_state(state)
    if loaded["status"] != "paused":
        raise ValueError("only paused jobs can resume")
    loaded["pause_requested"] = False
    loaded["status"] = "queued"
    loaded["current_stage"] = next_stage(loaded)
    loaded["updated_at"] = _now()
    return loaded


def retry_failed_stage(state: dict) -> dict:
    loaded = load_job_state(state)
    if loaded["status"] != "failed":
        raise ValueError("only failed jobs can retry")
    failed_index = next(
        (
            index
            for index, stage in enumerate(STAGES)
            if loaded["stages"][stage]["status"] == "failed"
        ),
        None,
    )
    if failed_index is None:
        raise ValueError("failed job has no failed stage")
    for stage in STAGES[failed_index:]:
        attempts = loaded["stages"][stage].get("attempts", 0)
        loaded["stages"][stage] = {**_new_stage(), "attempts": attempts}
    loaded.update({
        "status": "queued",
        "current_stage": STAGES[failed_index],
        "pause_requested": False,
        "updated_at": _now(),
    })
    return loaded


def progress_percent(state: dict) -> int:
    loaded = load_job_state(state)
    total = sum(
        100 if item["status"] == "completed" else int(item.get("progress") or 0)
        for item in loaded["stages"].values()
    )
    return max(0, min(100, round(total / len(STAGES))))


def get_persistent_job_state(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return {"status": "blocked", "data": {}, "missing_inputs": ["task_id"]}
    result = _latest_result(db, task_id)
    if result is None:
        state = new_job_state()
        result = TaskResult(
            id=uuid.uuid4().hex,
            task_id=task_id,
            workflow=task.workflow,
            status=task.status,
            result_json={"batch_state": state},
        )
        db.add(result)
        try:
            db.commit()
        except Exception:
            db.rollback()
            return {
                "status": "blocked",
                "data": {},
                "missing_inputs": ["batch_persistence"],
            }
    else:
        try:
            state = load_job_state((result.result_json or {}).get("batch_state"))
        except ValueError as exc:
            return _control_error(str(exc))
        recovered = _recover_completed_legacy_state(result.result_json or {}, state)
        if recovered != state:
            state = recovered
            result.result_json = {
                **(result.result_json or {}),
                "attempt_id": state.get("attempt_id"),
                "batch_state": state,
            }
            db.commit()
        elif "batch_state" not in (result.result_json or {}):
            result.result_json = {
                **(result.result_json or {}),
                "attempt_id": state.get("attempt_id"),
                "batch_state": state,
            }
            db.commit()
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "result_id": result.id,
            "attempt_id": state.get("attempt_id"),
            "batch_state": state,
            "progress_percent": progress_percent(state),
        },
        "missing_inputs": [],
    }


def control_persistent_job_state(
    db: Session, task_id: str, action: str
) -> dict:
    current = get_persistent_job_state(db, task_id)
    if current["status"] != "ok":
        return current
    result = _latest_result(db, task_id)
    state = current["data"]["batch_state"]
    try:
        if action == "pause":
            state = request_pause(state)
            if not any(
                item["status"] == "running"
                for item in state["stages"].values()
            ):
                state = pause_between_stages(state)
        elif action == "resume":
            state = resume_job(state)
        elif action == "retry":
            state = retry_failed_stage(state)
            db.execute(delete(CausalTrace).where(CausalTrace.task_id == task_id))
        else:
            return _control_error("unsupported batch action")
    except ValueError as exc:
        return _control_error(str(exc))
    result.result_json = {
        **(result.result_json or {}),
        "attempt_id": state.get("attempt_id"),
        "batch_state": state,
    }
    try:
        db.commit()
    except Exception:
        db.rollback()
        return _control_error("batch state persistence failed")
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "result_id": result.id,
            "attempt_id": state.get("attempt_id"),
            "batch_state": state,
            "progress_percent": progress_percent(state),
        },
        "missing_inputs": [],
    }


def save_persistent_job_state(
    db: Session, task_id: str, state: dict
) -> dict:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return {"status": "blocked", "data": {}, "missing_inputs": ["task_id"]}
    normalized = load_job_state(state)
    result = _latest_result(db, task_id)
    if result is None:
        result = TaskResult(
            id=uuid.uuid4().hex,
            task_id=task_id,
            workflow=task.workflow,
            status=_task_result_status_from_batch(normalized, task.status),
            result_json={},
        )
        db.add(result)
    elif _should_fork_result_for_active_batch(result, normalized):
        result = TaskResult(
            id=uuid.uuid4().hex,
            task_id=task_id,
            workflow=task.workflow,
            status=_task_result_status_from_batch(normalized, task.status),
            result_json=_fresh_rerun_result_payload(result.result_json or {}),
        )
        db.add(result)
    result.result_json = {
        **(result.result_json or {}),
        "attempt_id": normalized.get("attempt_id"),
        "batch_state": normalized,
    }
    result.status = _task_result_status_from_batch(normalized, result.status or task.status)
    try:
        db.commit()
    except Exception:
        db.rollback()
        return _control_error("batch state persistence failed")
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "result_id": result.id,
            "attempt_id": normalized.get("attempt_id"),
            "batch_state": normalized,
            "progress_percent": progress_percent(normalized),
        },
        "missing_inputs": [],
    }


def _new_stage() -> dict[str, Any]:
    return {
        "status": "pending",
        "progress": 0,
        "attempts": 0,
        "artifact": {},
        "error": None,
        "started_at": None,
        "finished_at": None,
    }


def _task_result_status_from_batch(state: dict, fallback: str) -> str:
    status = (state or {}).get("status")
    if status in {"queued", "running", "pausing"}:
        return "running"
    if status == "paused":
        return "partial"
    if status == "failed":
        return "failed"
    return fallback


def _has_terminal_live_clip_payload(payload: dict) -> bool:
    if not payload:
        return False
    batch_state = payload.get("batch_state")
    if batch_state:
        try:
            loaded = load_job_state(batch_state)
        except ValueError:
            loaded = None
        if loaded and loaded.get("status") in ACTIVE_BATCH_STATUSES:
            return False
    return bool(
        payload.get("slice_segments")
        or payload.get("segments")
        or payload.get("artifacts")
        or payload.get("qa_result")
    )


def _should_fork_result_for_active_batch(result: TaskResult, state: dict) -> bool:
    return (
        (state or {}).get("status") in ACTIVE_BATCH_STATUSES
        and _has_terminal_live_clip_payload(result.result_json or {})
    )


def _fresh_rerun_result_payload(payload: dict) -> dict:
    preserved: dict[str, Any] = {}
    for key in (
        "project_id",
        "task_id",
        "workflow",
        "workflow_skill",
        "source_video",
        "input_form",
        "skills",
        "stage_boundary",
    ):
        value = deepcopy((payload or {}).get(key))
        if value not in (None, "", [], {}):
            preserved[key] = value
    preserved.update({
        "status": "running",
        "segments": [],
        "slice_segments": [],
        "artifacts": {},
        "qa_result": {},
        "warnings": [],
        "next_action": [],
        "review_status": "not_submitted",
    })
    return preserved


def _recover_completed_legacy_state(payload: dict, state: dict) -> dict:
    if state["status"] != "queued" or any(
        item["status"] != "pending" for item in state["stages"].values()
    ):
        return state
    artifacts = payload.get("artifacts") or {}
    has_project = any(
        artifacts.get(key)
        for key in (
            "jianying_project_zip",
            "jianying_project",
            "jianying_zip",
        )
    )
    segments = payload.get("slice_segments") or []
    has_render = payload.get("has_real_render") is True or (
        bool(segments)
        and all(
            (item.get("files") or {}).get("final_clip")
            for item in segments
        )
    )
    terminal = (
        payload.get("status") == "ok"
        and has_render
        and (payload.get("qa_result") or {}).get("qa_status") == "passed"
        and has_project
    )
    if not terminal:
        return state
    recovered = new_job_state()
    if payload.get("attempt_id"):
        recovered["attempt_id"] = str(payload["attempt_id"])
    for stage in STAGES:
        recovered = complete_stage(start_stage(recovered, stage), stage)
    return recovered


def _require_running(state: dict, stage: str) -> None:
    if stage not in STAGES or state["stages"][stage]["status"] != "running":
        raise ValueError(f"stage {stage} is not running")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _latest_result(db: Session, task_id: str) -> TaskResult | None:
    results = list(
        db.scalars(
            select(TaskResult)
            .where(TaskResult.task_id == task_id)
            .order_by(TaskResult.created_at.desc())
        )
    )
    if not results:
        return None
    for result in results:
        raw_state = (result.result_json or {}).get("batch_state")
        if not raw_state:
            continue
        try:
            state = load_job_state(raw_state)
        except ValueError:
            continue
        if state.get("status") in ACTIVE_BATCH_STATUSES | {"failed"}:
            return result
    return results[0]


def _control_error(message: str) -> dict:
    return {
        "status": "blocked",
        "data": {"errors": [{"code": "invalid_batch_state", "message": message}]},
        "missing_inputs": ["batch_state"],
    }
