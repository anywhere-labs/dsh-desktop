from __future__ import annotations

import math
from copy import deepcopy
from decimal import Decimal, DecimalException, ROUND_HALF_UP
from typing import Any


MAX_TIMELINE_SECONDS = 604800.0
BOUNDARY_TOLERANCE_MS = 1
DURATION_TOLERANCE = 0.01


def validate_clip_plans(
    payload: Any,
    transcript_segments: Any,
    source_duration: Any,
    min_duration: float = 15.0,
    max_duration: float = 90.0,
) -> dict:
    return _validate(
        payload,
        transcript_segments,
        source_duration,
        min_duration,
        max_duration,
    )


def _validate(
    payload: Any,
    transcript_segments: Any,
    source_duration: Any,
    min_duration: Any,
    max_duration: Any,
) -> dict:
    clips = _extract_clips(payload)
    if clips is None:
        return _result([], [_issue(None, -1, "malformed_payload", "clips must be an array")], [])
    if not clips:
        return _result([], [_issue(None, -1, "empty_clips", "clips must not be empty")], [])

    source = _finite_number(source_duration)
    minimum = _finite_number(min_duration)
    maximum = _finite_number(max_duration)
    if (
        source is None
        or source <= 0
        or source > MAX_TIMELINE_SECONDS
        or minimum is None
        or maximum is None
        or minimum < 0
        or minimum > maximum
    ):
        return _result(
            [],
            [_issue(None, -1, "config_error", "duration configuration is invalid")],
            [],
        )

    transcript = _validate_transcript(transcript_segments, source)
    if transcript is None:
        return _result(
            [],
            [_issue(None, -1, "invalid_transcript", "source or transcript is invalid")],
            [],
        )

    by_id, order = transcript
    plans: list[dict] = []
    errors: list[dict] = []
    warnings: list[dict] = []
    seen_clip_ids: set[str] = set()
    seen_segment_sets: set[tuple[str, ...]] = set()
    seen_ranges: list[tuple[tuple[int, int], ...]] = []

    for index, raw_plan in enumerate(clips):
        raw_clip_id = raw_plan.get("clip_id") if isinstance(raw_plan, dict) else None
        if (
            isinstance(raw_clip_id, str)
            and raw_clip_id
            and raw_clip_id in seen_clip_ids
        ):
            errors.append(
                _issue(
                    raw_clip_id,
                    index,
                    "duplicate_clip_id",
                    "clip_id duplicates an earlier plan",
                )
            )
            continue
        if isinstance(raw_clip_id, str) and raw_clip_id:
            seen_clip_ids.add(raw_clip_id)

        candidate, plan_errors, plan_warnings = _validate_plan(
            raw_plan,
            index,
            by_id,
            order,
            source,
            minimum,
            maximum,
        )
        if plan_errors:
            errors.extend(plan_errors)
            continue
        assert candidate is not None
        segment_key = tuple(candidate["segment_ids"])
        range_key = _canonical_ranges(candidate["ranges"])
        if segment_key in seen_segment_sets or any(
            _range_keys_equivalent(range_key, existing) for existing in seen_ranges
        ):
            errors.append(
                _issue(
                    candidate["clip_id"],
                    index,
                    "duplicate_plan",
                    "Plan duplicates segment_ids or ranges from an earlier plan",
                )
            )
            continue
        seen_segment_sets.add(segment_key)
        seen_ranges.append(range_key)
        plans.append(candidate)
        warnings.extend(plan_warnings)

    return _result(plans, errors, warnings)


def _extract_clips(payload: Any) -> list | None:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("clips"), list):
        return payload["clips"]
    return None


def _validate_transcript(
    segments: Any, source_duration: float | None
) -> tuple[dict[str, dict], dict[str, int]] | None:
    if not isinstance(segments, list) or source_duration is None:
        return None
    by_id: dict[str, dict] = {}
    order: dict[str, int] = {}
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            return None
        segment_id = segment.get("segment_id")
        start = _finite_number(segment.get("start"))
        end = _finite_number(segment.get("end"))
        if (
            not isinstance(segment_id, str)
            or not segment_id
            or segment_id in by_id
            or start is None
            or end is None
            or start < 0
            or end <= start
            or start > MAX_TIMELINE_SECONDS
            or end > MAX_TIMELINE_SECONDS
            or end > source_duration
        ):
            return None
        by_id[segment_id] = {"start": start, "end": end}
        order[segment_id] = index
    return by_id, order


def _validate_plan(
    raw_plan: Any,
    index: int,
    by_id: dict[str, dict],
    order: dict[str, int],
    source_duration: float,
    minimum: float,
    maximum: float,
) -> tuple[dict | None, list[dict], list[dict]]:
    if not isinstance(raw_plan, dict):
        return None, [_issue(None, index, "malformed_plan", "Plan must be an object")], []

    clip_id = raw_plan.get("clip_id")
    title = raw_plan.get("title")
    segment_ids = raw_plan.get("segment_ids")
    if not isinstance(clip_id, str) or not clip_id.strip():
        return None, [_issue(clip_id, index, "missing_clip_id", "clip_id is required")], []
    if not isinstance(title, str) or not title.strip():
        return None, [_issue(clip_id, index, "missing_title", "title is required")], []
    if not isinstance(segment_ids, list) or not segment_ids:
        return None, [_issue(clip_id, index, "missing_segment_ids", "segment_ids is required")], []
    if any(not isinstance(item, str) or item not in by_id for item in segment_ids):
        return None, [_issue(clip_id, index, "unknown_segment_id", "segment_id was not found")], []
    if len(set(segment_ids)) != len(segment_ids):
        return None, [_issue(clip_id, index, "duplicate_segment_id", "segment_ids must be unique")], []

    positions = [order[item] for item in segment_ids]
    if positions != sorted(positions):
        return None, [_issue(clip_id, index, "segment_order", "segment_ids must follow transcript order")], []

    expected_ranges = _ranges_from_segments(segment_ids, positions, by_id)
    if "ranges" in raw_plan:
        ranges, range_error = _validate_ranges(
            raw_plan["ranges"], source_duration, clip_id, index
        )
        if range_error:
            return None, [range_error], []
        assert ranges is not None
    else:
        ranges = expected_ranges

    if not _boundaries_match(ranges, expected_ranges):
        return None, [_issue(clip_id, index, "boundary_mismatch", "ranges do not match segment boundaries")], []

    duration = sum(item["end"] - item["start"] for item in ranges)
    if duration < minimum or duration > maximum:
        return None, [_issue(clip_id, index, "duration_out_of_bounds", "duration is outside allowed limits")], []

    plan_warnings: list[dict] = []
    supplied_duration = _finite_number(raw_plan.get("duration"))
    if "duration" in raw_plan and (
        supplied_duration is None
        or abs(supplied_duration - duration) > DURATION_TOLERANCE
    ):
        plan_warnings.append(
            _issue(clip_id, index, "duration_repaired", "duration was replaced with calculated duration")
        )

    score = _finite_number(raw_plan.get("score"))
    if "score" not in raw_plan:
        score = 0.0
    elif score is None:
        score = 0.0
        plan_warnings.append(
            _issue(clip_id, index, "score_repaired", "invalid score was replaced with zero")
        )
    elif score < 0 or score > 100:
        score = min(100.0, max(0.0, score))
        plan_warnings.append(
            _issue(clip_id, index, "score_clamped", "score was clamped to 0..100")
        )

    candidate = deepcopy(raw_plan)
    candidate["clip_id"] = clip_id
    candidate["title"] = title
    candidate["segment_ids"] = list(segment_ids)
    candidate["ranges"] = ranges
    candidate["duration"] = duration
    candidate["score"] = float(score)
    return candidate, [], plan_warnings


def _ranges_from_segments(
    segment_ids: list[str],
    positions: list[int],
    by_id: dict[str, dict],
) -> list[dict]:
    ranges: list[dict] = []
    group_start = by_id[segment_ids[0]]["start"]
    group_end = by_id[segment_ids[0]]["end"]
    previous_position = positions[0]
    for segment_id, position in zip(segment_ids[1:], positions[1:]):
        segment = by_id[segment_id]
        if position == previous_position + 1:
            group_end = segment["end"]
        else:
            ranges.append({"start": group_start, "end": group_end})
            group_start = segment["start"]
            group_end = segment["end"]
        previous_position = position
    ranges.append({"start": group_start, "end": group_end})
    return ranges


def _validate_ranges(
    raw_ranges: Any,
    source_duration: float,
    clip_id: str,
    index: int,
) -> tuple[list[dict] | None, dict | None]:
    if not isinstance(raw_ranges, list) or not raw_ranges:
        return None, _issue(clip_id, index, "invalid_range", "ranges must be a non-empty array")
    ranges: list[dict] = []
    previous_start: float | None = None
    previous_end: float | None = None
    for raw_range in raw_ranges:
        if not isinstance(raw_range, dict):
            return None, _issue(clip_id, index, "invalid_range", "range must be an object")
        start = _finite_number(raw_range.get("start"))
        end = _finite_number(raw_range.get("end"))
        if (
            start is None
            or end is None
            or start < 0
            or end <= start
            or start > MAX_TIMELINE_SECONDS
            or end > MAX_TIMELINE_SECONDS
            or end > source_duration
        ):
            return None, _issue(clip_id, index, "invalid_range", "range bounds are invalid")
        if previous_start is not None and start < previous_start:
            return None, _issue(clip_id, index, "range_order", "ranges must be sorted by start")
        if previous_end is not None and start < previous_end:
            return None, _issue(clip_id, index, "range_overlap", "ranges must not overlap")
        ranges.append({"start": start, "end": end})
        previous_start = start
        previous_end = end
    return ranges, None


def _boundaries_match(actual: list[dict], expected: list[dict]) -> bool:
    if len(actual) != len(expected):
        return False
    return all(
        abs(_to_milliseconds(left["start"]) - _to_milliseconds(right["start"]))
        <= BOUNDARY_TOLERANCE_MS
        and abs(_to_milliseconds(left["end"]) - _to_milliseconds(right["end"]))
        <= BOUNDARY_TOLERANCE_MS
        for left, right in zip(actual, expected)
    )


def _canonical_ranges(ranges: list[dict]) -> tuple[tuple[int, int], ...]:
    return tuple(
        (_to_milliseconds(item["start"]), _to_milliseconds(item["end"]))
        for item in ranges
    )


def _range_keys_equivalent(
    left: tuple[tuple[int, int], ...],
    right: tuple[tuple[int, int], ...],
) -> bool:
    return len(left) == len(right) and all(
        abs(left_start - right_start) <= BOUNDARY_TOLERANCE_MS
        and abs(left_end - right_end) <= BOUNDARY_TOLERANCE_MS
        for (left_start, left_end), (right_start, right_end) in zip(left, right)
    )


def _to_milliseconds(value: float) -> int:
    try:
        return int(
            (Decimal(str(value)) * 1000).quantize(
                Decimal("1"),
                rounding=ROUND_HALF_UP,
            )
        )
    except DecimalException:
        raise ValueError("timeline value cannot be converted to milliseconds") from None


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _issue(clip_id: Any, index: int, code: str, message: str) -> dict:
    return {
        "clip_id": clip_id,
        "index": index,
        "code": code,
        "message": message,
    }


def _result(plans: list[dict], errors: list[dict], warnings: list[dict]) -> dict:
    return {
        "valid": not errors and bool(plans),
        "plans": plans,
        "errors": errors,
        "warnings": warnings,
    }
