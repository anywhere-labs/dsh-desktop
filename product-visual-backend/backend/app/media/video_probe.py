from __future__ import annotations

import json
import subprocess
from pathlib import Path

from backend.app.media.ffmpeg_service import resolve_binary


def probe_video(path: Path) -> dict:
    ffprobe = resolve_binary("ffprobe")
    if not ffprobe:
        return {"status": "blocked", "missing_inputs": ["ffprobe"], "duration": 0, "metadata": {}}
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,width,height,duration",
        "-of",
        "json",
        str(path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        shell=False,
    )
    if proc.returncode != 0:
        return {"status": "failed", "missing_inputs": [], "duration": 0, "metadata": {"stderr": proc.stderr}}
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams") or []
    video_streams = [item for item in streams if item.get("codec_type") == "video"]
    audio_streams = [item for item in streams if item.get("codec_type") == "audio"]
    first_video = video_streams[0] if video_streams else {}
    return {
        "status": "ok",
        "missing_inputs": [],
        "duration": float(data.get("format", {}).get("duration", 0) or 0),
        "metadata": data,
        "has_video": bool(video_streams),
        "has_audio": bool(audio_streams),
        "width": int(first_video.get("width") or 0),
        "height": int(first_video.get("height") or 0),
        "video_streams": video_streams,
        "audio_streams": audio_streams,
    }
