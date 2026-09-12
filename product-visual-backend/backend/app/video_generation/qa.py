from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.app.media.video_probe import probe_video


def evaluate_composite(source: Path, output: Path) -> dict[str, Any]:
    failures: list[dict[str, str]] = []
    if not output.exists() or output.stat().st_size == 0:
        failures.append({"code": "output_missing", "message": "合成视频产物不存在或为空"})
        return {"status": "fail", "passed": False, "checks": {}, "failures": failures, "repair_owner": "CompositeAgent"}
    source_probe = probe_video(source)
    output_probe = probe_video(output)
    checks = {
        "video_present": bool(output_probe.get("has_video")),
        "audio_preserved": bool(output_probe.get("has_audio")),
        "duration_close": abs(float(output_probe.get("duration", 0)) - float(source_probe.get("duration", 0))) <= 0.25,
    }
    if not checks["video_present"]:
        failures.append({"code": "video_missing", "message": "输出缺少视频流"})
    if not checks["audio_preserved"]:
        failures.append({"code": "original_audio_missing", "message": "输出未检测到原音频流"})
    if not checks["duration_close"]:
        failures.append({"code": "duration_mismatch", "message": "输出时长与原视频不一致"})
    return {
        "status": "pass" if not failures else "fail",
        "passed": not failures,
        "checks": checks,
        "failures": failures,
        "repair_owner": "CompositeAgent" if failures else None,
    }
