from __future__ import annotations

from pathlib import Path

from backend.app.core.paths import STORAGE_DIR


AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a")
DEFAULT_SFX_DIR = STORAGE_DIR / "sfx"


def normalize_cue_name(value: str) -> str:
    return (value or "").strip().lower().replace("-", "_").replace(" ", "_")


def plan_audio_overlay(effect_items: list[dict] | None) -> list[dict]:
    cues: list[dict] = []
    for item in effect_items or []:
        cue_name = normalize_cue_name(item.get("sound_effect") or item.get("cue") or "")
        if not cue_name:
            continue
        start = max(0.0, float(item.get("start") or item.get("at") or 0.0))
        end = max(start, float(item.get("end") or start))
        cues.append({
            "cue": cue_name,
            "at": start,
            "duration_hint": round(max(0.0, end - start), 3),
            "text": item.get("text", ""),
        })
    return cues


def discover_audio_assets(
    asset_dir: str | Path | None = None,
    asset_map: dict[str, str] | None = None,
) -> list[dict]:
    assets: list[dict] = []
    seen: set[Path] = set()
    for cue_name, path_str in (asset_map or {}).items():
        path = Path(path_str)
        if path.is_file():
            resolved = path.resolve()
            seen.add(resolved)
            assets.append({"cue": normalize_cue_name(cue_name), "path": str(resolved)})
    search_dir = Path(asset_dir) if asset_dir else DEFAULT_SFX_DIR
    if search_dir.is_dir():
        for path in sorted(search_dir.iterdir()):
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            assets.append({"cue": normalize_cue_name(path.stem), "path": str(resolved)})
    return assets


def summarize_audio_mix(cues: list[dict], available_assets: list[dict]) -> dict:
    matched_assets = []
    matched_cues = []
    for cue in cues:
        cue_name = normalize_cue_name(cue.get("cue", ""))
        match = next(
            (
                asset for asset in available_assets
                if normalize_cue_name(asset.get("cue", "")) == cue_name
                or normalize_cue_name(Path(asset.get("path", "")).stem) == cue_name
            ),
            None,
        )
        if not match:
            continue
        matched_assets.append(match)
        matched_cues.append({**cue, "asset_path": match["path"]})
    return {
        "sfx_mix_status": "rendered" if matched_cues else "metadata_only",
        "requested_cue_count": len(cues),
        "mixed_asset_count": len(matched_cues),
        "matched_assets": matched_assets,
        "matched_cues": matched_cues,
    }


def mix_audio_overlay(
    video_input: Path,
    cues: list[dict],
    available_assets: list[dict],
    output: Path,
    ffmpeg_path: str | None,
    runner,
    cwd: Path | None = None,
    timeout: int = 180,
) -> dict:
    summary = summarize_audio_mix(cues, available_assets)
    if summary["sfx_mix_status"] != "rendered":
        return {
            "status": "skipped",
            "output_path": str(video_input),
            **summary,
        }
    if not ffmpeg_path or not video_input.is_file():
        return {
            "status": "failed",
            "output_path": str(video_input),
            "warnings": ["缺少 FFmpeg 或源视频，无法执行音效混入。"],
            **summary,
        }

    cmd = [ffmpeg_path, "-y", "-i", str(video_input)]
    for item in summary["matched_cues"]:
        cmd.extend(["-i", item["asset_path"]])

    filter_parts = []
    mix_inputs = ["[0:a]"]
    for index, item in enumerate(summary["matched_cues"], start=1):
        delay_ms = int(round(max(0.0, float(item.get("at") or 0.0)) * 1000))
        label = f"sfx{index}"
        filter_parts.append(f"[{index}:a]adelay={delay_ms}|{delay_ms},volume=0.35[{label}]")
        mix_inputs.append(f"[{label}]")
    filter_parts.append("".join(mix_inputs) + f"amix=inputs={len(mix_inputs)}:normalize=0:dropout_transition=0[mixout]")

    cmd.extend([
        "-filter_complex",
        ";".join(filter_parts),
        "-map",
        "0:v:0",
        "-map",
        "[mixout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        str(output),
    ])
    result = runner(cmd, timeout=timeout, cwd=cwd)
    if result.get("returncode") != 0 or not output.exists() or output.stat().st_size <= 0:
        output.unlink(missing_ok=True)
        return {
            "status": "failed",
            "output_path": str(video_input),
            "warnings": [result.get("stderr") or "音效混入失败。"],
            **summary,
        }
    return {
        "status": "ok",
        "output_path": str(output),
        **summary,
    }
