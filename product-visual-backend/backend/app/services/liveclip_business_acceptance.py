from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Callable


TaskLookup = Callable[[str], dict | None]
AuditFunction = Callable[..., dict]


def build_business_acceptance(
    task_ids: list[str],
    *,
    task_lookup: TaskLookup,
    audit_fn: AuditFunction,
    project_root: Path | None = None,
    ffprobe: Path | None = None,
) -> dict:
    unique_ids = list(dict.fromkeys(item.strip() for item in task_ids if item.strip()))
    tasks = []
    for task_id in unique_ids:
        task = task_lookup(task_id)
        if task is None:
            tasks.append({
                "task_id": task_id,
                "status": "BLOCKED",
                "blockers": ["task_not_found"],
                "artifact_audit": None,
            })
            continue
        audit = (
            audit_fn(task_id, project_root, ffprobe)
            if project_root is not None and ffprobe is not None
            else audit_fn(task_id)
        )
        completed = str(task.get("status", "")).lower() in {"completed", "ok"}
        review_passed = str(task.get("review_status", "")).lower() == "pass"
        blockers = []
        if not completed:
            blockers.append(f"task_status:{task.get('status') or 'unknown'}")
        if not review_passed:
            blockers.append(
                f"review_status:{task.get('review_status') or 'unknown'}"
            )
        if not audit.get("valid"):
            blockers.append("artifact_audit_failed")
        tasks.append({
            "task_id": task_id,
            "database_status": task.get("status"),
            "status": "PASS" if not blockers else "BLOCKED",
            "blockers": blockers,
            "artifact_audit": audit,
            "sfx_mix_statuses": audit.get("sfx_mix_statuses", []),
        })

    passed = sum(item["status"] == "PASS" for item in tasks)
    blockers = []
    if len(unique_ids) < 3:
        blockers.append("at_least_3_real_tasks")
    if len(unique_ids) > 5:
        blockers.append("at_most_5_real_tasks")
    if any(item["status"] == "BLOCKED" for item in tasks):
        blockers.append("one_or_more_tasks_blocked")

    if any(item["status"] == "BLOCKED" for item in tasks):
        status = "BLOCKED"
    elif blockers:
        status = "PARTIAL"
    else:
        status = "PASS"
    metadata_only = sum(
        "metadata_only" in item.get("sfx_mix_statuses", [])
        for item in tasks
    )
    return {
        "name": "V1.1_BUSINESS_SAMPLE_ACCEPTANCE",
        "status": status,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "submitted": len(unique_ids),
            "passed": passed,
            "required_minimum": 3,
            "allowed_maximum": 5,
            "metadata_only_sfx_tasks": metadata_only,
        },
        "blockers": blockers,
        "tasks": tasks,
    }


def render_business_acceptance_markdown(report: dict) -> str:
    lines = [
        "# V1.1 Business Sample Acceptance",
        "",
        f"status: {report['status']}",
        f"created_at: {report['created_at']}",
        f"submitted: {report['summary']['submitted']}",
        f"passed: {report['summary']['passed']}",
        f"metadata_only_sfx_tasks: {report['summary']['metadata_only_sfx_tasks']}",
        "",
        "## Tasks",
        "",
    ]
    for item in report["tasks"]:
        blockers = ", ".join(item.get("blockers") or []) or "none"
        lines.append(
            f"- {item['task_id']}: {item['status']} (blockers: {blockers})"
        )
    lines.extend(["", "## Global Blockers", ""])
    lines.extend(f"- {item}" for item in report["blockers"])
    if not report["blockers"]:
        lines.append("- none")
    lines.extend([
        "",
        "## SFX Truthfulness",
        "",
        "metadata_only means effect points exist but no licensed audio asset was mixed.",
    ])
    return "\n".join(lines) + "\n"
