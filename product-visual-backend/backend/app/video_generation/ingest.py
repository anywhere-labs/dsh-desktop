from __future__ import annotations

from pathlib import Path
from typing import Any


def validate_source_probe(probe: dict[str, Any]) -> list[str]:
    """Fail closed before any mask/model work starts."""
    missing: list[str] = []
    if probe.get("status") != "ok":
        missing.append("video_probe")
    if not probe.get("has_video"):
        missing.append("video_stream")
    if float(probe.get("duration") or 0) <= 0:
        missing.append("video_duration")
    if int(probe.get("width") or 0) <= 0 or int(probe.get("height") or 0) <= 0:
        missing.append("video_dimensions")
    return missing


def build_ingest_record(
    *,
    task_id: str,
    source_path: Path,
    probe: dict[str, Any],
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create the immutable source record consumed by the replica pipeline."""
    missing = validate_source_probe(probe)
    if missing:
        raise ValueError(f"source media blocked: {', '.join(missing)}")
    return {
        "task_id": task_id,
        "source": {
            "path": str(source_path),
            "duration": float(probe["duration"]),
            "width": int(probe["width"]),
            "height": int(probe["height"]),
            "has_audio": bool(probe.get("has_audio")),
            "immutable": True,
        },
        "audio_lock": {
            "mode": "ORIGINAL_AUDIO_STREAM",
            "required": True,
            "available": bool(probe.get("has_audio")),
            "remux_only": True,
        },
        "segments": [
            {"start": float(item["start"]), "end": float(item["end"]), "type": str(item.get("type", "unknown"))}
            for item in segments
        ],
        "generation_policy": {
            "preserve_foreground_pixels": True,
            "preserve_motion": True,
            "preserve_audio": True,
            "allow_video_regeneration": False,
            "allow_lip_sync": False,
            "allow_tts": False,
        },
    }
