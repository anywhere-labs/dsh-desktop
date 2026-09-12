from __future__ import annotations

import os
from copy import deepcopy
from typing import Any

from backend.app.services.liveclip_content_contract_adapter import (
    build_p4_timeline_packaging_contract,
)


P4_ENABLED_ENV = "LIVECLIP_P4_TIMELINE_PACKAGING_ENABLED"
P4_CANARY_TASK_IDS_ENV = "LIVECLIP_P4_TIMELINE_PACKAGING_CANARY_TASK_IDS"


def p4_enabled() -> bool:
    return os.getenv(P4_ENABLED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def p4_task_allowed(task_id: str) -> bool:
    allowed = {
        value.strip()
        for value in os.getenv(P4_CANARY_TASK_IDS_ENV, "").split(",")
        if value.strip()
    }
    return bool(task_id and task_id in allowed)


def prepare_p4_packaging_consumption(
    *,
    task_id: str,
    selected_plans: list[dict[str, Any]],
    transcript: dict[str, Any],
    planning_selection: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach a private render sidecar only after both P3 and P4 gates pass."""

    selected = deepcopy(selected_plans)
    audit: dict[str, Any] = {
        "contract_version": "liveclip_p4_timeline_packaging_v1",
        "status": "blocked",
        "render_consumed": False,
        "feature_flag": P4_ENABLED_ENV,
        "fallback_reason": "",
        "metrics": {},
        "by_clip": {},
        "warnings": [],
        "activation_requested": bool(p4_enabled() and p4_task_allowed(task_id)),
    }
    if not p4_enabled():
        audit["fallback_reason"] = "p4_activation_not_enabled"
        return selected, audit
    if not p4_task_allowed(task_id):
        audit["fallback_reason"] = "task_not_in_p4_canary"
        return selected, audit
    if not (
        planning_selection.get("selected_plan_source") == "verified"
        and planning_selection.get("render_consumed") is True
        and planning_selection.get("effective_policy") == "verified_render"
    ):
        audit["fallback_reason"] = "verified_plan_not_consumed"
        return selected, audit
    if transcript.get("status") != "completed" or not transcript.get("segments"):
        audit["fallback_reason"] = "completed_transcript_unavailable"
        return selected, audit

    contract = build_p4_timeline_packaging_contract(
        task_id,
        {
            "segments": selected,
            "transcript": deepcopy(transcript),
        },
    )
    audit.update(deepcopy(contract))
    audit["render_consumed"] = False
    if contract.get("status") != "ready":
        audit["fallback_reason"] = "p4_contract_not_ready"
        return selected, audit

    by_clip = contract.get("by_clip") or {}
    attached = 0
    for plan in selected:
        clip_id = str(plan.get("clip_id") or plan.get("slice_id") or "")
        packaging = by_clip.get(clip_id)
        if packaging is None:
            continue
        plan["_p4_packaging"] = deepcopy(packaging)
        attached += 1
    if attached != len(selected) or attached == 0:
        for plan in selected:
            plan.pop("_p4_packaging", None)
        audit["status"] = "blocked"
        audit["fallback_reason"] = "p4_clip_contract_incomplete"
        return selected, audit

    audit["status"] = "ready"
    audit["render_consumed"] = True
    audit["fallback_reason"] = ""
    audit["attached_clip_count"] = attached
    return selected, audit


def strip_p4_private_packaging(plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned = deepcopy(plans)
    for plan in cleaned:
        plan.pop("_p4_packaging", None)
    return cleaned


def p4_requires_baseline_fallback(
    audit: dict[str, Any], planning_selection: dict[str, Any]
) -> bool:
    return bool(
        audit.get("activation_requested")
        and planning_selection.get("selected_plan_source") == "verified"
        and not audit.get("render_consumed")
    )
