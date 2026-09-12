from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from backend.app.core.paths import PROJECT_ROOT, rel_path
from backend.app.media.audio_overlay_service import discover_audio_assets, plan_audio_overlay, summarize_audio_mix
from backend.app.services.live_clip_template_registry import get_style_presets, resolve_template


SKILL_ID = "flycut_caption"
SKILL_NAME = "flycut-caption"
CAPABILITIES = [
    "generate_srt_subtitle",
    "align_caption_timeline",
    "enhance_caption_text",
    "detect_highlight_keywords",
    "generate_ass_subtitle",
    "apply_caption_style_template",
    "burn_caption_to_video",
    "export_caption_assets",
]

STYLE_PRESETS = {
    "ecommerce_conversion": {
        "name": "电商带货强转化风",
        "font_size": 64,
        "primary": "&H00FFFFFF",
        "secondary": "&H0000D7FF",
        "outline": "&H00131313",
        "back": "&H99000000",
        "margin_v": 250,
    },
    "xiaohongshu_seed": {
        "name": "小红书种草风",
        "font_size": 58,
        "primary": "&H00FFFFFF",
        "secondary": "&H00B2E6FF",
        "outline": "&H00383450",
        "back": "&H88322A35",
        "margin_v": 250,
    },
    "professional_review": {
        "name": "专业测评风",
        "font_size": 56,
        "primary": "&H00FFFFFF",
        "secondary": "&H0063E6FF",
        "outline": "&H00111111",
        "back": "&H88000000",
        "margin_v": 230,
    },
    "emotion_hook": {
        "name": "情绪爆点风",
        "font_size": 68,
        "primary": "&H00FFFFFF",
        "secondary": "&H002929FF",
        "outline": "&H00000000",
        "back": "&HAA000000",
        "margin_v": 245,
    },
    "knowledge_creator": {
        "name": "知识博主分享风",
        "font_size": 58,
        "primary": "&H00FFFFFF",
        "secondary": "&H0000D7FF",
        "outline": "&H00202020",
        "back": "&H88000000",
        "margin_v": 235,
    },
    "douyin_apparel_detail_conversion_v1": {
        "name": "抖音女装细节转化 V1",
        "font_size": 60,
        "primary": "&H00FFFFFF",
        "secondary": "&H0000D7FF",
        "outline": "&H00202020",
        "back": "&H88000000",
        "margin_v": 260,
        "business_rules": {
            "target_duration_seconds": [30, 45],
            "hook_deadline_seconds": 3,
            "effect_point_range": [4, 6],
            "sfx_cue_range": [3, 5],
            "detail_before_full_body": True,
            "benefit_conclusion_required": True,
        },
    },
}
STYLE_PRESETS.update(get_style_presets())


def _caption_font_name(platform_name: str | None = None) -> str:
    configured = str(os.getenv("LIVECLIP_CAPTION_FONT") or "").strip()
    if configured:
        return configured
    platform_name = platform_name or sys.platform
    if platform_name == "darwin":
        return "PingFang SC"
    if platform_name.startswith("win"):
        return "Microsoft YaHei"
    return "Noto Sans CJK SC"


def health() -> dict:
    return {
        "status": "ok",
        "skill_id": SKILL_ID,
        "skill_name": SKILL_NAME,
        "module": "直播切片分发模块",
        "position": "after_clip_generation_before_caption_burn",
        "capabilities": CAPABILITIES,
        "not_responsible_for": ["clip_decision", "viral_scoring", "auto_publish"],
    }


def enhance_caption_assets(clip_dir: Path, segment: dict, payload: dict) -> dict:
    style_key = payload.get("caption_style") or payload.get("flycut_caption_style") or "ecommerce_conversion"
    style = STYLE_PRESETS.get(style_key, STYLE_PRESETS["ecommerce_conversion"])
    try:
        template = resolve_template(style_key)
    except KeyError:
        template = None
    srt_path = clip_dir / f"{segment['clip_id']}.srt"
    ass_path = clip_dir / f"{segment['clip_id']}_flycut.ass"
    style_path = clip_dir / "caption_style.json"
    effects_path = clip_dir / "caption_effect_points.json"
    qc_path = clip_dir / "caption_qc_report.md"

    text = _clean_caption_text(segment.get("text", ""))
    p4_packaging = segment.get("_p4_packaging")
    keywords = _detect_keywords(text, segment, payload)
    start = 0.0
    end = float(segment.get("duration_seconds") or 0)
    if not srt_path.exists():
        srt_path.write_text(_make_srt(text, start, end), encoding="utf-8")

    if isinstance(p4_packaging, dict):
        ass_text = _make_p4_ass(
            p4_packaging.get("final_transcript_segments") or [], style,
            dialogue_ids=_mapping_dialogue_ids(segment),
        )
    else:
        ass_text = _make_ass(
            text,
            keywords,
            start,
            end,
            style,
            dialogue_ids=_mapping_dialogue_ids(segment),
        )
    ass_path.write_text(ass_text, encoding="utf-8")
    is_registry_template = template is not None
    style_json = {
        "skill_id": SKILL_ID,
        "skill_name": SKILL_NAME,
        "style_key": style_key,
        "style_name": style["name"],
        "aspect_ratio": payload.get("aspect_ratio") or ("9:16" if payload.get("enable_vertical_reframe", True) else "source"),
        "brand_color": payload.get("brand_color", "#1E63FF"),
        "burn_to_video": bool(payload.get("enable_subtitle_burn", True)),
        "capabilities": CAPABILITIES,
        "business_rules": style.get("business_rules", {}),
        "template_version": style.get("template_version", ""),
        "sfx_mix_status": "metadata_only" if is_registry_template else "not_requested",
    }
    effect_range = style.get("business_rules", {}).get("effect_point_range", [])
    effect_limit = int(effect_range[1]) if len(effect_range) == 2 else 6
    effect_keywords = keywords[:effect_limit]
    p4_items = (
        _p4_effect_items(p4_packaging, end, style_key, style)
        if isinstance(p4_packaging, dict)
        else None
    )
    effects = {
        "skill_id": SKILL_ID,
        "items": p4_items if p4_items is not None else [
            {
                "start": round(start + index * min(1.2, max(end / max(len(keywords), 1), 0.6)), 3),
                "end": round(min(end, start + index * 1.2 + 1.1), 3),
                "text": keyword,
                "effect": "keyword_highlight",
                "style": style_key,
                "sound_effect": "soft_pop" if _template_should_emit_sfx(style, index) else "",
            }
            for index, keyword in enumerate(effect_keywords)
        ],
    }
    if isinstance(p4_packaging, dict):
        effects["warnings"] = list(p4_packaging.get("warnings") or [])
    audio_cues = plan_audio_overlay(effects["items"])
    available_audio_assets = discover_audio_assets(
        payload.get("sound_effect_asset_dir"),
        payload.get("sound_effect_asset_map"),
    )
    audio_mix = (
        summarize_audio_mix(audio_cues, available_audio_assets)
        if is_registry_template
        else {
            "sfx_mix_status": "not_requested",
            "requested_cue_count": len(audio_cues),
            "mixed_asset_count": 0,
            "matched_assets": [],
            "matched_cues": [],
        }
    )
    effects["sfx_cues"] = audio_cues
    effects_path.write_text(json.dumps(effects, ensure_ascii=False, indent=2), encoding="utf-8")
    style_json["sfx_mix_status"] = audio_mix["sfx_mix_status"]
    style_json["audio_mix_preview"] = audio_mix
    style_path.write_text(json.dumps(style_json, ensure_ascii=False, indent=2), encoding="utf-8")
    qc = _qc_report(segment, text, keywords, style_key, style, audio_mix["sfx_mix_status"])
    qc_path.write_text(qc, encoding="utf-8")
    return {
        "skill_id": SKILL_ID,
        "skill_name": SKILL_NAME,
        "status": "ready",
        "srt_file": rel_path(srt_path) if srt_path.exists() else "",
        "ass_file": rel_path(ass_path),
        "style_json": rel_path(style_path),
        "effect_points_json": rel_path(effects_path),
        "qc_report": rel_path(qc_path),
        "highlight_keywords": keywords,
        "caption_style": style_key,
        "audio_cues": audio_cues,
        "available_audio_assets": available_audio_assets,
        "audio_mix": audio_mix,
        "timeline_mapping_ids": list(segment.get("timeline_mapping_ids") or []),
        "ass_dialogue_ids": _mapping_dialogue_ids(segment),
        "warnings": (
            list(p4_packaging.get("warnings") or [])
            if isinstance(p4_packaging, dict)
            else []
        ),
    }


def _p4_effect_items(
    packaging: dict,
    clip_duration: float,
    style_key: str,
    style: dict,
) -> list[dict]:
    """Use only evidenced final-timeline intents, with a low-noise density cap."""

    output: list[dict] = []
    seen: set[tuple[str, tuple[str, ...], float]] = set()
    used_buckets: set[int] = set()
    intents = sorted(
        (packaging.get("render_motion_intents") or []),
        key=lambda item: (
            float(item.get("final_start") or 0),
            float(item.get("final_end") or 0),
        ),
    )
    for item in intents:
        evidence_ids = tuple(str(value) for value in (item.get("evidence_ids") or []))
        mapping_id = str(item.get("timeline_mapping_id") or "")
        if (
            item.get("mapping_status") != "mapped"
            or item.get("final_start") is None
            or item.get("final_end") is None
            or not evidence_ids
            or not mapping_id
        ):
            continue
        start = max(0.0, float(item["final_start"]))
        end = min(clip_duration, float(item["final_end"]))
        text = str(item.get("primary_text") or "").strip()
        if not text or end <= start:
            continue
        identity = (text, evidence_ids, round(start, 3))
        bucket = int(start // 5)
        if identity in seen or bucket in used_buckets:
            continue
        seen.add(identity)
        used_buckets.add(bucket)
        output.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
                "effect": "keyword_highlight",
                "style": style_key,
                "sound_effect": (
                    "soft_pop" if _template_should_emit_sfx(style, len(output)) else ""
                ),
                "motion_intent_id": str(item.get("intent_id") or ""),
                "evidence_ids": list(evidence_ids),
                "timeline_mapping_id": mapping_id,
                "source_segment_id": str(item.get("source_segment_id") or ""),
            }
        )
    return output


def _clean_caption_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    for filler in ["呃", "嗯", "啊", "然后然后", "就是就是"]:
        text = text.replace(filler, "")
    return text[:220]


def _detect_keywords(text: str, segment: dict, payload: dict) -> list[str]:
    configured = payload.get("highlight_keywords") or []
    if isinstance(configured, str):
        configured = [item.strip() for item in configured.split(",") if item.strip()]
    apparel_seeds = (
        ["面料", "刺绣", "层次", "版型", "显瘦", "轻透", "上身"]
        if payload.get("caption_style") == "douyin_apparel_detail_conversion_v1"
        else []
    )
    seeds = [
        segment.get("highlight_label", ""),
        payload.get("product", ""),
        *apparel_seeds,
        "痛点",
        "优惠",
        "效果",
        "信任",
        "互动",
        "复购",
    ]
    keywords: list[str] = []
    for item in list(configured) + seeds:
        if item and item not in keywords and (item in text or item in seeds):
            keywords.append(item)
    return keywords[:8] or ["重点"]


def _template_should_emit_sfx(style: dict, index: int) -> bool:
    sfx_range = style.get("business_rules", {}).get("sfx_cue_range", [])
    if len(sfx_range) == 2:
        return index < int(sfx_range[1])
    return index < 4


def _make_ass(text: str, keywords: list[str], start: float, end: float, style: dict, dialogue_ids: list[str] | None = None) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{_caption_font_name()},{style["font_size"]},{style["primary"]},{style["secondary"]},{style["outline"]},{style["back"]},1,0,0,0,100,100,0,0,1,4,0,2,96,96,{style["margin_v"]},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    for cue_index, cue in enumerate(build_caption_cues(text, start, end)):
        highlighted = _ass_escape(cue["text"])
        for keyword in keywords:
            safe = _ass_escape(keyword)
            highlighted = highlighted.replace(
                safe,
                r"{\c"
                + style["secondary"]
                + r"\fs"
                + str(style["font_size"] + 8)
                + "}"
                + safe
                + r"{\rMain}",
            )
        events.append(
            f"Dialogue: 0,{_ass_time(cue['start'])},{_ass_time(cue['end'])},"
            f"Main,{(dialogue_ids or [])[cue_index] if cue_index < len(dialogue_ids or []) else ''},0,0,0,,{highlighted}"
        )
    return header + "\n".join(events) + ("\n" if events else "")


def _make_p4_ass(segments: list[dict], style: dict, dialogue_ids: list[str] | None = None) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{_caption_font_name()},{style["font_size"]},{style["primary"]},{style["secondary"]},{style["outline"]},{style["back"]},1,0,0,0,100,100,0,0,1,4,0,2,96,96,{style["margin_v"]},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    cue_index = 0
    for item in segments:
        try:
            start = float(item.get("start"))
            end = float(item.get("end"))
        except (TypeError, ValueError):
            continue
        text = _clean_caption_text(str(item.get("text") or ""))
        if start < 0 or end <= start or not text:
            continue
        for cue in build_caption_cues(text, start, end):
            dialogue_id = (dialogue_ids or [])[cue_index] if cue_index < len(dialogue_ids or []) else ""
            events.append(
                f"Dialogue: 0,{_ass_time(cue['start'])},{_ass_time(cue['end'])},"
                f"Main,{dialogue_id},0,0,0,,{_ass_escape(cue['text'])}"
            )
            cue_index += 1
    return header + "\n".join(events) + ("\n" if events else "")


def _mapping_dialogue_ids(segment: dict) -> list[str]:
    output: list[str] = []
    for mapping in segment.get("timeline_mappings") or []:
        output.extend(str(item) for item in mapping.get("ass_dialogue_ids") or [])
    return output


def _qc_report(
    segment: dict,
    text: str,
    keywords: list[str],
    style_key: str,
    style: dict,
    sfx_mix_status: str,
) -> str:
    risks = []
    duration = float(segment.get("duration_seconds") or 0)
    if len(text) > 120:
        risks.append("字幕较长，建议拆成两行或分句显示。")
    if duration <= 0:
        risks.append("片段时长异常，无法确认字幕时间轴。")
    if not keywords:
        risks.append("未识别到花字关键词。")
    risk_text = "\n".join(f"- {item}" for item in risks) or "- 无"
    rules = style.get("business_rules", {})
    duration_range = rules.get("target_duration_seconds", [])
    duration_target_pass = (
        len(duration_range) == 2
        and float(duration_range[0]) <= duration <= float(duration_range[1])
    )
    apparel_fields = ""
    if rules:
        apparel_fields = f"""
duration_target_pass: {str(duration_target_pass).lower()}
hook_deadline_seconds: {rules["hook_deadline_seconds"]}
detail_before_full_body: {str(rules["detail_before_full_body"]).lower()}
benefit_conclusion_required: {str(rules["benefit_conclusion_required"]).lower()}
sfx_mix_status: {sfx_mix_status}
"""
    return f"""# flycut-caption QC

skill_id: {SKILL_ID}
caption_style: {style_key}
clip_id: {segment.get("clip_id", "")}
duration_seconds: {segment.get("duration_seconds", "")}
highlight_keywords: {", ".join(keywords)}
{apparel_fields}

## Risks
{risk_text}
"""


def _make_srt(text: str, start: float, end: float) -> str:
    return render_caption_srt(text, start, end)


def render_caption_srt(text: str, start: float, end: float) -> str:
    blocks: list[str] = []
    for index, cue in enumerate(build_caption_cues(text, start, end), start=1):
        blocks.append(
            f"{index}\n{_srt_time(cue['start'])} --> {_srt_time(cue['end'])}\n"
            f"{cue['text']}\n"
        )
    return "\n".join(blocks)


def build_caption_cues(
    text: str,
    start: float,
    end: float,
    *,
    max_chars_per_line: int = 16,
    max_lines: int = 2,
) -> list[dict]:
    clean = _clean_caption_text(text)
    if not clean:
        return []
    cue_limit = max(1, max_chars_per_line * max_lines)
    semantic_parts = [
        item.strip()
        for item in re.split(r"(?<=[，。！？；,.!?;])|\s+", clean)
        if item.strip()
    ]
    chunks: list[str] = []
    current = ""
    for part in semantic_parts:
        while len(part) > cue_limit:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(part[:cue_limit])
            part = part[cue_limit:]
        if not part:
            continue
        if current and len(current) + len(part) > cue_limit:
            chunks.append(current)
            current = part
        else:
            current += part
    if current:
        chunks.append(current)

    duration = max(0.001, float(end) - float(start))
    total_weight = sum(max(1, len(item)) for item in chunks)
    cursor = float(start)
    cues: list[dict] = []
    elapsed_weight = 0
    for index, chunk in enumerate(chunks):
        lines = [
            chunk[offset : offset + max_chars_per_line]
            for offset in range(0, len(chunk), max_chars_per_line)
        ][:max_lines]
        elapsed_weight += max(1, len(chunk))
        cue_end = (
            float(end)
            if index == len(chunks) - 1
            else float(start) + duration * elapsed_weight / total_weight
        )
        cues.append(
            {
                "start": round(cursor, 3),
                "end": round(max(cursor + 0.001, cue_end), 3),
                "text": "\n".join(lines),
            }
        )
        cursor = cue_end
    return cues


def _srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def _ass_time(seconds: float) -> str:
    cs = int(round(seconds * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, centi = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{centi:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}").replace("\n", r"\N")
