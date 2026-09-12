from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


QA_STATUS_VALUES = ("pending", "running", "passed", "failed", "blocked")

QA_CHECK_KEYS = [
    "video_playable",
    "duration_under_60s",
    "has_hook_first_3s",
    "subtitle_readable",
    "audio_present",
    "no_black_screen",
    "subject_visible",
    "aspect_ratio_correct",
    "title_under_40_chars",
    "has_cta",
    "keyword_in_title_or_caption",
    "final_video_exists",
    "srt_exists",
    "cover_exists",
    "clip_report_exists",
    "trace_exists",
    "jianying_project_exists",
    "jianying_manifest_exists",
    "jianying_timeline_exists",
    "jianying_zip_exists",
]

CRITICAL_QA_CHECKS = [
    "video_playable",
    "duration_under_60s",
    "audio_present",
    "no_black_screen",
    "aspect_ratio_correct",
    "final_video_exists",
    "srt_exists",
    "trace_exists",
]

QA_FAILURE_OWNER = {
    "video_playable": ("LiveClipRenderAgent", "basic_ffmpeg"),
    "duration_under_60s": ("LiveClipSegmentPlannerAgent", "liveclip_slice_skill"),
    "has_hook_first_3s": ("LiveClipHotspotAgent", "viral_hook_score_skill"),
    "subtitle_readable": ("LiveClipCaptionAgent", "flycut_caption"),
    "audio_present": ("LiveClipRenderAgent", "basic_ffmpeg"),
    "no_black_screen": ("LiveClipRenderAgent", "basic_ffmpeg"),
    "subject_visible": ("LiveClipReframeAgent", "vertical_reframe_skill"),
    "aspect_ratio_correct": ("LiveClipReframeAgent", "vertical_reframe_skill"),
    "title_under_40_chars": ("LiveClipCopyAgent", "short_title_skill"),
    "has_cta": ("LiveClipCopyAgent", "short_caption_skill"),
    "keyword_in_title_or_caption": ("LiveClipCopyAgent", "keyword_caption_skill"),
    "final_video_exists": ("LiveClipRenderAgent", "basic_ffmpeg"),
    "srt_exists": ("LiveClipCaptionAgent", "flycut_caption"),
    "cover_exists": ("LiveClipCoverAgent", "cover_extract_skill"),
    "clip_report_exists": ("LiveClipReportAgent", "clip_report_skill"),
    "trace_exists": ("LiveClipTraceAgent", "trace_export_skill"),
    "jianying_project_exists": ("JianyingProjectExportAgent", "jianying_project_export_skill"),
    "jianying_manifest_exists": ("JianyingProjectExportAgent", "jianying_project_export_skill"),
    "jianying_timeline_exists": ("JianyingProjectExportAgent", "jianying_project_export_skill"),
    "jianying_zip_exists": ("JianyingProjectExportAgent", "jianying_project_export_skill"),
}

QA_REPAIR_GUIDANCE = {
    "subtitle_readable": ("subtitle", "regenerate_subtitle", "packaging_only"),
    "srt_exists": ("subtitle", "regenerate_subtitle", "packaging_only"),
    "flower_text_collision": (
        "flower_text",
        "regenerate_flower_text",
        "packaging_only",
    ),
    "clip_boundary_incomplete": ("clip", "recut_segment", "clip_only"),
    "duration_under_60s": ("clip", "recut_segment", "clip_only"),
    "has_hook_first_3s": ("clip", "recut_segment", "clip_only"),
}

QA_FIELD_STANDARD: dict[str, Any] = {
    "qa_status": "pending",
    "qa_score": 0,
    "qa_pass": False,
    "qa_checks": {key: False for key in QA_CHECK_KEYS},
    "qa_failed_items": [],
    "qa_warnings": [],
    "qa_retry_required": False,
    "qa_failure_owner_agent": None,
    "qa_failure_owner_skill": None,
    "qa_failure_reason": None,
    "qa_issues": [],
    "qa_checked_at": None,
}


def default_qa_checks(value: bool = False) -> dict[str, bool]:
    return {key: bool(value) for key in QA_CHECK_KEYS}


def default_qa_result(status: str = "pending") -> dict[str, Any]:
    payload = dict(QA_FIELD_STANDARD)
    payload["qa_checks"] = default_qa_checks(False)
    payload["qa_status"] = status if status in QA_STATUS_VALUES else "pending"
    return payload


def build_qa_result(
    checks: dict[str, bool] | None = None,
    *,
    warnings: list[str] | None = None,
    checked_at: str | None = None,
    force_status: str | None = None,
) -> dict[str, Any]:
    qa_checks = default_qa_checks(False)
    qa_checks.update({key: bool(value) for key, value in (checks or {}).items() if key in qa_checks})
    failed_items = [key for key in QA_CHECK_KEYS if not qa_checks.get(key)]
    critical_failed = [key for key in CRITICAL_QA_CHECKS if not qa_checks.get(key)]
    passed_count = len(QA_CHECK_KEYS) - len(failed_items)
    qa_score = round((passed_count / len(QA_CHECK_KEYS)) * 100)

    if force_status in QA_STATUS_VALUES:
        qa_status = force_status
    elif not any(qa_checks.values()):
        qa_status = "blocked"
    elif critical_failed:
        qa_status = "failed"
    else:
        qa_status = "passed"

    owner_agent = None
    owner_skill = None
    failure_reason = None
    if failed_items:
        owner_agent, owner_skill = QA_FAILURE_OWNER.get(failed_items[0], ("LiveClipQAAgent", "clip_quality_check_skill"))
        failure_reason = f"{failed_items[0]} 未通过"

    return {
        "qa_status": qa_status,
        "qa_score": qa_score,
        "qa_pass": qa_status == "passed",
        "qa_checks": qa_checks,
        "qa_failed_items": failed_items,
        "qa_warnings": list(dict.fromkeys(warnings or [])),
        "qa_retry_required": qa_status in {"failed", "blocked"},
        "qa_failure_owner_agent": owner_agent,
        "qa_failure_owner_skill": owner_skill,
        "qa_failure_reason": failure_reason,
        "qa_issues": [build_qa_issue(item) for item in failed_items],
        "qa_checked_at": checked_at or datetime.now(timezone.utc).isoformat(),
    }


def build_qa_issue(
    check_key: str,
    *,
    clip_id: str = "",
    final_time_range: dict[str, float] | None = None,
) -> dict[str, Any]:
    owner_agent, owner_skill = QA_FAILURE_OWNER.get(
        check_key, ("LiveClipQAAgent", "clip_quality_check_skill")
    )
    target_asset, suggested_action, rerun_scope = QA_REPAIR_GUIDANCE.get(
        check_key, ("packaging", "rerender_packaging", "packaging_only")
    )
    return {
        "issue_id": f"qa::{clip_id or 'task'}::{check_key}",
        "check_key": check_key,
        "clip_id": clip_id,
        "responsible_module": owner_agent,
        "responsible_skill": owner_skill,
        "target_asset": target_asset,
        "suggested_action": suggested_action,
        "rerun_scope": rerun_scope,
        "final_time_range": dict(final_time_range or {"start": 0.0, "end": 0.001}),
        "reason": f"{check_key} 未通过",
    }


def aggregate_qa_results(items: list[dict[str, Any]], *, warnings: list[str] | None = None) -> dict[str, Any]:
    if not items:
        return build_qa_result({}, warnings=warnings, force_status="blocked")
    merged_checks = default_qa_checks(True)
    for item in items:
        checks = item.get("qa_checks") or {}
        for key in QA_CHECK_KEYS:
            merged_checks[key] = bool(merged_checks[key] and checks.get(key))
    merged_warnings: list[str] = list(warnings or [])
    for item in items:
        merged_warnings.extend(item.get("qa_warnings") or [])
    return build_qa_result(merged_checks, warnings=merged_warnings)
