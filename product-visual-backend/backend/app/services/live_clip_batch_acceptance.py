from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Callable


TaskLookup = Callable[[str], dict | None]
AuditFunction = Callable[..., dict]


def summarize_batch_acceptance(rows: list[dict]) -> dict:
    unique_rows = list(_dedupe_rows(rows))
    task_count = len(unique_rows)
    blockers: list[str] = []
    failed_tasks = [
        row["task_id"]
        for row in unique_rows
        if row.get("database_status") not in {"completed", "ok"}
    ]
    unapproved_tasks = [
        row["task_id"]
        for row in unique_rows
        if str(row.get("review_status") or "").lower() != "pass"
    ]
    invalid_artifact_tasks = [
        row["task_id"]
        for row in unique_rows
        if not row.get("artifact_valid", False)
    ]
    metadata_only_tasks = [
        row["task_id"]
        for row in unique_rows
        if "metadata_only" in (row.get("sfx_mix_statuses") or [])
    ]
    missing_tasks = [
        row["task_id"]
        for row in unique_rows
        if row.get("lookup_status") == "missing"
    ]

    if task_count < 10:
        blockers.append("少于 10 个真实任务")
    if task_count > 20:
        blockers.append("超过 20 个任务，建议拆分批次验收")
    if missing_tasks:
        blockers.append(f"存在缺失任务: {', '.join(missing_tasks)}")
    if failed_tasks:
        blockers.append(f"存在未完成任务: {', '.join(failed_tasks)}")
    if unapproved_tasks:
        blockers.append(f"存在未审核通过任务: {', '.join(unapproved_tasks)}")
    if invalid_artifact_tasks:
        blockers.append(f"存在产物校验失败任务: {', '.join(invalid_artifact_tasks)}")
    if metadata_only_tasks:
        blockers.append(f"仍有 metadata_only 音效任务: {', '.join(metadata_only_tasks)}")

    status = "PASS" if not blockers and 10 <= task_count <= 20 else "PARTIAL"
    return {
        "status": status,
        "task_count": task_count,
        "pass_count": sum(
            not row.get("blockers")
            and row.get("artifact_valid")
            and str(row.get("review_status") or "").lower() == "pass"
            and row.get("database_status") in {"completed", "ok"}
            for row in unique_rows
        ),
        "metadata_only_count": len(metadata_only_tasks),
        "blockers": blockers,
        "rows": unique_rows,
    }


def build_batch_acceptance_report(
    task_ids: list[str],
    *,
    task_lookup: TaskLookup,
    audit_fn: AuditFunction,
    project_root: Path | None = None,
    ffprobe: Path | None = None,
) -> dict:
    rows: list[dict] = []
    for task_id in list(dict.fromkeys(item.strip() for item in task_ids if item.strip())):
        task = task_lookup(task_id)
        if task is None:
            rows.append(
                {
                    "task_id": task_id,
                    "lookup_status": "missing",
                    "database_status": "missing",
                    "review_status": "missing",
                    "artifact_valid": False,
                    "artifact_audit": None,
                    "sfx_mix_statuses": [],
                    "blockers": ["task_not_found"],
                }
            )
            continue
        audit = (
            audit_fn(task_id, project_root, ffprobe)
            if project_root is not None and ffprobe is not None
            else audit_fn(task_id)
        )
        row_blockers = []
        if str(task.get("status") or "").lower() not in {"completed", "ok"}:
            row_blockers.append(f"task_status:{task.get('status') or 'unknown'}")
        if str(task.get("review_status") or "").lower() != "pass":
            row_blockers.append(
                f"review_status:{task.get('review_status') or 'unknown'}"
            )
        if not audit.get("valid"):
            row_blockers.append("artifact_audit_failed")
        if "metadata_only" in (audit.get("sfx_mix_statuses") or []):
            row_blockers.append("metadata_only_sfx")
        rows.append(
            {
                "task_id": task_id,
                "lookup_status": "found",
                "database_status": task.get("status"),
                "review_status": task.get("review_status"),
                "artifact_valid": bool(audit.get("valid")),
                "artifact_audit": audit,
                "sfx_mix_statuses": audit.get("sfx_mix_statuses", []),
                "blockers": row_blockers,
            }
        )

    summary = summarize_batch_acceptance(rows)
    return {
        "name": "liveclip_v1_2_batch_acceptance",
        "status": summary["status"],
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "scope": [
            "real_overlay_render",
            "real_sfx_mix",
            "transcript_timeline_workspace",
            "template_registry",
            "batch_retry_and_resume",
            "zip_consistency",
        ],
        "summary": {
            "task_count": summary["task_count"],
            "pass_count": summary["pass_count"],
            "metadata_only_count": summary["metadata_only_count"],
            "required_minimum": 10,
            "recommended_maximum": 20,
        },
        "blockers": summary["blockers"],
        "tasks": summary["rows"],
    }


def render_batch_acceptance_markdown(report: dict) -> str:
    lines = [
        "# LiveClip V1.2 Batch Acceptance",
        "",
        f"status: {report['status']}",
        f"created_at: {report['created_at']}",
        f"task_count: {report['summary']['task_count']}",
        f"pass_count: {report['summary']['pass_count']}",
        f"metadata_only_count: {report['summary']['metadata_only_count']}",
        "",
        "## Scope",
        "",
    ]
    lines.extend(f"- {item}" for item in report["scope"])
    lines.extend(["", "## Tasks", ""])
    for item in report["tasks"]:
        blockers = ", ".join(item.get("blockers") or []) or "none"
        lines.append(
            f"- {item['task_id']}: db={item['database_status']} review={item['review_status']} blockers={blockers}"
        )
    lines.extend(["", "## Global Blockers", ""])
    lines.extend(f"- {item}" for item in report["blockers"])
    if not report["blockers"]:
        lines.append("- none")
    return "\n".join(lines) + "\n"


def _dedupe_rows(rows: list[dict]):
    seen: set[str] = set()
    for row in rows:
        task_id = str(row.get("task_id") or "").strip()
        if not task_id or task_id in seen:
            continue
        seen.add(task_id)
        yield row
