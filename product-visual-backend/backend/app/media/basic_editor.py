from __future__ import annotations

import json
from pathlib import Path

from backend.app.adapters.flycut_caption_adapter import health as flycut_caption_health
from backend.app.adapters.flycut_caption_adapter import enhance_caption_assets
from backend.app.media.audio_overlay_service import mix_audio_overlay
from backend.app.media.edit_plan_builder import build_edit_plan
from backend.app.media.ffmpeg_service import check_ffmpeg, resolve_binary, run_command
from backend.app.media.jianying_manifest_builder import build_jianying_manifest
from backend.app.media.subtitle_service import write_basic_srt


def export_preview(source: Path, out_dir: Path, script: dict, material: dict) -> dict:
    status = check_ffmpeg()
    if not status["ready"]:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["ffmpeg"],
            "warnings": ["当前无法执行真实视频导出"],
            "next_action": ["请安装 FFmpeg 并确保 ffmpeg -version 可用"],
        }
    if not source.exists() or source.stat().st_size <= 0:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["raw_video"],
            "warnings": ["没有真实视频素材，不能生成 mp4"],
            "next_action": ["请上传 MP4 / MOV 原片"],
        }
    out_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = resolve_binary("ffmpeg")
    mp4 = out_dir / "preview.mp4"
    captioned_mp4 = out_dir / "preview_captioned.mp4"
    mixed_mp4 = out_dir / "preview_captioned_mix.mp4"
    mov = out_dir / "preview.mov"
    srt = out_dir / "subtitle.srt"
    audio_mix_report = out_dir / "audio_mix_report.json"
    edit_plan = build_edit_plan(script, material)
    manifest = build_jianying_manifest(edit_plan)
    (out_dir / "edit_plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "jianying_project_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "README_剪映手动复刻说明.md").write_text("# 剪映手动复刻说明\n\n当前版本不伪造剪映草稿，请按 manifest 手动复刻时间线。\n", encoding="utf-8")
    write_basic_srt(srt, script.get("title", "短视频预览"))
    mp4_result = run_command([ffmpeg, "-y", "-i", str(source), "-t", "30", "-c:v", "libx264", "-c:a", "aac", str(mp4)], timeout=180)
    if mp4_result["returncode"] != 0 or not mp4.exists() or mp4.stat().st_size <= 0:
        return {"status": "failed", "data": {"stderr": mp4_result["stderr"]}, "missing_inputs": [], "warnings": ["FFmpeg 导出 MP4 失败"], "next_action": ["查看 stderr 并检查素材编码"]}
    caption_segment = {
        "clip_id": "auto_edit_preview",
        "text": script.get("title", "短视频预览"),
        "highlight_label": "自动剪辑",
        "duration_seconds": 30,
    }
    caption_assets = enhance_caption_assets(
        out_dir,
        caption_segment,
        {
            "enable_flycut_caption": True,
            "enable_subtitle_burn": True,
            "caption_style": script.get("caption_style", "knowledge_creator"),
            "highlight_keywords": script.get("highlight_keywords", ["自动剪辑", "字幕增强", "花字字幕"]),
            "enable_vertical_reframe": False,
            "aspect_ratio": "source",
            "sound_effect_asset_dir": script.get("sound_effect_asset_dir"),
            "sound_effect_asset_map": script.get("sound_effect_asset_map"),
        },
    )
    burn_result = run_command(
        [
            ffmpeg,
            "-y",
            "-i",
            str(mp4),
            "-vf",
            "subtitles=" + Path(caption_assets["ass_file"]).name,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-c:a",
            "copy",
            str(captioned_mp4),
        ],
        timeout=180,
        cwd=out_dir,
    )
    final_mp4 = captioned_mp4 if burn_result["returncode"] == 0 and captioned_mp4.exists() and captioned_mp4.stat().st_size > 0 else mp4
    packaging_mode = "subtitle_plus_overlay"
    mix_result = {
        "status": "skipped",
        "output_path": str(final_mp4),
        "sfx_mix_status": caption_assets.get("audio_mix", {}).get("sfx_mix_status", "not_requested"),
        "requested_cue_count": len(caption_assets.get("audio_cues", [])),
        "mixed_asset_count": 0,
        "matched_assets": [],
        "matched_cues": [],
    }
    if final_mp4.exists():
        mix_result = mix_audio_overlay(
            final_mp4,
            caption_assets.get("audio_cues", []),
            caption_assets.get("available_audio_assets", []),
            mixed_mp4,
            ffmpeg,
            run_command,
            cwd=out_dir,
            timeout=180,
        )
        if mix_result["status"] == "ok" and mixed_mp4.exists():
            final_mp4.unlink(missing_ok=True)
            mixed_mp4.replace(final_mp4)
            packaging_mode = "subtitle_overlay_sfx"
    audio_mix_report.write_text(json.dumps(mix_result, ensure_ascii=False, indent=2), encoding="utf-8")
    mov_result = run_command([ffmpeg, "-y", "-i", str(final_mp4), "-c", "copy", str(mov)], timeout=120)
    mov_path = str(mov)
    if mov_result["returncode"] != 0:
        mov_path = ""
    return {
        "status": "ok",
        "data": {
            "mp4_path": str(final_mp4),
            "clean_mp4_path": str(mp4),
            "mov_path": mov_path,
            "srt_path": str(srt),
            "ass_path": str(out_dir / "auto_edit_preview_flycut.ass"),
            "caption_style_json": str(out_dir / "caption_style.json"),
            "caption_effect_points_json": str(out_dir / "caption_effect_points.json"),
            "caption_qc_report": str(out_dir / "caption_qc_report.md"),
            "audio_mix_report": str(audio_mix_report),
            "packaging_mode": packaging_mode,
            "skills": {"flycut_caption": flycut_caption_health()},
            "skill_outputs": {"flycut_caption": caption_assets},
            "edit_plan_path": str(out_dir / "edit_plan.json"),
            "jianying_manifest_path": str(out_dir / "jianying_project_manifest.json"),
            "manual_readme_path": str(out_dir / "README_剪映手动复刻说明.md"),
        },
        "missing_inputs": [],
        "warnings": [] if final_mp4 == captioned_mp4 else ["flycut-caption 字幕烧录失败，已保留无烧录字幕预览。"],
        "next_action": ["下载预览视频并进入数据复盘"],
    }
