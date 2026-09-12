from __future__ import annotations

import os
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from backend.app.core.paths import PROJECT_ROOT

from backend.app.contracts.liveclip_planning_policy_contract import (
    LiveClipPlanningPolicy,
    LiveClipPlanningSelection,
)
from backend.app.services.liveclip_content_contract_adapter import (
    build_liveclip_content_contracts,
    evaluate_clip_level_shadow_acceptance,
)


FEATURE_FLAG = "LIVECLIP_VERIFIED_PLANNING_SIDECAR"
PLANNING_POLICY_ENV = "LIVECLIP_PLANNING_POLICY"
HUMAN_ACCEPTANCE_STATUS_ENV = "LIVECLIP_VERIFIED_PLANNING_ACCEPTANCE_STATUS"
VERIFIED_RENDER_ENABLED_ENV = "LIVECLIP_VERIFIED_RENDER_ENABLED"
VERIFIED_RENDER_CANARY_TASK_IDS_ENV = "LIVECLIP_VERIFIED_RENDER_CANARY_TASK_IDS"
ACCEPTANCE_MANIFEST_ENV = "LIVECLIP_VERIFIED_PLANNING_ACCEPTANCE_MANIFEST"
SCHEMA_VERSION = "1.0"


def sidecar_enabled() -> bool:
    return os.getenv(FEATURE_FLAG, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def resolve_planning_policy(value: str | None = None) -> LiveClipPlanningPolicy:
    raw = value
    if raw is None:
        raw = os.getenv(PLANNING_POLICY_ENV, "").strip()
    else:
        raw = str(raw).strip()
    if not raw:
        return (
            LiveClipPlanningPolicy.VERIFIED_SHADOW
            if sidecar_enabled()
            else LiveClipPlanningPolicy.BASELINE
        )
    try:
        return LiveClipPlanningPolicy(raw.lower())
    except ValueError:
        return LiveClipPlanningPolicy.BASELINE


def planning_policy_requests_sidecar(value: str | None = None) -> bool:
    return resolve_planning_policy(value) in {
        LiveClipPlanningPolicy.VERIFIED_SHADOW,
        LiveClipPlanningPolicy.VERIFIED_RENDER,
    }


def configured_human_acceptance_status() -> str:
    return (
        os.getenv(HUMAN_ACCEPTANCE_STATUS_ENV, "not_run").strip().lower()
        or "not_run"
    )


def verified_render_activation_enabled() -> bool:
    return os.getenv(VERIFIED_RENDER_ENABLED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def verified_render_task_allowed(task_id: str) -> bool:
    allowed = {
        value.strip()
        for value in os.getenv(VERIFIED_RENDER_CANARY_TASK_IDS_ENV, "").split(",")
        if value.strip()
    }
    return bool(task_id and task_id in allowed)


def load_accepted_plan_specs(
    source_task_id: str,
    manifest_path: str | Path | None = None,
) -> dict[str, Any]:
    raw_path = manifest_path or os.getenv(ACCEPTANCE_MANIFEST_ENV, "").strip()
    if not raw_path:
        return {"status": "blocked", "report_version": "", "plans": []}
    path = Path(raw_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"status": "blocked", "report_version": "", "plans": []}
    source = (payload.get("sources") or {}).get(str(source_task_id)) or {}
    plans = source.get("plans") or []
    valid_plans = [
        deepcopy(item)
        for item in plans
        if isinstance(item, dict)
        and str(item.get("pair_id") or "").strip()
        and float(item.get("end_seconds") or 0)
        > float(item.get("start_seconds") or 0)
    ]
    passed = (
        payload.get("status") == "passed"
        and source.get("status") == "passed"
        and len(valid_plans) == len(plans)
        and bool(valid_plans)
    )
    return {
        "status": "passed" if passed else "blocked",
        "report_version": str(payload.get("report_version") or ""),
        "manifest_path": str(path),
        "plans": valid_plans if passed else [],
    }


def select_render_planning(
    *,
    baseline_plans: list[dict[str, Any]],
    planning_sidecar: dict[str, Any] | None,
    requested_policy: str | LiveClipPlanningPolicy | None = None,
    human_acceptance_status: str | None = None,
) -> dict[str, Any]:
    raw_policy = (
        requested_policy.value
        if isinstance(requested_policy, LiveClipPlanningPolicy)
        else requested_policy
    )
    resolved_policy = resolve_planning_policy(raw_policy)
    invalid_policy = bool(raw_policy) and str(raw_policy).strip().lower() not in {
        item.value for item in LiveClipPlanningPolicy
    }
    acceptance_status = str(
        human_acceptance_status
        if human_acceptance_status is not None
        else configured_human_acceptance_status()
    ).strip().lower() or "not_run"

    fallback_reason = ""
    if invalid_policy:
        fallback_reason = "invalid_planning_policy"
    elif resolved_policy == LiveClipPlanningPolicy.VERIFIED_SHADOW:
        fallback_reason = "verified_shadow_never_renders"
    elif resolved_policy == LiveClipPlanningPolicy.VERIFIED_RENDER:
        verified_plans = (
            list((planning_sidecar or {}).get("verified_plans") or [])
            if (planning_sidecar or {}).get("status") == "verified"
            else []
        )
        accepted_render_plans = list(
            (planning_sidecar or {}).get("accepted_render_plans") or []
        )
        sidecar_task_id = str((planning_sidecar or {}).get("task_id") or "")
        sidecar_acceptance_status = str(
            ((planning_sidecar or {}).get("human_acceptance") or {}).get("status")
            or "not_run"
        ).strip().lower()
        if acceptance_status != "passed":
            fallback_reason = "p2_acceptance_not_passed"
        elif not verified_plans and not accepted_render_plans:
            fallback_reason = "verified_plans_unavailable"
        elif not verified_render_activation_enabled():
            fallback_reason = "p3_activation_not_enabled"
        elif not verified_render_task_allowed(sidecar_task_id):
            fallback_reason = "task_not_in_verified_render_canary"
        elif sidecar_acceptance_status != "passed" or not accepted_render_plans:
            fallback_reason = "accepted_verified_plans_unavailable"
        else:
            selection = LiveClipPlanningSelection(
                requested_policy=resolved_policy,
                effective_policy=LiveClipPlanningPolicy.VERIFIED_RENDER,
                selected_plan_source="verified",
                selected_plans=deepcopy(accepted_render_plans),
                human_acceptance_status=acceptance_status,
                fallback_reason="",
                render_consumed=True,
            )
            return selection.model_dump(mode="json")

    selection = LiveClipPlanningSelection(
        requested_policy=resolved_policy,
        effective_policy=LiveClipPlanningPolicy.BASELINE,
        selected_plan_source="baseline",
        selected_plans=deepcopy(baseline_plans),
        human_acceptance_status=acceptance_status,
        fallback_reason=fallback_reason,
        render_consumed=False,
    )
    return selection.model_dump(mode="json")


def build_verified_planning_sidecar(
    *,
    task_id: str,
    attempt_id: str,
    baseline_segments: list[dict[str, Any]],
    candidate_segments: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
    full_timeline_coverage_pct: float,
) -> dict[str, Any]:
    baseline_plans = [_plan_snapshot(item) for item in baseline_segments]
    candidate_plans = [_plan_snapshot(item) for item in candidate_segments]
    snapshot = build_liveclip_content_contracts(
        task_id,
        {
            "segments": deepcopy(candidate_segments),
            "transcript": {"segments": deepcopy(transcript_segments)},
        },
    )
    acceptance = evaluate_clip_level_shadow_acceptance(
        snapshot,
        full_timeline_coverage_pct=full_timeline_coverage_pct,
    )
    verified = acceptance["status"] == "passed"
    baseline_ids = {item["clip_id"] for item in baseline_plans}
    candidate_ids = {item["clip_id"] for item in candidate_plans}
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "verified" if verified else "rejected",
        "mode": "shadow",
        "task_id": task_id,
        "attempt_id": attempt_id,
        "render_consumed": False,
        "baseline_plans": baseline_plans,
        "candidate_plans": candidate_plans,
        "verified_plans": deepcopy(candidate_plans) if verified else [],
        "acceptance": acceptance,
        "comparison": {
            "baseline_count": len(baseline_plans),
            "candidate_count": len(candidate_plans),
            "shared_clip_ids": sorted(baseline_ids & candidate_ids),
            "baseline_only_clip_ids": sorted(baseline_ids - candidate_ids),
            "candidate_only_clip_ids": sorted(candidate_ids - baseline_ids),
        },
        "rollback": {
            "feature_flag": FEATURE_FLAG,
            "disable_value": "false",
            "behavior": "关闭后停止生成 sidecar，正式渲染始终继续使用 baseline_plans。",
        },
    }


def customer_safe_raw_result(result_json: dict[str, Any]) -> dict[str, Any]:
    safe = deepcopy(result_json)
    safe.pop("internal_sidecars", None)
    return safe


def build_boundary_blind_pair(
    *,
    pair_id: str,
    baseline: dict[str, Any],
    verified: dict[str, Any],
    verified_label: str,
    source_task_id: str,
    shadow_task_id: str,
    verified_clip_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if verified_label not in {"A", "B"}:
        raise ValueError("verified_label must be A or B")
    baseline_label = "B" if verified_label == "A" else "A"
    source_group = int(pair_id.split("-", 1)[0])
    packet_pair = {
        "pair_id": pair_id,
        "source_group": source_group,
        baseline_label: deepcopy(baseline),
        verified_label: deepcopy(verified),
    }
    key = {
        baseline_label: "baseline",
        verified_label: "verified",
        "source_task_id": source_task_id,
        "shadow_task_id": shadow_task_id,
        "verified_clip_id": verified_clip_id,
    }
    return packet_pair, key


def _plan_snapshot(segment: dict[str, Any]) -> dict[str, Any]:
    start = float(segment.get("start_seconds") or segment.get("start") or 0)
    end = float(segment.get("end_seconds") or segment.get("end") or start)
    return {
        "clip_id": str(segment.get("clip_id") or segment.get("slice_id") or ""),
        "title": str(
            segment.get("suggested_title")
            or segment.get("title")
            or segment.get("highlight_label")
            or ""
        ),
        "start_seconds": start,
        "end_seconds": end,
        "duration_seconds": float(
            segment.get("duration_seconds") or max(0.0, end - start)
        ),
        "ranges": deepcopy(
            segment.get("ranges")
            or ([{"start": start, "end": end}] if end > start else [])
        ),
        "selling_points": deepcopy(segment.get("selling_points") or []),
        "selling_point_source_segment_ids": deepcopy(
            segment.get("selling_point_source_segment_ids") or []
        ),
        "proof_shot": str(segment.get("proof_shot") or ""),
        "proof_shot_verified": bool(segment.get("proof_shot_verified", False)),
        "boundary_adjustment": deepcopy(segment.get("boundary_adjustment") or {}),
        "score": float(
            segment.get("planning_score") or segment.get("total_score") or 0
        ),
    }
