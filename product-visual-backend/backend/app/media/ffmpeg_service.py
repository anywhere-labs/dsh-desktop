from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from backend.app.core.paths import PROJECT_ROOT


def _candidate_runtime_paths(name: str) -> list[Path]:
    if name not in {"ffmpeg", "ffprobe"}:
        return []
    bin_dir = PROJECT_ROOT / "runtime" / "ffmpeg" / "bin"
    return [bin_dir / name, bin_dir / f"{name}.exe"]


def _is_runnable_binary(path: str | Path) -> bool:
    candidate = str(path)
    try:
        proc = subprocess.run(
            [candidate, "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            shell=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


def resolve_binary(name: str) -> str | None:
    for local in _candidate_runtime_paths(name):
        if local.exists() and _is_runnable_binary(local):
            return str(local)
    system = shutil.which(name)
    if system and _is_runnable_binary(system):
        return system
    return None


def check_ffmpeg() -> dict:
    ffmpeg = resolve_binary("ffmpeg")
    ffprobe = resolve_binary("ffprobe")
    return {
        "ffmpeg": {"ok": bool(ffmpeg), "path": ffmpeg},
        "ffprobe": {"ok": bool(ffprobe), "path": ffprobe},
        "ready": bool(ffmpeg and ffprobe),
    }


def run_command(cmd: list[str], timeout: int = 120, cwd: Path | None = None) -> dict:
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        shell=False,
        cwd=str(cwd) if cwd else None,
    )
    return {"returncode": proc.returncode, "stdout": proc.stdout[-4000:], "stderr": proc.stderr[-4000:]}


def extract_video_frame(
    source: Path,
    output: Path,
    at_seconds: float = 0.0,
) -> dict:
    ffmpeg = resolve_binary("ffmpeg")
    if not ffmpeg:
        return {
            "status": "blocked",
            "missing_inputs": ["ffmpeg"],
            "warnings": ["FFmpeg 不可用，无法生成源视频缩略图。"],
        }
    if not source.is_file():
        return {
            "status": "blocked",
            "missing_inputs": ["source_video"],
            "warnings": ["源视频文件不存在。"],
        }
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        result = run_command(
            [
                ffmpeg,
                "-y",
                "-ss",
                str(max(0.0, at_seconds)),
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(output),
            ],
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        output.unlink(missing_ok=True)
        return {
            "status": "blocked",
            "missing_inputs": ["thumbnail_render"],
            "warnings": ["源视频缩略图抽帧失败。"],
        }
    if result["returncode"] != 0 or not output.is_file() or output.stat().st_size <= 0:
        output.unlink(missing_ok=True)
        return {
            "status": "blocked",
            "missing_inputs": ["thumbnail_render"],
            "warnings": [result.get("stderr") or "源视频缩略图抽帧失败。"],
        }
    with output.open("rb") as image:
        if image.read(2) != b"\xff\xd8":
            output.unlink(missing_ok=True)
            return {
                "status": "blocked",
                "missing_inputs": ["thumbnail_render"],
                "warnings": ["FFmpeg 未生成有效 JPEG 缩略图。"],
            }
    return {"status": "ok", "path": output}
