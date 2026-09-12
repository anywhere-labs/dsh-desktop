from __future__ import annotations

import json
from decimal import Decimal, DecimalException, InvalidOperation, ROUND_HALF_UP
from typing import Any


MAX_TIME_SECONDS = Decimal("604800")
MAX_TIME_MILLISECONDS = 604_800_000


def normalize_transcript_segments(
    segments: list[dict[str, Any]],
    merge_gap_ms: int | None = None,
) -> list[dict[str, Any]]:
    nonempty_segments = [
        segment
        for segment in segments
        if str(segment.get("text") or "").strip()
    ]
    normalized = [_clean_segment(segment) for segment in nonempty_segments]
    # Python's stable sort preserves input order when both timestamps match.
    normalized.sort(key=lambda item: (item["_start_ms"], item["_end_ms"]))
    normalized = _collapse_duplicates(normalized)

    if merge_gap_ms is not None:
        normalized = _merge_by_gap(normalized, max(0, merge_gap_ms))

    _assign_missing_ids(normalized)
    _recalculate(normalized)
    return normalized


def render_numbered_txt(segments: list[dict[str, Any]]) -> str:
    lines = [
        (
            f"[{segment.get('sequence_no') or segment['index']}] {_format_timestamp(segment['start'])} --> "
            f"{_format_timestamp(segment['end'])} {segment['text']}"
        )
        for segment in segments
    ]
    return "\n".join(lines) + ("\n" if lines else "")


def render_srt(segments: list[dict[str, Any]]) -> str:
    blocks = [
        (
            f"{segment['index']}\n"
            f"{_format_timestamp(segment['start'])} --> "
            f"{_format_timestamp(segment['end'])}\n"
            f"{segment['text']}"
        )
        for segment in segments
    ]
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def render_ass(segments: list[dict[str, Any]]) -> str:
    events = []
    for segment in segments:
        events.append(
            "Dialogue: 0,"
            f"{_ass_time(segment['start'])},"
            f"{_ass_time(segment['end'])},"
            "Main,,0,0,0,,"
            f"{_ass_escape(segment['text'])}"
        )
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Main,Microsoft YaHei,58,&H00FFFFFF,&H0000D7FF,&H00202020,&H88000000,1,0,0,0,100,100,0,0,1,4,0,2,96,96,235,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "\n".join(events)
        + ("\n" if events else "")
    )


def render_timeline(segments: list[dict[str, Any]]) -> str:
    return json.dumps({"segments": segments}, ensure_ascii=False, indent=2)


def _clean_segment(segment: dict[str, Any]) -> dict[str, Any]:
    start_value = _validate_time(segment.get("start"), "start")
    end_value = _validate_time(segment.get("end"), "end")
    if end_value <= start_value:
        raise ValueError("end must be greater than start")

    start_ms = _to_milliseconds(start_value, "start")
    end_ms = _to_milliseconds(end_value, "end")
    if end_ms <= start_ms:
        end_ms = start_ms + 1
    if end_ms > MAX_TIME_MILLISECONDS:
        raise ValueError("end must not exceed seven days after millisecond rounding")

    cleaned = {
        "_start_ms": start_ms,
        "_end_ms": end_ms,
        "text": str(segment.get("text") or "").strip(),
    }
    if segment.get("segment_id"):
        cleaned["segment_id"] = str(segment["segment_id"])
    if "selected" in segment:
        cleaned["selected"] = bool(segment["selected"])
    return cleaned


def _collapse_duplicates(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collapsed: list[dict[str, Any]] = []
    for segment in segments:
        is_near_duplicate = (
            collapsed
            and collapsed[-1]["text"] == segment["text"]
            and segment["_start_ms"] - collapsed[-1]["_end_ms"] <= 100
        )
        if is_near_duplicate:
            previous = collapsed[-1]
            previous["_end_ms"] = max(previous["_end_ms"], segment["_end_ms"])
            if "segment_id" not in previous and segment.get("segment_id"):
                previous["segment_id"] = segment["segment_id"]
            if segment.get("selected"):
                previous["selected"] = True
            continue
        collapsed.append(segment.copy())
    return collapsed


def _merge_by_gap(
    segments: list[dict[str, Any]], merge_gap_ms: int
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for segment in segments:
        if not merged:
            merged.append(segment.copy())
            continue
        previous = merged[-1]
        gap_ms = max(0, segment["_start_ms"] - previous["_end_ms"])
        if gap_ms <= merge_gap_ms:
            previous["_end_ms"] = max(previous["_end_ms"], segment["_end_ms"])
            previous["text"] = f"{previous['text']} {segment['text']}"
            if "selected" in previous or "selected" in segment:
                previous["selected"] = bool(previous.get("selected")) or bool(
                    segment.get("selected")
                )
            continue
        merged.append(segment.copy())
    return merged


def _assign_missing_ids(segments: list[dict[str, Any]]) -> None:
    reserved_ids = {
        str(segment["segment_id"]) for segment in segments if segment.get("segment_id")
    }
    used_ids: set[str] = set()
    next_id = 1
    for segment in segments:
        segment_id = segment.get("segment_id")
        if segment_id and segment_id not in used_ids:
            used_ids.add(segment_id)
            continue
        while (
            f"seg_{next_id:04d}" in reserved_ids
            or f"seg_{next_id:04d}" in used_ids
        ):
            next_id += 1
        segment_id = f"seg_{next_id:04d}"
        segment["segment_id"] = segment_id
        used_ids.add(segment_id)
        next_id += 1


def _recalculate(segments: list[dict[str, Any]]) -> None:
    previous_end_ms: int | None = None
    for index, segment in enumerate(segments, start=1):
        start_ms = segment.pop("_start_ms")
        end_ms = segment.pop("_end_ms")
        segment["start"] = start_ms / 1000
        segment["end"] = end_ms / 1000
        segment["index"] = index
        segment["sequence_no"] = index
        segment["duration"] = (end_ms - start_ms) / 1000
        segment["gap_ms"] = (
            0
            if previous_end_ms is None
            else max(0, start_ms - previous_end_ms)
        )
        existing_tags = [
            str(tag).strip()
            for tag in (segment.get("emphasis_tags") or [])
            if str(tag).strip()
        ]
        detected_tags = _detect_emphasis_tags(segment["text"])
        segment["emphasis_tags"] = list(dict.fromkeys(existing_tags + detected_tags))
        segment["hook_candidate"] = index == 1
        previous_end_ms = end_ms


def _format_timestamp(seconds: float) -> str:
    value = _validate_time(seconds, "timestamp")
    milliseconds = _to_milliseconds(value, "timestamp")
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _validate_time(value: Any, field: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field} must be a finite non-negative number") from None
    if not parsed.is_finite() or parsed < 0 or parsed > MAX_TIME_SECONDS:
        raise ValueError(f"{field} must be a finite non-negative number")
    return parsed


def _to_milliseconds(value: Decimal, field: str) -> int:
    try:
        return int((value * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (DecimalException, OverflowError, ValueError):
        raise ValueError(f"{field} must be a valid timestamp") from None


def _detect_emphasis_tags(text: str) -> list[str]:
    lowered = str(text or "")
    tags = []
    if any(token in lowered for token in ["面料", "刺绣", "层次", "细节", "版型", "上身"]):
        tags.append("detail")
    if any(token in lowered for token in ["显瘦", "轻透", "适合", "舒服", "结论", "推荐"]):
        tags.append("benefit")
    if any(token in lowered for token in ["为什么", "先看", "重点", "别急", "一定要看"]):
        tags.append("hook")
    return tags


def _ass_time(seconds: float) -> str:
    milliseconds = _to_milliseconds(_validate_time(seconds, "timestamp"), "timestamp")
    total_centiseconds = int(round(milliseconds / 10))
    hours, remainder = divmod(total_centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    secs, centiseconds = divmod(remainder, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def _ass_escape(text: str) -> str:
    return (
        str(text)
        .replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
    )
