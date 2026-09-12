from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


MAX_CLIPS = 100
MAX_DEPTH = 6
MAX_STRING_LENGTH = 10_000
MAX_PAYLOAD_BYTES = 1024 * 1024
SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "token",
    "secret",
    "password",
}


def prepare_clip_plan_payload(payload: dict) -> tuple[dict | None, dict | None]:
    clips = payload.get("clips")
    if isinstance(clips, list) and len(clips) > MAX_CLIPS:
        return None, payload_error("clips must contain at most 100 items")
    try:
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        return None, payload_error(str(exc))
    if len(serialized) > MAX_PAYLOAD_BYTES:
        return None, payload_error("serialized payload must not exceed 1MB")
    try:
        sanitized = _sanitize(payload, 0)
    except ValueError as exc:
        return None, payload_error(str(exc))
    return sanitized, None


def parse_source_duration(value: Any) -> tuple[float | None, dict | None]:
    try:
        duration = float(value)
    except (TypeError, ValueError, OverflowError):
        return None, source_duration_error()
    if not math.isfinite(duration) or duration <= 0:
        return None, source_duration_error()
    return duration, None


def build_validation_record(raw_output: dict, validation: dict) -> dict:
    return {
        "raw_output": deepcopy(raw_output),
        "normalized_plans": deepcopy(validation.get("plans") or []),
        "errors": deepcopy(validation.get("errors") or []),
        "warnings": deepcopy(validation.get("warnings") or []),
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 1,
    }


def validation_trace_summary(raw_output: dict, validation: dict) -> dict:
    canonical = json.dumps(
        raw_output,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "payload_hash": hashlib.sha256(canonical).hexdigest(),
        "clip_count": len(raw_output.get("clips") or []),
        "error_count": len(validation.get("errors") or []),
        "attempts": 1,
    }


def payload_error(message: str) -> dict:
    return {
        "status": "blocked",
        "data": {
            "errors": [{
                "code": "invalid_clip_plan_payload",
                "message": message,
            }]
        },
        "missing_inputs": ["clip_plan_payload"],
    }


def source_duration_error() -> dict:
    return {
        "status": "blocked",
        "data": {
            "errors": [{
                "code": "invalid_source_duration",
                "message": "source_duration must be a finite positive number",
            }]
        },
        "missing_inputs": ["source_duration"],
    }


def persistence_error(exc: Exception) -> dict:
    return {
        "status": "blocked",
        "data": {
            "errors": [{
                "code": "persistence_error",
                "message": str(exc),
            }]
        },
        "missing_inputs": ["clip_plan_persistence"],
    }


def _sanitize(value: Any, depth: int) -> Any:
    if depth > MAX_DEPTH:
        raise ValueError("payload nesting must not exceed depth 6")
    if isinstance(value, str):
        if len(value) > MAX_STRING_LENGTH:
            raise ValueError("strings must not exceed 10000 characters")
        return value
    if isinstance(value, list):
        return [_sanitize(item, depth + 1) for item in value]
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            key_text = str(key)
            if len(key_text) > MAX_STRING_LENGTH:
                raise ValueError("strings must not exceed 10000 characters")
            if key_text.lower() in SENSITIVE_KEYS:
                sanitized[key] = "[REDACTED]"
            else:
                sanitized[key] = _sanitize(item, depth + 1)
        return sanitized
    return deepcopy(value)
