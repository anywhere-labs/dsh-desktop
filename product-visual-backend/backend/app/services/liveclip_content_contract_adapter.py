from __future__ import annotations

import math
import re
from copy import deepcopy
from typing import Any

from backend.app.contracts.clip_boundary_contract import ClipBoundaryAssessment
from backend.app.contracts.liveclip_content_contract import (
    LiveClipContentContractSnapshot,
)
from backend.app.contracts.motion_intent_contract import MotionIntent
from backend.app.contracts.semantic_segment_contract import SemanticSegment
from backend.app.contracts.selling_point_evidence_contract import (
    EvidenceSourceRange,
    SellingPointEvidence,
)
from backend.app.contracts.timeline_mapping_contract import TimelineMapping


HOOK_MARKERS = ("为什么", "先看", "重点", "别急", "一定要看", "注意")
SELLING_POINT_MARKERS = (
    "面料",
    "材质",
    "真丝",
    "缎面",
    "光泽",
    "版型",
    "显瘦",
    "显高",
    "高腰",
    "收腰",
    "宽松",
    "领口",
    "透气",
    "轻透",
    "舒服",
    "刺绣",
    "上身",
    "细节",
    "功能",
    "自动",
    "只需要",
    "直接帮",
    "能够帮",
    "解决",
    "提升",
    "降低",
    "节省",
    "不占位置",
    "包邮",
    "到手价",
    "福利",
    "优惠",
    "起步价",
    "自研",
    "全栈",
    "体验",
)
CTA_MARKERS = ("点击", "下单", "购买", "评论", "关注", "收藏", "加购")
METRIC_PATTERN = re.compile(r"(?:\d+(?:\.\d+)?\s*(?:%|％|元|块|折|倍))")
LEADING_CONTEXT_MARKERS = (
    "而且",
    "但是",
    "所以",
    "所以说",
    "然后",
    "因此",
    "另外",
    "再加上",
    "同时",
    "这就",
    "这也",
    "这些",
    "这样",
    "它也",
    "他也",
    "她也",
    "都超过",
    "又",
    "做的",
    "站做到极致",
    "机构抢着",
    "打火机反复调",
    "对的",
    "不会",
)
TRAILING_INCOMPLETE_MARKERS = (
    "因为",
    "所以",
    "但是",
    "而且",
    "然后",
    "比如",
    "包括",
    "就是",
    "才是",
    "大疆是",
    "一个",
    "一种",
    "这个",
    "的",
    "当时很多",
)
IDLE_MARKERS = (
    "欢迎",
    "点关注",
    "亮灯牌",
    "投个票",
    "打在公屏",
    "福袋",
    "小黄车",
    "不要着急",
    "主播",
    "开播",
)


def assess_clip_boundary(
    candidate: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
    *,
    max_idle_ratio: float = 0.4,
) -> ClipBoundaryAssessment:
    """Assess candidate boundaries using transcript sentence intervals only."""

    start = _finite_float(candidate.get("start_seconds") or candidate.get("start"))
    end = _finite_float(candidate.get("end_seconds") or candidate.get("end"))
    if start is None:
        start = 0.0
    if end is None:
        end = start
    ordered = transcript_sentence_units(transcript_segments)
    included = [
        item
        for item in ordered
        if _overlaps(start, end, float(item["start"]), float(item["end"]))
    ]
    if not included:
        return ClipBoundaryAssessment(
            leading_complete=False,
            trailing_complete=False,
            context_complete=False,
            idle_ratio=0,
            failure_codes=[
                "leading_context_missing",
                "trailing_sentence_incomplete",
            ],
        )

    first = included[0]
    last = included[-1]
    first_index = ordered.index(first)
    last_index = ordered.index(last)
    first_text = _boundary_text(first.get("text"))
    last_text = _boundary_text(last.get("text"))
    has_previous = first_index > 0
    has_next = last_index < len(ordered) - 1
    leading_complete = not (
        has_previous
        and _leading_requires_context(str(first.get("text") or ""), first_text)
    )
    trailing_complete = not (
        has_next and _trailing_requires_context(str(last.get("text") or ""), last_text)
    )

    total_duration = sum(
        max(0.0, min(end, float(item["end"])) - max(start, float(item["start"])))
        for item in included
    )
    idle_duration = sum(
        max(0.0, min(end, float(item["end"])) - max(start, float(item["start"])))
        for item in included
        if _is_idle_text(str(item.get("text") or ""))
    )
    idle_ratio = round(idle_duration / total_duration, 4) if total_duration else 0.0

    failure_codes: list[str] = []
    if not leading_complete:
        failure_codes.append("leading_context_missing")
    if not trailing_complete:
        failure_codes.append("trailing_sentence_incomplete")
    if idle_ratio > max_idle_ratio:
        failure_codes.append("idle_ratio_exceeded")
    return ClipBoundaryAssessment(
        leading_complete=leading_complete,
        trailing_complete=trailing_complete,
        context_complete=not failure_codes,
        idle_ratio=idle_ratio,
        failure_codes=failure_codes,
    )


def _boundary_text(value: Any) -> str:
    text = str(value or "").strip()
    return re.sub(r"^[\s🎼😊🤢，。！？、；：,.!?;:]+|[\s🎼😊🤢，。！？、；：,.!?;:]+$", "", text)


def _trailing_requires_context(raw_text: str, normalized_text: str) -> bool:
    raw = re.sub(r"[\s🎼😊🤢]+$", "", raw_text)
    if raw.endswith(("，", ",", "：", ":")):
        return True
    return any(
        normalized_text.endswith(marker) for marker in TRAILING_INCOMPLETE_MARKERS
    )


def _leading_requires_context(raw_text: str, normalized_text: str) -> bool:
    raw = re.sub(r"^[\s🎼😊🤢]+", "", raw_text)
    if raw.startswith(("，", ",", "：", ":")):
        return True
    return any(
        normalized_text.startswith(marker) for marker in LEADING_CONTEXT_MARKERS
    )


def _is_idle_text(text: str) -> bool:
    return any(marker in text for marker in IDLE_MARKERS)


def transcript_sentence_units(
    transcript_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Split coarse ASR blocks at punctuation and estimate sentence times.

    These estimates are shadow-planning evidence only. They must not be used by
    formal rendering before the later TimelineMapping acceptance stage.
    """

    output: list[dict[str, Any]] = []
    ordered = sorted(
        (
            item
            for item in transcript_segments
            if isinstance(item, dict)
            and _finite_float(item.get("start")) is not None
            and _finite_float(item.get("end")) is not None
            and str(item.get("text") or "").strip()
        ),
        key=lambda item: (float(item["start"]), float(item["end"])),
    )
    for item in ordered:
        if item.get("sentence_boundary_source"):
            output.append(deepcopy(item))
            continue
        text = str(item.get("text") or "").strip()
        parts = [
            part.strip()
            for part in re.findall(r".*?(?:[。！？!?；;]+|$)", text)
            if part.strip() and _boundary_text(part)
        ]
        if not parts:
            if not _boundary_text(text):
                continue
            parts = [text]
        start = float(item["start"])
        end = float(item["end"])
        duration = end - start
        weights = [max(1, len(_boundary_text(part))) for part in parts]
        total_weight = sum(weights)
        cursor = start
        source_segment_id = str(item.get("segment_id") or "")
        for index, (part, weight) in enumerate(zip(parts, weights), start=1):
            sentence_end = (
                end
                if index == len(parts)
                else start + duration * sum(weights[:index]) / total_weight
            )
            unit = deepcopy(item)
            unit.update(
                {
                    "segment_id": f"{source_segment_id}::sentence_{index:03d}",
                    "source_segment_id": source_segment_id,
                    "start": round(cursor, 3),
                    "end": round(sentence_end, 3),
                    "duration": round(max(0.0, sentence_end - cursor), 3),
                    "text": part,
                    "sentence_boundary_source": (
                        "transcript_segment"
                        if len(parts) == 1
                        else "punctuation_proportional_estimate"
                    ),
                }
            )
            output.append(unit)
            cursor = sentence_end
    return output


def build_liveclip_content_contracts(
    job_id: str,
    result_json: dict[str, Any],
) -> LiveClipContentContractSnapshot:
    clips = _clips(result_json)
    transcript_segments = _transcript_segments(result_json, clips)
    mappings = _build_timeline_mappings(clips, transcript_segments)
    semantic_segments = _build_semantic_segments(transcript_segments, mappings)
    evidence = _build_selling_point_evidence(clips, transcript_segments, mappings)
    semantic_segments = _attach_evidence_refs(semantic_segments, evidence)
    motion_intents = _build_motion_intents(
        clips,
        transcript_segments,
        mappings,
        evidence,
    )
    return LiveClipContentContractSnapshot(
        job_id=job_id,
        semantic_segments=semantic_segments,
        selling_point_evidence=evidence,
        motion_intents=motion_intents,
        timeline_mappings=mappings,
    )


def build_p4_timeline_packaging_contract(
    job_id: str,
    result_json: dict[str, Any],
) -> dict[str, Any]:
    """Build the render-safe P4 timeline/packaging sidecar.

    The sidecar is deliberately stricter than the observation contracts: only
    motion intents that have both traceable evidence and a final-timeline
    mapping are allowed to reach packaging.  Nothing here mutates the input or
    changes the baseline edit plan.
    """

    snapshot = build_liveclip_content_contracts(job_id, result_json)
    mappings_by_clip: dict[str, list[TimelineMapping]] = {}
    for mapping in snapshot.timeline_mappings:
        mappings_by_clip.setdefault(mapping.clip_id, []).append(mapping)

    intents_by_clip: dict[str, list[MotionIntent]] = {}
    for intent in snapshot.motion_intents:
        intents_by_clip.setdefault(intent.clip_id, []).append(intent)

    semantic_by_id = {
        segment.segment_id: segment for segment in snapshot.semantic_segments
    }
    by_clip: dict[str, dict[str, Any]] = {}
    duration_checks = 0
    duration_passes = 0
    continuity_checks = 0
    continuity_passes = 0
    all_warnings: list[str] = []

    for clip_id, raw_mappings in mappings_by_clip.items():
        mappings = sorted(raw_mappings, key=lambda item: item.range_index)
        warnings: list[str] = []
        duration_ok = all(
            abs(
                (mapping.source_end - mapping.source_start)
                - (mapping.final_end - mapping.final_start)
            )
            <= 0.001
            for mapping in mappings
        )
        continuity_ok = bool(mappings) and abs(mappings[0].final_start) <= 0.001
        continuity_ok = continuity_ok and all(
            abs(mappings[index].final_start - mappings[index - 1].final_end)
            <= 0.001
            for index in range(1, len(mappings))
        )
        duration_checks += 1
        continuity_checks += 1
        duration_passes += int(duration_ok)
        continuity_passes += int(continuity_ok)
        if not duration_ok:
            warnings.append(f"{clip_id} 的源片与成片时长映射不守恒，已阻止包装消费。")
        if not continuity_ok:
            warnings.append(f"{clip_id} 的成片时间轴不连续，已阻止包装消费。")

        render_intents: list[dict[str, Any]] = []
        for intent in intents_by_clip.get(clip_id, []):
            reason = ""
            if not intent.evidence_ids:
                reason = "缺少卖点证据"
            elif (
                intent.mapping_status != "mapped"
                or intent.final_start is None
                or intent.final_end is None
            ):
                reason = "无法映射到成片时间轴"
            elif not duration_ok or not continuity_ok:
                reason = "时间轴合同未通过"
            mapping = next(
                (
                    item
                    for item in mappings
                    if item.source_start <= intent.source_start < item.source_end
                ),
                None,
            )
            if mapping is None and not reason:
                reason = "找不到对应的源片区间"
            if reason:
                warnings.append(
                    f"动效“{intent.primary_text}”{reason}，未进入正式包装。"
                )
                continue
            rendered = intent.model_dump(mode="json")
            rendered["timeline_mapping_id"] = mapping.mapping_id
            render_intents.append(rendered)

        final_transcript_segments: list[dict[str, Any]] = []
        for mapping in mappings:
            for segment_id in mapping.source_segment_ids:
                segment = semantic_by_id.get(segment_id)
                if segment is None:
                    continue
                source_start = max(segment.source_start, mapping.source_start)
                source_end = min(segment.source_end, mapping.source_end)
                if source_end <= source_start:
                    continue
                final_transcript_segments.append(
                    {
                        "segment_id": segment.segment_id,
                        "start": round(
                            mapping.final_start + source_start - mapping.source_start,
                            3,
                        ),
                        "end": round(
                            mapping.final_start + source_end - mapping.source_start,
                            3,
                        ),
                        "text": segment.text,
                        "timeline_mapping_id": mapping.mapping_id,
                    }
                )

        warning_values = list(dict.fromkeys(warnings))
        all_warnings.extend(warning_values)
        by_clip[clip_id] = {
            "timeline_mappings": [
                item.model_dump(mode="json") for item in mappings
            ],
            "final_transcript_segments": sorted(
                final_transcript_segments, key=lambda item: (item["start"], item["end"])
            ),
            "render_motion_intents": sorted(
                render_intents,
                key=lambda item: (item["final_start"], item["final_end"]),
            ),
            "warnings": warning_values,
        }

    duration_pct = _percentage(duration_passes, duration_checks)
    continuity_pct = _percentage(continuity_passes, continuity_checks)
    return {
        "contract_version": "liveclip_p4_timeline_packaging_v1",
        "job_id": job_id,
        "status": (
            "ready"
            if by_clip and duration_pct == 100.0 and continuity_pct == 100.0
            else "blocked"
        ),
        "metrics": {
            "duration_conservation_pct": duration_pct,
            "timeline_continuity_pct": continuity_pct,
        },
        "by_clip": by_clip,
        "warnings": list(dict.fromkeys(all_warnings)),
    }


def evaluate_clip_level_shadow_acceptance(
    snapshot: LiveClipContentContractSnapshot,
    *,
    full_timeline_coverage_pct: float,
) -> dict[str, Any]:
    clip_ids = list(
        dict.fromkeys(mapping.clip_id for mapping in snapshot.timeline_mappings)
    )
    verified_by_clip = {
        clip_id: sum(
            item.verified and item.clip_id == clip_id
            for item in snapshot.selling_point_evidence
        )
        for clip_id in clip_ids
    }
    clips_with_evidence = sum(value > 0 for value in verified_by_clip.values())
    evidence_count = len(snapshot.selling_point_evidence)
    verified_count = sum(item.verified for item in snapshot.selling_point_evidence)
    motion_count = len(snapshot.motion_intents)
    mapped_motion_count = sum(
        item.mapping_status == "mapped" for item in snapshot.motion_intents
    )
    anchored_motion_count = sum(
        bool(item.source_segment_id) for item in snapshot.motion_intents
    )

    mappings_by_clip: dict[str, list[TimelineMapping]] = {}
    for mapping in snapshot.timeline_mappings:
        mappings_by_clip.setdefault(mapping.clip_id, []).append(mapping)
    timeline_accurate = bool(mappings_by_clip)
    for mappings in mappings_by_clip.values():
        ordered = sorted(mappings, key=lambda item: item.range_index)
        duration_exact = all(
            abs(
                (item.source_end - item.source_start)
                - (item.final_end - item.final_start)
            )
            <= 0.001
            for item in ordered
        )
        contiguous = bool(ordered) and abs(ordered[0].final_start) <= 0.001
        contiguous = contiguous and all(
            abs(ordered[index].final_start - ordered[index - 1].final_end)
            <= 0.001
            for index in range(1, len(ordered))
        )
        timeline_accurate = timeline_accurate and duration_exact and contiguous

    mapped_segment_ids = {
        segment_id
        for mapping in snapshot.timeline_mappings
        for segment_id in mapping.source_segment_ids
    }
    semantic_by_id = {
        segment.segment_id: segment for segment in snapshot.semantic_segments
    }
    meaningful_count = sum(
        any(kind != "other" for kind in semantic_by_id[segment_id].semantic_types)
        for segment_id in mapped_segment_ids
        if segment_id in semantic_by_id
    )

    clip_evidence_pct = _percentage(clips_with_evidence, len(clip_ids))
    evidence_pct = _percentage(verified_count, evidence_count)
    motion_mapping_pct = _percentage(mapped_motion_count, motion_count)
    motion_anchor_pct = _percentage(anchored_motion_count, motion_count)
    semantic_observation_pct = _percentage(
        meaningful_count, len(mapped_segment_ids)
    )
    timeline_pct = 100.0 if timeline_accurate else 0.0

    failed_gates: list[str] = []
    if full_timeline_coverage_pct < 100:
        failed_gates.append("full_timeline_coverage")
    if clip_evidence_pct < 100:
        failed_gates.append("clip_evidence_coverage")
    if evidence_pct < 100:
        failed_gates.append("evidence_traceability")
    if motion_mapping_pct < 100 or motion_anchor_pct < 100:
        failed_gates.append("motion_mapping")
    if timeline_pct < 100:
        failed_gates.append("timeline_accuracy")

    next_action = ""
    if "clip_evidence_coverage" in failed_gates:
        next_action = "请确保每条候选成片至少包含一条可回指真实口播的卖点。"
    elif "full_timeline_coverage" in failed_gates:
        next_action = "请先补齐完整 transcript 的候选覆盖。"
    elif "evidence_traceability" in failed_gates:
        next_action = "请补齐卖点对应的 transcript segment id。"
    elif "motion_mapping" in failed_gates:
        next_action = "请将每条卖点动效锚定到真实口播时间段。"
    elif "timeline_accuracy" in failed_gates:
        next_action = "请修正源片到成片时间映射后重新验收。"

    return {
        "status": "passed" if not failed_gates else "blocked",
        "full_timeline_coverage_pct": float(full_timeline_coverage_pct),
        "clips_count": len(clip_ids),
        "clips_with_traceable_evidence": clips_with_evidence,
        "clip_evidence_coverage_pct": clip_evidence_pct,
        "evidence_traceability_pct": evidence_pct,
        "motion_coordinate_mapping_pct": motion_mapping_pct,
        "motion_direct_anchor_pct": motion_anchor_pct,
        "timeline_accuracy_pct": timeline_pct,
        "semantic_observation_pct": semantic_observation_pct,
        "failed_gates": failed_gates,
        "next_action": next_action,
    }


def _percentage(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator * 100 / denominator, 2)


def _clips(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    value = result_json.get("segments") or result_json.get("slice_segments") or []
    return [item for item in value if isinstance(item, dict)]


def _transcript_segments(
    result_json: dict[str, Any],
    clips: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    transcript = result_json.get("transcript") or {}
    raw = transcript.get("segments") if isinstance(transcript, dict) else None
    raw = raw or result_json.get("transcript_segments") or []
    if not raw:
        raw = [
            item
            for clip in clips
            for item in (clip.get("transcript_segments") or [])
            if isinstance(item, dict)
        ]

    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, float, float, str]] = set()
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        start = _finite_float(item.get("start"))
        end = _finite_float(item.get("end"))
        text = str(item.get("text") or "").strip()
        if start is None or end is None or start < 0 or end <= start or not text:
            continue
        segment_id = str(item.get("segment_id") or f"seg_{index:04d}")
        identity = (segment_id, start, end, text)
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(
            {
                **item,
                "segment_id": segment_id,
                "start": start,
                "end": end,
                "text": text,
            }
        )
    return sorted(normalized, key=lambda item: (item["start"], item["end"]))


def _build_timeline_mappings(
    clips: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
) -> list[TimelineMapping]:
    mappings: list[TimelineMapping] = []
    for clip_index, clip in enumerate(clips, start=1):
        clip_id = str(clip.get("clip_id") or clip.get("slice_id") or f"clip_{clip_index:03d}")
        ranges = _clip_ranges(clip)
        final_cursor = 0.0
        for range_index, item in enumerate(ranges):
            source_start = item["start"]
            source_end = item["end"]
            duration = source_end - source_start
            segment_ids = [
                str(segment["segment_id"])
                for segment in transcript_segments
                if _overlaps(
                    source_start,
                    source_end,
                    float(segment["start"]),
                    float(segment["end"]),
                )
            ]
            mappings.append(
                TimelineMapping(
                    mapping_id=f"mapping::{clip_id}::{range_index:03d}",
                    clip_id=clip_id,
                    range_index=range_index,
                    source_start=source_start,
                    source_end=source_end,
                    final_start=round(final_cursor, 3),
                    final_end=round(final_cursor + duration, 3),
                    source_segment_ids=segment_ids,
                )
            )
            final_cursor += duration
    return mappings


def _clip_ranges(clip: dict[str, Any]) -> list[dict[str, float]]:
    raw_ranges = clip.get("ranges") or clip.get("source_ranges") or []
    ranges: list[dict[str, float]] = []
    for item in raw_ranges:
        if not isinstance(item, dict):
            continue
        start = _finite_float(item.get("start"))
        end = _finite_float(item.get("end"))
        if start is None or end is None or start < 0 or end <= start:
            continue
        ranges.append({"start": start, "end": end})
    if ranges:
        return ranges

    start = _finite_float(clip.get("start_seconds"))
    end = _finite_float(clip.get("end_seconds"))
    if start is None:
        start = 0.0
    if end is None:
        duration = _finite_float(clip.get("duration_seconds") or clip.get("duration"))
        end = start + duration if duration is not None else None
    if start >= 0 and end is not None and end > start:
        return [{"start": start, "end": end}]
    return []


def _build_semantic_segments(
    transcript_segments: list[dict[str, Any]],
    mappings: list[TimelineMapping],
) -> list[SemanticSegment]:
    output: list[SemanticSegment] = []
    for item in transcript_segments:
        text = str(item["text"])
        tags = {str(tag) for tag in (item.get("emphasis_tags") or [])}
        semantic_types: list[str] = []
        if item.get("hook_candidate") or any(marker in text for marker in HOOK_MARKERS):
            semantic_types.append("hook")
        if tags.intersection({"detail", "benefit"}) or any(
            marker in text for marker in SELLING_POINT_MARKERS
        ):
            semantic_types.append("selling_point")
        if METRIC_PATTERN.search(text):
            semantic_types.append("metric")
        if any(marker in text for marker in CTA_MARKERS):
            semantic_types.append("cta")
        if not semantic_types:
            semantic_types.append("other")
        importance = 0.4
        if "hook" in semantic_types:
            importance = 1.0
        elif "selling_point" in semantic_types:
            importance = 0.8
        elif "metric" in semantic_types or "cta" in semantic_types:
            importance = 0.7
        keywords = _semantic_keywords(text)
        clip_ids = list(
            dict.fromkeys(
                mapping.clip_id
                for mapping in mappings
                if _overlaps(
                    float(item["start"]),
                    float(item["end"]),
                    mapping.source_start,
                    mapping.source_end,
                )
            )
        )
        output.append(
            SemanticSegment(
                segment_id=str(item["segment_id"]),
                source_start=float(item["start"]),
                source_end=float(item["end"]),
                text=text,
                semantic_types=semantic_types,
                importance_score=importance,
                confidence=1.0,
                keywords=keywords,
                entities={"metrics": METRIC_PATTERN.findall(text)},
                source_clip_ids=clip_ids,
            )
        )
    return output


def _build_selling_point_evidence(
    clips: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
    mappings: list[TimelineMapping],
) -> list[SellingPointEvidence]:
    output: list[SellingPointEvidence] = []
    for clip_index, clip in enumerate(clips, start=1):
        clip_id = str(clip.get("clip_id") or clip.get("slice_id") or f"clip_{clip_index:03d}")
        claims = _selling_points(clip)
        clip_mappings = [item for item in mappings if item.clip_id == clip_id]
        clip_segment_ids = {
            segment_id for mapping in clip_mappings for segment_id in mapping.source_segment_ids
        }
        clip_segments = [
            item
            for item in transcript_segments
            if str(item["segment_id"]) in clip_segment_ids
        ]
        proof_shot = str(
            clip.get("proof_shot")
            or clip.get("transcript_excerpt")
            or clip.get("text")
            or ""
        ).strip()
        proof_shot_verified = bool(
            proof_shot and clip.get("proof_shot_verified", True)
        )
        for claim_index, claim in enumerate(claims, start=1):
            matching = [
                item for item in clip_segments if _claim_matches_text(claim, str(item["text"]))
            ]
            transcript_quote = " ".join(str(item["text"]) for item in matching).strip()
            verified = bool(transcript_quote or proof_shot_verified)
            if transcript_quote and proof_shot_verified:
                evidence_type = "combined"
            elif transcript_quote:
                evidence_type = "transcript"
            elif proof_shot_verified:
                evidence_type = "visual"
            else:
                evidence_type = "provided"
            selling_point_id = f"selling-point::{clip_id}::{claim_index:03d}"
            output.append(
                SellingPointEvidence(
                    evidence_id=f"evidence::{clip_id}::{claim_index:03d}",
                    selling_point_id=selling_point_id,
                    clip_id=clip_id,
                    claim=claim,
                    evidence_type=evidence_type,
                    source_segment_ids=[str(item["segment_id"]) for item in matching],
                    source_ranges=[
                        EvidenceSourceRange(start=float(item["start"]), end=float(item["end"]))
                        for item in matching
                    ],
                    transcript_quote=transcript_quote,
                    proof_shot=proof_shot,
                    verified=verified,
                    compliance_status="verified" if verified else "unverified",
                    confidence=(
                        1.0 if transcript_quote else (0.7 if proof_shot_verified else 0.0)
                    ),
                    allowed_surfaces=(
                        ["subtitle", "flower_text", "cover", "title"]
                        if verified
                        else []
                    ),
                    notes=[] if verified else ["缺少可追溯的口播或画面证据。"],
                )
            )
    return output


def _attach_evidence_refs(
    semantic_segments: list[SemanticSegment],
    evidence: list[SellingPointEvidence],
) -> list[SemanticSegment]:
    refs_by_segment: dict[str, list[str]] = {}
    for item in evidence:
        for segment_id in item.source_segment_ids:
            refs_by_segment.setdefault(segment_id, []).append(item.evidence_id)
    return [
        item.model_copy(
            update={"evidence_refs": refs_by_segment.get(item.segment_id, [])}
        )
        for item in semantic_segments
    ]


def _build_motion_intents(
    clips: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
    mappings: list[TimelineMapping],
    evidence: list[SellingPointEvidence],
) -> list[MotionIntent]:
    candidates: list[dict[str, Any]] = []
    evidence_by_clip: dict[str, list[SellingPointEvidence]] = {}
    for item in evidence:
        evidence_by_clip.setdefault(item.clip_id, []).append(item)
        if item.verified:
            candidates.append(
                {
                    "clip_id": item.clip_id,
                    "text": item.claim,
                    "intent_type": "selling_point_highlight",
                    "component": "SellingPointHighlight",
                    "selling_point_id": item.selling_point_id,
                    "evidence_ids": [item.evidence_id],
                    "source_segment_ids": item.source_segment_ids,
                }
            )

    for clip_index, clip in enumerate(clips, start=1):
        clip_id = str(clip.get("clip_id") or clip.get("slice_id") or f"clip_{clip_index:03d}")
        flycut = clip.get("flycut_caption") or {}
        for keyword in flycut.get("highlight_keywords") or []:
            text = str(keyword).strip()
            if text:
                candidates.append(
                    {
                        "clip_id": clip_id,
                        "text": text,
                        "intent_type": "keyword_highlight",
                        "component": "KeywordHighlight",
                        "selling_point_id": "",
                        "evidence_ids": [],
                        "source_segment_ids": [],
                    }
                )

    output: list[MotionIntent] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        identity = (candidate["clip_id"], candidate["text"])
        if identity in seen:
            continue
        seen.add(identity)
        clip_mappings = [item for item in mappings if item.clip_id == candidate["clip_id"]]
        clip_segment_ids = {
            segment_id for mapping in clip_mappings for segment_id in mapping.source_segment_ids
        }
        source_segment = _candidate_source_segment(
            candidate,
            transcript_segments,
            clip_segment_ids,
        )
        if source_segment is not None:
            source_start = float(source_segment["start"])
            source_end = float(source_segment["end"])
            source_segment_id = str(source_segment["segment_id"])
        elif clip_mappings:
            source_start = clip_mappings[0].source_start
            source_end = min(clip_mappings[0].source_end, source_start + 1.2)
            source_segment_id = ""
        else:
            continue
        final_interval = _map_source_interval(source_start, source_end, clip_mappings)
        kwargs: dict[str, Any] = {
            "mapping_status": "pending_mapping",
            "final_start": None,
            "final_end": None,
        }
        if final_interval is not None:
            kwargs = {
                "mapping_status": "mapped",
                "final_start": final_interval[0],
                "final_end": final_interval[1],
            }
        output.append(
            MotionIntent(
                intent_id=f"motion::{candidate['clip_id']}::{len(output) + 1:03d}",
                clip_id=candidate["clip_id"],
                intent_type=candidate["intent_type"],
                component=candidate["component"],
                primary_text=candidate["text"],
                selling_point_id=candidate["selling_point_id"],
                source_segment_id=source_segment_id,
                source_start=source_start,
                source_end=source_end,
                preferred_placements=["top-right", "top-left"],
                density="low",
                evidence_ids=candidate["evidence_ids"],
                **kwargs,
            )
        )
    return output


def _candidate_source_segment(
    candidate: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
    clip_segment_ids: set[str],
) -> dict[str, Any] | None:
    preferred_ids = set(candidate.get("source_segment_ids") or [])
    for item in transcript_segments:
        if str(item["segment_id"]) in preferred_ids:
            return item
    for item in transcript_segments:
        if str(item["segment_id"]) not in clip_segment_ids:
            continue
        if _claim_matches_text(str(candidate["text"]), str(item["text"])):
            return item
    return None


def _map_source_interval(
    source_start: float,
    source_end: float,
    mappings: list[TimelineMapping],
) -> tuple[float, float] | None:
    for mapping in mappings:
        if mapping.source_start <= source_start < mapping.source_end:
            clipped_end = min(source_end, mapping.source_end)
            if clipped_end <= source_start:
                return None
            return (
                round(mapping.final_start + source_start - mapping.source_start, 3),
                round(mapping.final_start + clipped_end - mapping.source_start, 3),
            )
    return None


def _selling_points(clip: dict[str, Any]) -> list[str]:
    raw = clip.get("selling_points") or []
    if isinstance(raw, str):
        raw = [raw]
    return list(
        dict.fromkeys(str(item).strip() for item in raw if str(item).strip())
    )


def _claim_matches_text(claim: str, text: str) -> bool:
    compact_claim = re.sub(r"\s+", "", claim)
    compact_text = re.sub(r"\s+", "", text)
    if compact_claim and compact_claim in compact_text:
        return True
    terms = [marker for marker in SELLING_POINT_MARKERS if marker in compact_claim]
    if terms:
        return all(term in compact_text for term in terms)
    metric = METRIC_PATTERN.search(compact_claim)
    return bool(metric and metric.group(0) in compact_text)


def _semantic_keywords(text: str) -> list[str]:
    values = [marker for marker in SELLING_POINT_MARKERS if marker in text]
    values.extend(METRIC_PATTERN.findall(text))
    values.extend(marker for marker in CTA_MARKERS if marker in text)
    return list(dict.fromkeys(values))


def _overlaps(start_a: float, end_a: float, start_b: float, end_b: float) -> bool:
    return min(end_a, end_b) > max(start_a, start_b)


def _finite_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if math.isfinite(parsed) else None
