from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.contracts.repair_task_contract import RepairTask
from backend.app.core.paths import EXPORTS_DIR
from backend.app.models.task import Task, TaskResult
from backend.app.schemas.live_clip_qa import aggregate_qa_results
from backend.app.services.live_clip_service import (
    WORKFLOW,
    _normalize_segment,
    render_live_clip_repair_variant,
)


def execute_liveclip_repair(
    db: Session,
    task_id: str,
    repair_task: RepairTask,
) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return _blocked("任务不存在或不是直播切片任务。", ["task_id"])
    result = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task_id, TaskResult.workflow == WORKFLOW)
        .order_by(TaskResult.created_at.desc())
    )
    if not result:
        return _blocked("当前任务还没有可返修结果。", ["task_result"])

    result_json = deepcopy(result.result_json or {})
    segments = [deepcopy(item) for item in result_json.get("segments") or []]
    target_index = next(
        (
            index
            for index, item in enumerate(segments)
            if str(item.get("clip_id") or item.get("slice_id") or "")
            == repair_task.clip_id
        ),
        None,
    )
    if target_index is None:
        return _blocked("未找到需要返修的切片。", ["clip_id"])
    transcript = result_json.get("transcript") or {}
    if transcript.get("status") != "completed" or not transcript.get("segments"):
        return _blocked("完整字幕尚未就绪，无法执行局部返修。", ["transcript"])

    internal_sidecars = deepcopy(result_json.get("internal_sidecars") or {})
    repair_state = deepcopy(
        internal_sidecars.get("repair_state")
        or {"current_revision": 1, "attempts": []}
    )
    current_revision = int(repair_state.get("current_revision") or 1)
    if repair_task.source_revision != current_revision:
        return {
            **_blocked(
                "返修版本已过期，请刷新后基于最新版本重新提交。",
                ["repair_revision"],
            ),
            "data": {"current_revision": current_revision},
        }

    repair_revision = current_revision + 1
    attempt_id = f"repair_{repair_revision:04d}_{uuid.uuid4().hex[:12]}"
    attempt_dir = EXPORTS_DIR / task_id / WORKFLOW / "repairs" / attempt_id
    attempt_dir.mkdir(parents=True, exist_ok=False)
    before_segment = deepcopy(segments[target_index])
    try:
        repaired_segment, warnings, execution = render_live_clip_repair_variant(
            task=task,
            result_json=result_json,
            segment=deepcopy(before_segment),
            transcript=deepcopy(transcript),
            repair_task=repair_task,
            attempt_dir=attempt_dir,
        )
    except Exception as error:
        message = f"局部返修执行失败：{error}"
        attempt_record = {
            "attempt_id": attempt_id,
            "source_revision": current_revision,
            "repair_revision": repair_revision,
            "repair_task": repair_task.model_dump(mode="json"),
            "before_segment": before_segment,
            "after_segment": None,
            "execution": {"rerun_scope": repair_task.rerun_scope},
            "qa_result": {"qa_status": "blocked", "qa_pass": False},
            "warnings": [message],
            "replaced_main_version": False,
            "status": "failed",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "output_dir": str(attempt_dir),
        }
        manifest_path = attempt_dir / "repair_manifest.json"
        manifest_path.write_text(
            json.dumps(attempt_record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        attempt_record["manifest_path"] = str(manifest_path)
        repair_state["current_revision"] = repair_revision
        repair_state.setdefault("attempts", []).append(attempt_record)
        internal_sidecars["repair_state"] = repair_state
        result_json["internal_sidecars"] = internal_sidecars
        result.result_json = result_json
        db.commit()
        return {
            "status": "blocked",
            "message": message,
            "next_action": "主版本未替换，请检查失败原因后基于最新返修版本重试。",
            "warnings": [message],
            "missing_inputs": [],
            "data": {
                "task_id": task_id,
                "clip_id": repair_task.clip_id,
                "attempt_id": attempt_id,
                "source_revision": current_revision,
                "repair_revision": repair_revision,
                "replaced_main_version": False,
                "qa_result": attempt_record["qa_result"],
                "execution": attempt_record["execution"],
                "manifest_path": str(manifest_path),
            },
        }
    new_qa = deepcopy(repaired_segment.get("qa_result") or {})
    qa_passed = new_qa.get("qa_status") == "passed" and bool(
        new_qa.get("qa_pass", True)
    )
    replaced_main = bool(qa_passed)

    if replaced_main:
        segments[target_index] = deepcopy(repaired_segment)
        result_json["segments"] = segments
        normalized = _normalize_segment(repaired_segment, task.input_json or {})
        slice_segments = [
            deepcopy(item) for item in result_json.get("slice_segments") or []
        ]
        slice_index = next(
            (
                index
                for index, item in enumerate(slice_segments)
                if str(item.get("clip_id") or item.get("slice_id") or "")
                == repair_task.clip_id
            ),
            None,
        )
        if slice_index is None:
            slice_segments.append(normalized)
        else:
            slice_segments[slice_index] = normalized
        result_json["slice_segments"] = slice_segments
        result_json["qa_result"] = aggregate_qa_results(
            [item.get("qa_result") or item.get("qa") or {} for item in segments],
            warnings=warnings,
        )
        result_json["status"] = (
            "ok" if result_json["qa_result"].get("qa_status") == "passed" else "blocked"
        )
        result_json["review_status"] = "pending_review"

    attempt_record = {
        "attempt_id": attempt_id,
        "source_revision": current_revision,
        "repair_revision": repair_revision,
        "repair_task": repair_task.model_dump(mode="json"),
        "before_segment": before_segment,
        "after_segment": deepcopy(repaired_segment),
        "execution": deepcopy(execution),
        "qa_result": new_qa,
        "warnings": list(warnings),
        "replaced_main_version": replaced_main,
        "status": "passed" if qa_passed else "failed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "output_dir": str(attempt_dir),
    }
    manifest_path = attempt_dir / "repair_manifest.json"
    manifest_path.write_text(
        json.dumps(attempt_record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    attempt_record["manifest_path"] = str(manifest_path)
    repair_state["current_revision"] = repair_revision
    repair_state.setdefault("attempts", []).append(attempt_record)
    internal_sidecars["repair_state"] = repair_state
    result_json["internal_sidecars"] = internal_sidecars
    result.result_json = result_json
    if replaced_main:
        result.status = result_json.get("status") or "ok"
        task.status = "pending_review"
        task.review_status = "pending_review"
    db.commit()

    next_action = (
        "局部返修已通过 QA，请重新确认审核。"
        if replaced_main
        else "局部返修仍未通过 QA，主版本未替换；请查看本次问题后再次局部返修。"
    )
    return {
        "status": "ok" if replaced_main else "blocked",
        "message": next_action,
        "next_action": next_action,
        "warnings": list(warnings),
        "missing_inputs": [],
        "data": {
            "task_id": task_id,
            "clip_id": repair_task.clip_id,
            "attempt_id": attempt_id,
            "source_revision": current_revision,
            "repair_revision": repair_revision,
            "replaced_main_version": replaced_main,
            "qa_result": new_qa,
            "execution": execution,
            "manifest_path": str(manifest_path),
        },
    }


def list_liveclip_repairs(db: Session, task_id: str) -> dict[str, Any]:
    result = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task_id, TaskResult.workflow == WORKFLOW)
        .order_by(TaskResult.created_at.desc())
    )
    if not result:
        return _blocked("当前任务还没有返修记录。", ["task_result"])
    state = (
        ((result.result_json or {}).get("internal_sidecars") or {}).get(
            "repair_state"
        )
        or {"current_revision": 1, "attempts": []}
    )
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "current_revision": int(state.get("current_revision") or 1),
            "attempts": deepcopy(state.get("attempts") or []),
        },
        "missing_inputs": [],
        "warnings": [],
    }


def restore_liveclip_repair_attempt(
    db: Session,
    task_id: str,
    attempt_id: str,
    *,
    source_revision: int,
) -> dict[str, Any]:
    task = db.get(Task, task_id)
    result = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task_id, TaskResult.workflow == WORKFLOW)
        .order_by(TaskResult.created_at.desc())
    )
    if not task or not result:
        return _blocked("当前任务没有可恢复的返修结果。", ["task_result"])
    result_json = deepcopy(result.result_json or {})
    internal_sidecars = deepcopy(result_json.get("internal_sidecars") or {})
    state = deepcopy(
        internal_sidecars.get("repair_state")
        or {"current_revision": 1, "attempts": []}
    )
    current_revision = int(state.get("current_revision") or 1)
    if int(source_revision) != current_revision:
        return {
            **_blocked(
                "恢复请求基于过期版本，请刷新后重试。", ["repair_revision"]
            ),
            "data": {"current_revision": current_revision},
        }
    source_attempt = next(
        (
            item
            for item in state.get("attempts") or []
            if str(item.get("attempt_id") or "") == attempt_id
        ),
        None,
    )
    if not source_attempt or not source_attempt.get("before_segment"):
        return _blocked("指定返修版本没有可恢复快照。", ["attempt_id"])

    restored_segment = deepcopy(source_attempt["before_segment"])
    clip_id = str(restored_segment.get("clip_id") or restored_segment.get("slice_id") or "")
    segments = [deepcopy(item) for item in result_json.get("segments") or []]
    target_index = next(
        (
            index
            for index, item in enumerate(segments)
            if str(item.get("clip_id") or item.get("slice_id") or "") == clip_id
        ),
        None,
    )
    if target_index is None:
        return _blocked("主版本中已找不到对应切片。", ["clip_id"])
    current_segment = deepcopy(segments[target_index])
    segments[target_index] = restored_segment
    result_json["segments"] = segments
    normalized = _normalize_segment(restored_segment, task.input_json or {})
    slice_segments = [
        deepcopy(item) for item in result_json.get("slice_segments") or []
    ]
    slice_index = next(
        (
            index
            for index, item in enumerate(slice_segments)
            if str(item.get("clip_id") or item.get("slice_id") or "") == clip_id
        ),
        None,
    )
    if slice_index is None:
        slice_segments.append(normalized)
    else:
        slice_segments[slice_index] = normalized
    result_json["slice_segments"] = slice_segments
    result_json["qa_result"] = aggregate_qa_results(
        [item.get("qa_result") or item.get("qa") or {} for item in segments]
    )
    result_json["status"] = (
        "ok" if result_json["qa_result"].get("qa_status") == "passed" else "blocked"
    )
    result_json["review_status"] = "not_submitted"

    repair_revision = current_revision + 1
    restore_attempt_id = f"restore_{repair_revision:04d}_{uuid.uuid4().hex[:12]}"
    restore_record = {
        "attempt_id": restore_attempt_id,
        "source_revision": current_revision,
        "repair_revision": repair_revision,
        "restored_from_attempt_id": attempt_id,
        "repair_task": None,
        "before_segment": current_segment,
        "after_segment": restored_segment,
        "execution": {"rerun_scope": "restore_only", "rerendered_assets": []},
        "qa_result": deepcopy(restored_segment.get("qa_result") or {}),
        "warnings": [],
        "replaced_main_version": True,
        "status": "restored",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "output_dir": "",
    }
    state["current_revision"] = repair_revision
    state.setdefault("attempts", []).append(restore_record)
    internal_sidecars["repair_state"] = state
    result_json["internal_sidecars"] = internal_sidecars
    result.result_json = result_json
    result.status = result_json["status"]
    task.status = result_json["status"]
    task.review_status = "not_submitted"
    db.commit()
    return {
        "status": "ok",
        "message": "已恢复返修前版本。",
        "next_action": "请重新检查该版本的 QA 状态。",
        "warnings": [],
        "missing_inputs": [],
        "data": {
            "task_id": task_id,
            "clip_id": clip_id,
            "attempt_id": restore_attempt_id,
            "restored_from_attempt_id": attempt_id,
            "source_revision": current_revision,
            "repair_revision": repair_revision,
            "qa_result": result_json["qa_result"],
        },
    }


def _blocked(message: str, missing_inputs: list[str]) -> dict[str, Any]:
    return {
        "status": "blocked",
        "message": message,
        "next_action": message,
        "data": {},
        "missing_inputs": missing_inputs,
        "warnings": [message],
    }
