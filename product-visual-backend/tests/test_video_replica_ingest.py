from pathlib import Path

import pytest

from backend.app.video_generation.ingest import build_ingest_record, validate_source_probe


def _probe(**overrides):
    result = {
        "status": "ok",
        "has_video": True,
        "has_audio": True,
        "duration": 8.5,
        "width": 1080,
        "height": 1920,
    }
    result.update(overrides)
    return result


def test_source_probe_requires_video_and_dimensions():
    assert validate_source_probe(_probe(has_video=False)) == ["video_stream"]
    assert validate_source_probe(_probe(duration=0, width=0)) == ["video_duration", "video_dimensions"]


def test_ingest_record_locks_original_audio_and_foreground_policy():
    record = build_ingest_record(
        task_id="replica-1",
        source_path=Path("/tmp/source.mp4"),
        probe=_probe(),
        segments=[{"start": 0, "end": 8.5, "type": "full_preview"}],
    )
    assert record["source"]["immutable"] is True
    assert record["audio_lock"] == {
        "mode": "ORIGINAL_AUDIO_STREAM",
        "required": True,
        "available": True,
        "remux_only": True,
    }
    assert record["generation_policy"]["preserve_foreground_pixels"] is True
    assert record["generation_policy"]["allow_video_regeneration"] is False


def test_ingest_fails_closed_without_audio_for_audio_locked_route():
    record = build_ingest_record(
        task_id="replica-2",
        source_path=Path("/tmp/source.mp4"),
        probe=_probe(has_audio=False),
        segments=[],
    )
    assert record["audio_lock"]["available"] is False
    assert record["audio_lock"]["required"] is True
