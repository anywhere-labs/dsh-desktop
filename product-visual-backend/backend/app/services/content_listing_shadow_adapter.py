from __future__ import annotations

import re
from typing import Any

from backend.app.contracts.content_listing_contract import (
    ContentListing,
    ContentListingEvidence,
    ContentListingShadowSnapshot,
)
from backend.app.services.liveclip_content_contract_adapter import (
    build_liveclip_content_contracts,
)


def build_content_listing_shadow(
    job_id: str,
    result_json: dict[str, Any],
) -> ContentListingShadowSnapshot:
    """Build a read-only commercial semantic layer from existing LiveClip output."""

    content = build_liveclip_content_contracts(job_id, result_json)
    clips = _clips(result_json)
    clip_by_id = {
        str(item.get("clip_id") or item.get("slice_id")): item for item in clips
    }
    evidence_by_clip: dict[str, list[Any]] = {}
    for item in content.selling_point_evidence:
        evidence_by_clip.setdefault(item.clip_id, []).append(item)

    listings: list[ContentListing] = []
    for index, mapping_group in enumerate(_group_mappings(content.timeline_mappings), 1):
        clip_id = mapping_group[0].clip_id
        clip = clip_by_id.get(clip_id, {})
        clip_evidence = evidence_by_clip.get(clip_id, [])
        source_ids = sorted({sid for item in mapping_group for sid in item.source_segment_ids})
        source_text = " ".join(
            item.text for item in content.semantic_segments
            if item.segment_id in source_ids
        )
        points = [item.claim for item in clip_evidence]
        evidence = [
            ContentListingEvidence(
                field="selling_points",
                kind="fact" if item.verified else "inference",
                source_segment_ids=list(item.source_segment_ids),
                source_clip_ids=[clip_id],
                note=item.compliance_status,
            )
            for item in clip_evidence
        ]
        warnings: list[str] = []
        missing_data: list[str] = []
        if not points:
            warnings.append("no_traceable_selling_point")
            missing_data.append("verified_selling_points")
        if not clip.get("product_id") and not clip.get("product_name"):
            missing_data.append("product_identity")
        title = str(clip.get("title") or clip.get("name") or "").strip()
        listings.append(
            ContentListing(
                listing_id=f"CL-{job_id}-{clip_id}-{index:04d}",
                job_id=job_id,
                clip_id=clip_id,
                source_segment_ids=source_ids,
                source_time_ranges=[
                    {"start": item.source_start, "end": item.source_end}
                    for item in mapping_group
                ],
                topic=title,
                content_type=_content_type(clip, points),
                content_goal="unknown",
                purchase_stage="unknown",
                product_id=str(clip.get("product_id") or ""),
                product_name=str(clip.get("product_name") or ""),
                title_candidate=title,
                hook_candidate=title,
                cta_candidate=_cta(clip, source_text),
                selling_point_ids=[item.selling_point_id for item in clip_evidence],
                platforms=[str(value) for value in (clip.get("platform_hint") or [])],
                evidence=evidence,
                confidence=round(_confidence(clip_evidence, source_ids), 4),
                warnings=warnings,
                missing_data=missing_data,
            )
        )
    verified = sum(item.status == "evidence_validated" for item in listings)
    return ContentListingShadowSnapshot(
        job_id=job_id,
        listings=listings,
        summary={
            "listing_count": len(listings),
            "traceable_selling_point_listing_count": sum(bool(item.selling_point_ids) for item in listings),
            "evidence_validated_count": verified,
        },
        warnings=["shadow_only_no_render_or_publish_side_effects"],
    )


def _clips(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    value = result_json.get("segments") or result_json.get("slice_segments") or []
    return [item for item in value if isinstance(item, dict)]


def _group_mappings(mappings: list[Any]) -> list[list[Any]]:
    groups: dict[str, list[Any]] = {}
    for item in mappings:
        groups.setdefault(item.clip_id, []).append(item)
    return [sorted(items, key=lambda value: value.range_index) for items in groups.values()]


def _content_type(clip: dict[str, Any], points: list[str]) -> str:
    text = " ".join([str(clip.get("title") or ""), *points])
    if any(word in text for word in ("价格", "到手", "下单", "购买", "福利")):
        return "conversion"
    if any(word in text for word in ("使用", "面料", "版型", "显瘦", "光泽")):
        return "product_explanation"
    return "unknown"


def _cta(clip: dict[str, Any], source_text: str = "") -> str:
    text = " ".join([str(clip.get("text") or ""), source_text])
    match = re.search(r"[^。！？!?]*(?:点击|下单|购买|加购)[^。！？!?]*", text)
    return match.group(0).strip() if match else ""


def _confidence(items: list[Any], source_ids: list[str]) -> float:
    if not source_ids:
        return 0.0
    if not items:
        return 0.25
    return sum(float(item.confidence) for item in items) / len(items)
