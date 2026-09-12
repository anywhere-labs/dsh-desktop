from __future__ import annotations

import math
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

from backend.app.media.ffmpeg_service import resolve_binary


Runner = Callable[..., Any]


def validate_ranges(
    ranges: list[dict],
    source_duration: float | None = None,
    max_ranges: int = 20,
    max_total_duration: float = 90.0,
) -> list[dict]:
    if source_duration is not None:
        try:
            source_duration = float(source_duration)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("source duration must be finite and positive") from exc
        if not math.isfinite(source_duration) or source_duration <= 0:
            raise ValueError("source duration must be finite and positive")
    if not isinstance(ranges, list) or not ranges or len(ranges) > max_ranges:
        raise ValueError(f"ranges must contain between 1 and {max_ranges} items")
    normalized: list[dict] = []
    total = 0.0
    previous_end = -1.0
    for index, item in enumerate(ranges):
        try:
            start = float(item["start"])
            end = float(item["end"])
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f"range {index} has invalid start/end") from exc
        if not math.isfinite(start) or not math.isfinite(end):
            raise ValueError(f"range {index} must use finite times")
        if start < 0 or end <= start:
            raise ValueError(f"range {index} must satisfy 0 <= start < end")
        if start < previous_end:
            raise ValueError(f"range {index} overlaps or is out of order")
        if source_duration is not None and end > float(source_duration) + 0.001:
            raise ValueError(f"range {index} exceeds source duration")
        total += end - start
        if total > max_total_duration + 0.001:
            raise ValueError("combined range duration exceeds limit")
        normalized.append({"start": start, "end": end})
        previous_end = end
    return normalized


def build_concat_manifest(paths: list[str | Path]) -> str:
    lines = []
    for path in paths:
        value = Path(path).resolve().as_posix().replace("'", "'\\''")
        lines.append(f"file '{value}'")
    return "\n".join(lines) + "\n"


def remap_subtitle_segments(
    transcript_segments: list[dict], ranges: list[dict]
) -> list[dict]:
    normalized_ranges = validate_ranges(
        ranges, max_total_duration=float("inf")
    )
    remapped: list[dict] = []
    output_offset = 0.0
    for range_index, time_range in enumerate(normalized_ranges):
        range_start = time_range["start"]
        range_end = time_range["end"]
        for segment in transcript_segments:
            try:
                segment_start = float(segment["start"])
                segment_end = float(segment["end"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            overlap_start = max(segment_start, range_start)
            overlap_end = min(segment_end, range_end)
            text = str(segment.get("text") or "").strip()
            if overlap_end <= overlap_start or not text:
                continue
            remapped.append(
                {
                    "start": round(output_offset + overlap_start - range_start, 3),
                    "end": round(output_offset + overlap_end - range_start, 3),
                    "text": text,
                    "source_segment_id": segment.get("segment_id"),
                    "source_range_index": range_index,
                }
            )
        output_offset += range_end - range_start
    return sorted(remapped, key=lambda item: (item["start"], item["end"]))


def build_precise_cut_command(
    ffmpeg: str,
    source: str | Path,
    start: float,
    end: float,
    output: str | Path,
) -> list[str]:
    return [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{end - start:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-y",
        str(output),
    ]


def build_concat_command(
    ffmpeg: str, manifest: str | Path, output: str | Path
) -> list[str]:
    final = Path(output)
    temporary = final.with_suffix(final.suffix + ".tmp.mp4")
    return [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(manifest),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        str(temporary),
    ]


def render_multi_range(
    source: str | Path,
    ranges: list[dict],
    output_dir: str | Path,
    output_name: str = "combined.mp4",
    ffmpeg_path: str | None = None,
    runner: Runner = subprocess.run,
) -> dict:
    source_path = Path(source)
    if not source_path.is_file():
        raise ValueError("source video does not exist")
    if (
        Path(output_name).name != output_name
        or Path(output_name).suffix.lower() != ".mp4"
    ):
        raise ValueError("output_name must be a plain MP4 file name")
    normalized = validate_ranges(ranges)
    ffmpeg = ffmpeg_path or resolve_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is unavailable")

    target_dir = Path(output_dir)
    intermediate_dir = target_dir / "intermediates"
    intermediate_dir.mkdir(parents=True, exist_ok=True)
    commands: list[list[str]] = []
    completed: list[str] = []

    for index, time_range in enumerate(normalized):
        intermediate = intermediate_dir / f"range_{index + 1:03d}.mp4"
        intermediate.unlink(missing_ok=True)
        command = build_precise_cut_command(
            ffmpeg,
            source_path,
            time_range["start"],
            time_range["end"],
            intermediate,
        )
        commands.append(command)
        process = _run(runner, command)
        if process.returncode != 0 or not intermediate.is_file():
            return _failure(
                commands, completed, process.stderr, index, None
            )
        completed.append(str(intermediate))

    manifest_path = target_dir / "concat.txt"
    manifest_path.write_text(
        build_concat_manifest([Path(item) for item in completed]),
        encoding="utf-8",
    )
    final_path = target_dir / output_name
    concat_command = build_concat_command(ffmpeg, manifest_path, final_path)
    commands.append(concat_command)
    Path(concat_command[-1]).unlink(missing_ok=True)
    process = _run(runner, concat_command)
    temporary_path = Path(concat_command[-1])
    if process.returncode != 0 or not temporary_path.is_file():
        return _failure(
            commands, completed, process.stderr, None, manifest_path
        )
    final_path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temporary_path, final_path)
    return {
        "status": "ok",
        "final_mp4": str(final_path),
        "manifest": str(manifest_path),
        "intermediates": completed,
        "duration": round(
            sum(item["end"] - item["start"] for item in normalized), 3
        ),
        "commands": commands,
        "stderr": "",
        "failed_range": None,
    }


def _run(runner: Runner, command: list[str]):
    try:
        return runner(
            command,
            capture_output=True,
            text=True,
            timeout=1800,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        return SimpleNamespace(
            returncode=124,
            stdout="",
            stderr=f"FFmpeg timed out after {exc.timeout} seconds",
        )
    except OSError as exc:
        return SimpleNamespace(returncode=1, stdout="", stderr=str(exc))


def _failure(
    commands: list[list[str]],
    completed: list[str],
    stderr: str,
    failed_range: int | None,
    manifest: Path | None,
) -> dict:
    return {
        "status": "partial",
        "final_mp4": "",
        "manifest": str(manifest) if manifest else "",
        "intermediates": completed,
        "commands": commands,
        "stderr": str(stderr or "")[-2000:],
        "failed_range": failed_range,
    }
