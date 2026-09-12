from __future__ import annotations

from typing import Any

from backend.app.contracts.edit_plan_contract import EditPlan, EditPlanClip, PackagingPlan
from backend.app.schemas.live_clip_qa import QA_CHECK_KEYS


def normalize_edit_plan(job_id: str, result_json: dict[str, Any]) -> EditPlan:
    source_video = result_json.get("source_video") or {}
    segments = result_json.get("segments") or result_json.get("slice_segments") or []
    clips: list[EditPlanClip] = []
    final_cursor = 0.0
    for item in segments:
        duration = float(item.get("duration_seconds") or item.get("duration") or 0)
        source_start = float(item.get("start_seconds") or 0)
        source_end = float(item.get("end_seconds") or source_start + duration)
        flycut = item.get("flycut_caption") or {}
        files = item.get("files") or {}
        selling_points = item.get("selling_points") or []
        clips.append(
            EditPlanClip(
                clip_id=str(item.get("clip_id") or item.get("slice_id") or ""),
                source_video=source_video,
                source_start=source_start,
                source_end=source_end,
                final_start=final_cursor,
                final_end=final_cursor + duration,
                hook_type=str(item.get("highlight_label") or item.get("segment_type") or "unknown"),
                segment_reason=str(item.get("reason") or item.get("summary") or ""),
                product_selling_point=" / ".join(str(value) for value in selling_points) if isinstance(selling_points, list) else str(selling_points or ""),
                proof_shot=str(
                    item.get("proof_shot")
                    or item.get("transcript_excerpt")
                    or item.get("text")
                    or ""
                ),
                proof_shot_verified=bool(
                    item.get("proof_shot_verified", False)
                ),
                subtitle_plan={
                    "subtitle": files.get("subtitle") or "",
                    "ass_subtitle": files.get("ass_subtitle") or "",
                    "readable": bool((item.get("qa_result") or item.get("qa") or {}).get("qa_checks", {}).get("subtitle_readable")),
                },
                flower_text_plan={
                    "style_json": files.get("caption_style_json") or "",
                    "effect_points_json": files.get("caption_effect_points_json") or "",
                    "highlight_keywords": flycut.get("highlight_keywords") or [],
                },
                sfx_cues=flycut.get("audio_cues") or [],
                transition_plan={
                    "type": "cut",
                    "source_ranges": item.get("ranges") or item.get("source_ranges") or [],
                },
                qa_rules=list(QA_CHECK_KEYS),
                platform_hint=item.get("platform_tags") or item.get("recommended_platforms") or [],
            )
        )
        final_cursor += duration
    return EditPlan(
        plan_id=f"{job_id}_edit_plan",
        job_id=job_id,
        source_video=source_video,
        clips=clips,
    )


def normalize_packaging_plan(job_id: str, result_json: dict[str, Any]) -> PackagingPlan:
    segments = result_json.get("segments") or result_json.get("slice_segments") or []
    first = segments[0] if segments else {}
    first_distribution = first.get("distribution") or {}
    title_candidates: list[str] = []
    platform_copywriting: dict[str, str] = {}
    audio_sfx_cues: list[dict[str, Any]] = []
    visual_guide_cues: list[dict[str, Any]] = []
    for item in segments:
        distribution = item.get("distribution") or {}
        for key in ["douyin_title", "kuaishou_title", "shipinhao_title", "xiaohongshu_title"]:
            if distribution.get(key):
                title_candidates.append(str(distribution[key]))
        if item.get("suggested_title"):
            title_candidates.append(str(item["suggested_title"]))
        if distribution.get("video_caption"):
            platform_copywriting[str(item.get("clip_id") or item.get("slice_id") or len(platform_copywriting) + 1)] = str(distribution["video_caption"])
        flycut = item.get("flycut_caption") or {}
        audio_sfx_cues.extend(flycut.get("audio_cues") or [])
        visual_guide_cues.append(
            {
                "clip_id": item.get("clip_id") or item.get("slice_id") or "",
                "cover": (item.get("files") or {}).get("cover") or "",
                "cover_text": distribution.get("cover_text") or "",
            }
        )
    return PackagingPlan(
        plan_id=f"{job_id}_packaging_plan",
        job_id=job_id,
        subtitle_style={"source": "liveclip_template", "safe_area": "mobile_bottom_safe"},
        flower_text_style={"source": "flycut_caption", "mode": "highlight_keywords"},
        audio_sfx_cues=audio_sfx_cues,
        transition_cues=[{"type": "cut", "scope": "between_clips"}],
        visual_guide_cues=visual_guide_cues,
        cover_text=str(first_distribution.get("cover_text") or ""),
        title_candidates=list(dict.fromkeys(title_candidates)),
        platform_copywriting=platform_copywriting,
    )
