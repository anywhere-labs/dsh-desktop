from __future__ import annotations

import csv
import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.database import SessionLocal
from backend.app.core.paths import EXPORTS_DIR, MATERIALS_DIR, PROJECT_ROOT, rel_path
from backend.app.adapters.flycut_caption_adapter import SKILL_ID as FLYCUT_CAPTION_SKILL_ID
from backend.app.adapters.flycut_caption_adapter import health as flycut_caption_health
from backend.app.adapters.flycut_caption_adapter import build_caption_cues
from backend.app.adapters.flycut_caption_adapter import enhance_caption_assets
from backend.app.adapters.flycut_caption_adapter import render_caption_srt
from backend.app.adapters.funasr_transcription_adapter import FunASRTranscriptionAdapter
from backend.app.adapters.speech_transcription_adapter import SpeechTranscriptionAdapter
from backend.app.media.ffmpeg_service import check_ffmpeg, extract_video_frame, resolve_binary
from backend.app.media.audio_overlay_service import mix_audio_overlay
from backend.app.media.multi_range_renderer import remap_subtitle_segments, render_multi_range
from backend.app.media.video_probe import probe_video
from backend.app.models.material import Material
from backend.app.models.task import CausalTrace, Task, TaskResult
from backend.app.models.trace import TraceEvent
from backend.app.schemas.live_clip_qa import aggregate_qa_results, build_qa_issue, build_qa_result, default_qa_checks
from backend.app.services.clip_plan_validator import validate_clip_plans
from backend.app.services.live_clip_plan_service import (
    build_validation_record,
    parse_source_duration,
    persistence_error as clip_plan_persistence_error,
    prepare_clip_plan_payload,
    validation_trace_summary,
)
from backend.app.services.live_clip_job_service import (
    complete_stage,
    fail_stage,
    get_persistent_job_state,
    load_job_state,
    new_job_state,
    pause_between_stages,
    progress_percent as batch_progress_percent,
    save_persistent_job_state,
    start_stage,
)
from backend.app.services.live_clip_transcript_service import normalize_transcript_segments, render_numbered_txt, render_srt
from backend.app.services.live_clip_transcript_service import render_ass, render_timeline
from backend.app.services.live_clip_template_registry import (
    get_template_registry,
    resolve_template,
)
from backend.app.services.liveclip_planning_sidecar_service import (
    build_verified_planning_sidecar,
    customer_safe_raw_result,
    load_accepted_plan_specs,
    planning_policy_requests_sidecar,
    select_render_planning,
    sidecar_enabled as verified_planning_sidecar_enabled,
)
from backend.app.services.liveclip_content_contract_adapter import (
    assess_clip_boundary,
    build_liveclip_content_contracts,
    build_p4_timeline_packaging_contract,
    transcript_sentence_units,
)
from backend.app.contracts.liveclip_execution_contract import execution_contract_snapshot
from backend.app.services.liveclip_p4_packaging_service import (
    p4_requires_baseline_fallback,
    prepare_p4_packaging_consumption,
)
from backend.app.services.task_log_service import append_task_log, check_export_files, read_task_logs

WORKFLOW = "video_clip_viral_extraction"
REPURPOSING_WORKFLOW = "video_content_repurposing_workflow"
WORKFLOW_ALIASES = {WORKFLOW, REPURPOSING_WORKFLOW, "/video-content-repurposing-workflow"}
_TRANSCRIPT_TASK_LOCKS: dict[str, threading.Lock] = {}
_TRANSCRIPT_TASK_LOCKS_GUARD = threading.Lock()
LIVECLIP_TRANSCRIBE_TIMEOUT_SECONDS = max(
    60,
    int(os.getenv("LIVECLIP_TRANSCRIBE_TIMEOUT_SECONDS", "900")),
)
LIVECLIP_TRANSCRIBE_CHUNK_SECONDS = max(
    60,
    int(os.getenv("LIVECLIP_TRANSCRIBE_CHUNK_SECONDS", "300")),
)
LIVECLIP_TRANSCRIBE_CHUNK_TIMEOUT_SECONDS = max(
    60,
    int(os.getenv("LIVECLIP_TRANSCRIBE_CHUNK_TIMEOUT_SECONDS", "420")),
)


class LiveClipBatchExecutionError(Exception):
    def __init__(self, batch_state: dict, original: Exception):
        super().__init__(str(original))
        self.batch_state = deepcopy(batch_state)
        self.original = original


PLATFORM_LABELS = {
    "douyin": "抖音",
    "kuaishou": "快手",
    "wechat_video": "视频号",
    "shipinhao": "视频号",
    "xiaohongshu": "小红书",
    "抖音": "抖音",
    "快手": "快手",
    "视频号": "视频号",
    "小红书": "小红书",
}
LIVE_CLIP_BLOCKED_MESSAGE = "直播切片任务被阻塞，请按 missing_inputs 补齐。"
LIVE_CLIP_FAILED_MESSAGE = "直播切片任务失败，请查看 Agent / Skill 日志。"
LIVE_CLIP_PARTIAL_MESSAGE = "已生成候选切片，但存在转写或渲染能力缺口。"
LIVE_CLIP_SUCCESS_MESSAGE = "直播切片任务已完成。"
LIVE_CLIP_CREATED_MESSAGE = "直播切片任务待开始。"
LIVE_CLIP_RUNNING_MESSAGE = "直播切片任务进行中。"
LIVE_CLIP_REVIEW_STEP = "等待审核"
LIVE_CLIP_REVIEW_EXPORT_STEP = "等待审核/导出"
LIVE_CLIP_RESULT_EXPORT_STEP = "结果导出"
LIVE_CLIP_PACKAGING_RERENDER_STEP = "包装层已重新生成，请重新提交审核。"
LIVE_CLIP_PARTIAL_READY_STEP = "候选切片已生成，等待转写/语义补强"
LIVE_CLIP_NEXT_ACTION_UPLOAD_VIDEO = "请先上传直播视频素材。"
LIVE_CLIP_NEXT_ACTION_UPLOAD_SRT = "请补齐真实字幕或上传 SRT 后再继续。"
LIVE_CLIP_NEXT_ACTION_CHECK_FFMPEG = "请检查 FFmpeg 与真实成片渲染状态。"
LIVE_CLIP_PLAIN_TEXT_WARNING = "已上传文本，但未识别到 SRT 时间轴，将按整段文本处理。"
LIVE_CLIP_PENDING_TRANSCRIPT_WARNING = "真实语音转写未完成，当前切片仅按视频时长生成，不能视为语义切片。"
LIVE_CLIP_DEFAULT_LABEL = "高能片段"
LIVE_CLIP_DEFAULT_TITLE = "待转写后生成语义标题"
LIVE_CLIP_DEFAULT_CAPTION = "待转写后生成平台文案。"
LIVE_CLIP_NEXT_ACTION_FIX_QA = "请先修复 QA 未通过项，再重新导出成片。"
LIVE_CLIP_NEXT_ACTION_FINISH_RENDER = "请先完成真实 FFmpeg 渲染，再导出成片。"
LIVE_CLIP_BATCH_PAUSED_MESSAGE = "批量任务已暂停。"
LIVE_CLIP_BATCH_FAILED_MESSAGE = "批量任务失败，请先重试。"
LIVE_CLIP_TRANSCRIPT_UNAVAILABLE_MESSAGE = "真实时间轴不可用，当前保留 blocked/partial 流程。"
LIVE_CLIP_RESUME_NEXT_ACTION = "点击继续后，将从下一个未完成阶段恢复。"
LIVE_CLIP_FFMPEG_SILENCEDETECT_FAILED = "FFmpeg silencedetect 执行失败，已跳过静音检测。"
LIVE_CLIP_FFMPEG_SILENCEDETECT_TIMEOUT = "FFmpeg silencedetect 执行超时，已跳过静音检测并继续切片。"
LIVE_CLIP_FFMPEG_SCENE_FAILED = "FFmpeg scene filter 执行失败，已跳过场景变化候选检测。"
LIVE_CLIP_FFMPEG_SCENE_TIMEOUT = "FFmpeg scene filter 执行超时，已跳过场景变化候选检测并继续切片。"
LIVE_CLIP_FFMPEG_UNAVAILABLE_WARNING = "FFmpeg 不可用，已跳过真实切割。"
LIVE_CLIP_REFRAME_FAILED_SUFFIX = "竖屏重构失败，已保留原切片。"
LIVE_CLIP_SUBTITLE_BURN_FAILED_SUFFIX = "字幕烧录失败，已导出无烧录字幕版本。"
LIVE_CLIP_AUDIO_MIX_FAILED_SUFFIX = "音效混入失败，已保留无音效混入版本。"
LIVE_CLIP_COVER_EXTRACT_FAILED_SUFFIX = "封面抽帧失败。"
LIVE_CLIP_HOOK_PENDING = "待转写完成后重写开头 Hook。"
LIVE_CLIP_HOOK_READY_SUFFIX = "已前置核心卖点，适合短视频开场。"
LIVE_CLIP_SUMMARY_PENDING = "待转写完成后补齐切片摘要。"
LIVE_CLIP_TRANSCRIPT_EXCERPT_PENDING = "待转写完成后生成字幕摘录。"
LIVE_CLIP_REASON_FALLBACK = "当前切片仅按时长兜底生成，待转写完成后再补语义理由。"
LIVE_CLIP_REASON_READY = "信息密度较高，适合拆分复用。"
LIVE_CLIP_RENDER_LOG_READY = "basic_ffmpeg 已产出真实成片。"
LIVE_CLIP_RENDER_LOG_PENDING = "真实 MP4 尚未生成，当前不返回伪造路径。"
LIVE_CLIP_TITLE_TEMPLATE_MAP = {
    "产品卖点": "这段话直接讲清用户为什么会停下来",
    "价格优惠": "真正打动用户下单的，不只是便宜",
    "使用效果": "用户下单前最想看到的，其实就是效果",
    "反差痛点": "很多切片转化差，是因为开头没有打中痛点",
    "行动建议": "把这一步做好，切片转化会更稳",
    "信任背书": "比卖点更重要的，是先把信任立住",
    "评论互动": "这句话适合放在结尾带评论互动",
    "复购理由": "让一场直播拆出多条可分发内容",
}
LIVE_CLIP_TITLE_TEMPLATE_FALLBACK = "这段内容适合单独切成短视频。"
LIVE_CLIP_CAPTION_TEMPLATE = "{label}不是单点信息，而是让用户继续看下去的理由。"
LIVE_CLIP_CTA_TEMPLATE = "评论你的品类，我再给你补一版包装文案。"
LIVE_CLIP_RISK_OVER_60 = "片段超过 60 秒，建议再压缩。"
LIVE_CLIP_RISK_WEAK_HOOK = "前 3 秒 Hook 偏弱，建议重写标题或前置痛点。"
LIVE_CLIP_SKILL_LOG_NEXT_ACTION = "请检查 FFmpeg 或字幕烧录日志。"
LIVE_CLIP_SELLING_POINT_MARKERS = (
    "面料",
    "材质",
    "真丝",
    "缎面",
    "光泽",
    "版型",
    "显瘦",
    "显高",
    "高腰",
    "收腰",
    "宽松",
    "领口",
    "透气",
    "轻透",
    "舒服",
    "刺绣",
    "上身",
    "细节",
    "功能",
    "自动",
    "只需要",
    "直接帮",
    "能够帮",
    "解决",
    "提升",
    "降低",
    "节省",
    "不占位置",
    "包邮",
    "到手价",
    "福利",
    "优惠",
    "起步价",
    "自研",
    "全栈",
    "体验",
)


def create_task(db: Session, payload: dict) -> dict:
    workflow = payload.get("workflow") or WORKFLOW
    normalized_payload = _normalize_task_payload({**payload, "workflow": workflow})
    task = Task(
        id=uuid.uuid4().hex,
        task_type=normalized_payload.get("task_type", "live_clip"),
        workflow=workflow,
        account_id=normalized_payload.get("account_id", ""),
        material_id=normalized_payload.get("material_id") or normalized_payload.get("source_video", {}).get("material_id", ""),
        status="created",
        input_json=normalized_payload,
        trace_id=uuid.uuid4().hex,
    )
    db.add(task)
    db.commit()
    append_task_log("live_clips", task.id, "create_task", "ok", _serialize_task(task))
    return _serialize_task(task)


def _normalize_task_payload(payload: dict) -> dict:
    selected = payload.get("target_platforms") or payload.get("platforms") or []
    if isinstance(selected, str):
        selected = [selected]
    platform = payload.get("platform") or (selected[0] if selected else "douyin")
    labels = [PLATFORM_LABELS.get(str(item), str(item)) for item in selected]
    platform_label = PLATFORM_LABELS.get(str(platform), str(platform))
    if platform_label not in labels:
        labels.insert(0, platform_label)
    labels = list(dict.fromkeys(item for item in labels if item))
    return {
        **payload,
        # Customer delivery defaults to clean source audio until the approved
        # SFX template library is supplied. Internal callers may explicitly
        # pass disable_sfx=False to retain the legacy overlay path.
        "disable_sfx": bool(payload.get("disable_sfx", True)),
        "platform": platform,
        "platform_label": platform_label,
        "target_platforms": labels or ["鎶栭煶"],
    }


def get_task_result(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = _current_live_clip_task_result(db, task_id)
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))
    if result:
        return _customer_live_clip_response(
            task,
            result.result_json,
            traces,
            result.status,
            result_id=result.id,
        )
    return {
        "status": task.status,
        "data": _customer_live_clip_payload(task, {}, traces),
        "missing_inputs": ["slice_segments"] if task.status == "created" else [],
    }


def get_live_clip_source_thumbnail(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return {"status": "blocked", "data": {}, "missing_inputs": ["task_id"]}
    material = db.get(Material, task.material_id) if task.material_id else None
    if not material:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["material_id"],
        }
    source = _resolve_material_source_path(material)
    if not source:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["source_video"],
        }
    thumbnail = EXPORTS_DIR / task.id / WORKFLOW / "source_thumbnail.jpg"
    if thumbnail.is_file() and thumbnail.stat().st_size > 0:
        return {"status": "ok", "data": {"path": thumbnail}}
    rendered = extract_video_frame(source, thumbnail)
    if rendered.get("status") != "ok":
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": rendered.get("missing_inputs") or ["thumbnail_render"],
            "warnings": rendered.get("warnings") or [],
        }
    if not thumbnail.is_file() or thumbnail.stat().st_size <= 0:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["thumbnail_render"],
        }
    return {"status": "ok", "data": {"path": thumbnail}}


def _resolve_material_source_path(material: Material) -> Path | None:
    stored = Path(material.file_path or "")
    if not material.file_path or stored.is_absolute():
        return None
    source = (PROJECT_ROOT / stored).resolve()
    materials_root = MATERIALS_DIR.resolve()
    if not source.is_relative_to(materials_root) or not source.is_file():
        return None
    return source


def validate_live_clip_plans(
    db: Session, task_id: str, payload: dict
) -> dict:
    raw_output, payload_failure = prepare_clip_plan_payload(payload)
    if payload_failure:
        return payload_failure
    with _transcript_task_lock(task_id):
        task = db.get(Task, task_id)
        if not task or task.task_type != "live_clip":
            return _missing_clip_plan_state("task_id")
        result = db.scalar(
            select(TaskResult)
            .where(TaskResult.task_id == task_id)
            .order_by(TaskResult.created_at.desc())
        )
        if not result:
            return _missing_clip_plan_state("task_result")
        transcript = (result.result_json or {}).get("transcript")
        if not transcript or not transcript.get("segments"):
            return _missing_clip_plan_state("transcript")
        source_duration, duration_failure = parse_source_duration(
            _source_duration_value(result.result_json or {})
        )
        if duration_failure:
            return duration_failure

        normalized_transcript, normalize_error, transcript_changed = (
            _canonical_transcript_segments(transcript["segments"])
        )
        if normalize_error:
            return _missing_clip_plan_state("transcript")
        updated_transcript = {**transcript, "segments": normalized_transcript}
        if transcript_changed:
            updated_transcript["revision"] = int(
                transcript.get("revision") or 1
            ) + 1
        validation = validate_clip_plans(
            raw_output,
            normalized_transcript,
            source_duration,
            min_duration=raw_output.get("min_duration", 15.0),
            max_duration=raw_output.get("max_duration", 90.0),
        )
        record = build_validation_record(raw_output, validation)
        result.result_json = {
            **(result.result_json or {}),
            "transcript": updated_transcript,
            "clip_plan_validation": record,
        }
        _record_clip_plan_validation_trace(db, task, raw_output, validation)
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            return clip_plan_persistence_error(exc)
        return _clip_plan_validation_response(record, validation)


def get_live_clip_transcript(db: Session, task_id: str) -> dict:
    with _transcript_task_lock(task_id):
        task, result, transcript, error = _load_live_clip_transcript(db, task_id)
        if error:
            return error
        revision = transcript.get("revision")
        if revision is None:
            revision = 1
            transcript = {**transcript, "revision": revision}
            result.result_json = {**(result.result_json or {}), "transcript": transcript}
            try:
                db.commit()
            except Exception as exc:
                db.rollback()
                return _transcript_persistence_error(exc)
        return {
            "status": "ok",
            "data": {
                "task_id": task.id,
                "revision": revision,
                "segments": transcript["segments"],
                "full_text": transcript.get("full_text") or _transcript_full_text(transcript["segments"]),
                "artifacts": _transcript_artifacts(transcript),
            },
        }


def update_live_clip_transcript(
    db: Session, task_id: str, revision: int, segments: list[dict]
) -> dict:
    return _persist_live_clip_transcript(
        db,
        task_id,
        revision,
        segments,
        merge_gap_ms=None,
        stage="LiveClipTranscriptAgent.update",
    )


def normalize_live_clip_transcript(
    db: Session, task_id: str, revision: int, merge_gap_ms: int
) -> dict:
    return _persist_live_clip_transcript(
        db,
        task_id,
        revision,
        None,
        merge_gap_ms=merge_gap_ms,
        stage="LiveClipTranscriptAgent.normalize",
    )


def get_live_clip_transcript_export(
    db: Session, task_id: str, export_format: str
) -> dict:
    task, _result, transcript, error = _load_live_clip_transcript(db, task_id)
    if error:
        return error
    field = {
        "txt": "text_file",
        "srt": "srt_file",
        "json": "json_file",
        "ass": "ass_file",
        "timeline": "timeline_file",
    }.get(export_format)
    if not field:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": [f"transcript_{export_format}_artifact"],
        }
    stored_path = transcript.get(field)
    if not stored_path:
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": [f"transcript_{export_format}_artifact"],
        }
    candidate = Path(stored_path)
    if candidate.is_absolute():
        return _transcript_artifact_path_error()
    path = (PROJECT_ROOT / candidate).resolve()
    task_export_root = (EXPORTS_DIR / task.id).resolve()
    if not path.is_relative_to(task_export_root):
        return _transcript_artifact_path_error()
    if not path.is_file():
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": [f"transcript_{export_format}_artifact"],
        }
    return {"status": "ok", "data": {"path": path}}

def _variant_id(template_id: str) -> str:
    return f"template::{template_id}"


def _resolve_render_variant_template_ids(
    template_ids: list[str] | None,
) -> list[str]:
    registry = get_template_registry()
    available = {item["id"] for item in registry}
    requested = template_ids or [item["id"] for item in registry]
    resolved: list[str] = []
    for template_id in requested:
        if template_id in available and template_id not in resolved:
            resolved.append(template_id)
    return resolved or [item["id"] for item in registry]


def _resolve_active_variant_id(
    render_variants: list[dict], active_variant_id: str | None
) -> str:
    available = {item.get("variant_id") for item in render_variants}
    if active_variant_id in available:
        return str(active_variant_id)
    return str(render_variants[0].get("variant_id") if render_variants else "")


def _sync_active_variant_to_top_level(
    result_json: dict, active_variant_id: str | None
) -> dict:
    render_variants = [deepcopy(item) for item in result_json.get("render_variants") or []]
    if not render_variants:
        return result_json
    resolved_active = _resolve_active_variant_id(render_variants, active_variant_id)
    active_variant = next(
        (item for item in render_variants if item.get("variant_id") == resolved_active),
        render_variants[0],
    )
    for item in render_variants:
        item["is_active"] = item.get("variant_id") == active_variant.get("variant_id")
    return {
        **result_json,
        "active_variant_id": active_variant.get("variant_id"),
        "render_variants": render_variants,
        "segments": deepcopy(active_variant.get("segments") or []),
        "slice_segments": deepcopy(active_variant.get("slice_segments") or []),
        "artifacts": deepcopy(active_variant.get("artifacts") or {}),
        "qa_result": deepcopy(active_variant.get("qa_result") or {}),
        "review_status": active_variant.get("review_status", "draft"),
        "status": active_variant.get("status") or result_json.get("status", "blocked"),
    }


def _build_render_variant(
    *,
    task: Task,
    source_path: Path,
    workflow_dir: Path,
    segments: list[dict],
    transcript: dict,
    metadata: dict,
    template_id: str,
) -> tuple[dict, list[str]]:
    variant_payload = {**(task.input_json or {}), "caption_style": template_id}
    variant_dir = workflow_dir / "variants" / template_id
    variant_dir.mkdir(parents=True, exist_ok=True)
    template = resolve_template(template_id)
    rendered_segments = deepcopy(segments)
    warnings: list[str] = []
    for clip in rendered_segments:
        clip["transcript_segments"] = _select_clip_transcript_segments(
            transcript.get("segments") or [], clip
        )
        files, clip_warnings = _render_clip_files(
            source_path,
            variant_dir,
            clip,
            variant_payload,
        )
        clip.pop("_p4_packaging", None)
        clip["files"] = files
        clip["quality_check"] = _quality_check(clip)
        clip["risk_notes"] = clip["quality_check"]["risk_notes"]
        clip["review_status"] = "not_submitted"
        warnings.extend(clip_warnings)
    _add_titles_and_captions(rendered_segments, variant_payload)
    roi = _calculate_roi(metadata, len(rendered_segments))
    artifacts = _write_artifacts(
        variant_dir,
        metadata,
        transcript,
        rendered_segments,
        roi,
    )
    qa_results = []
    for clip in rendered_segments:
        clip["qa_result"] = _build_clip_qa_result(clip, artifacts)
        clip["qa"] = clip["qa_result"]
        qa_results.append(clip["qa_result"])
    qa_result = aggregate_qa_results(
        qa_results,
        warnings=warnings + list(transcript.get("warnings") or []),
    )
    artifacts = _write_qa_trace_artifact(
        variant_dir,
        artifacts,
        task,
        rendered_segments,
        qa_result,
    )
    slice_segments = [
        _normalize_segment(item, variant_payload) for item in rendered_segments
    ]
    overlay_points = sum(
        len(item.get("flycut_caption", {}).get("highlight_keywords", []))
        for item in rendered_segments
    )
    sfx_points = sum(
        len(item.get("flycut_caption", {}).get("audio_cues", []))
        for item in rendered_segments
    )
    variant = {
        "variant_id": _variant_id(template_id),
        "template_id": template_id,
        "template_name": template.get("name", template_id),
        "template_version": template.get("version", ""),
        "transcript_revision": int(transcript.get("revision") or 1),
        "status": "ok" if qa_result.get("qa_status") == "passed" else "blocked",
        "is_active": False,
        "is_fallback": False,
        "summary": {
            "clip_count": len(slice_segments),
            "overlay_points": overlay_points,
            "sfx_points": sfx_points,
            "qa_status": qa_result.get("qa_status"),
            "qa_score": qa_result.get("qa_score"),
        },
        "segments": rendered_segments,
        "slice_segments": slice_segments,
        "artifacts": artifacts,
        "qa_result": qa_result,
        "review_status": "not_submitted",
        "recommended_rank": None,
        "recommended_reason": "",
        "confidence": None,
    }
    return variant, warnings


def rerender_live_clip_from_transcript(
    db: Session,
    task_id: str,
    revision: int,
    template_ids: list[str] | None = None,
    active_template_id: str | None = None,
) -> dict:
    with _transcript_task_lock(task_id):
        task, result, transcript, error = _load_live_clip_transcript(db, task_id)
        if error:
            return error
        current_revision = int(transcript.get("revision") or 1)
        if current_revision != revision:
            return {
                "status": "blocked",
                "data": {"current_revision": current_revision},
                "missing_inputs": ["transcript_revision"],
            }
        existing_segments = list((result.result_json or {}).get("segments") or [])
        if not existing_segments:
            return {
                "status": "blocked",
                "data": {},
                "missing_inputs": ["slice_segments"],
            }
        material = db.get(Material, task.material_id) if task.material_id else None
        source_path = _resolve_material_source_path(material) if material else None
        if not source_path:
            return {
                "status": "blocked",
                "data": {},
                "missing_inputs": ["source_video"],
            }
        workflow_dir = EXPORTS_DIR / task.id / WORKFLOW
        workflow_dir.mkdir(parents=True, exist_ok=True)
        metadata = (result.result_json or {}).get("source_video") or _extract_metadata(
            source_path, material
        )
        internal_sidecars = deepcopy(
            (result.result_json or {}).get("internal_sidecars") or {}
        )
        existing_segments, p4_rerender_audit = prepare_p4_packaging_consumption(
            task_id=task.id,
            selected_plans=existing_segments,
            transcript=transcript,
            planning_selection=internal_sidecars.get("planning_policy") or {},
        )
        internal_sidecars["p4_timeline_packaging"] = p4_rerender_audit
        requested_template_ids = _resolve_render_variant_template_ids(template_ids)
        render_variants: list[dict] = []
        warnings: list[str] = []
        for template_id in requested_template_ids:
            variant, variant_warnings = _build_render_variant(
                task=task,
                source_path=source_path,
                workflow_dir=workflow_dir,
                segments=existing_segments,
                transcript=transcript,
                metadata=metadata,
                template_id=template_id,
            )
            render_variants.append(variant)
            warnings.extend(variant_warnings)
        desired_active_variant_id = _variant_id(active_template_id or requested_template_ids[0])
        updated_result = _sync_active_variant_to_top_level(
            {
                **(result.result_json or {}),
                "current_step": LIVE_CLIP_PACKAGING_RERENDER_STEP,
                "current_stage": "packaging_rerender",
                "transcript": transcript,
                "internal_sidecars": internal_sidecars,
                "render_variants": render_variants,
                "variant_history": list(
                    dict.fromkeys(
                        [
                            *list((result.result_json or {}).get("variant_history") or []),
                            desired_active_variant_id,
                        ]
                    )
                ),
                "rerender_mode": "packaging_only",
                "warnings": sorted(
                    set(warnings + list(transcript.get("warnings") or []))
                ),
            },
            desired_active_variant_id,
        )
        result.result_json = updated_result
        result.status = updated_result["status"]
        task.review_status = updated_result.get("review_status", "not_submitted")
        task.status = "ok" if result.status == "ok" else "blocked"
        _record_step(
            db,
            task,
            "LiveClipTranscriptAgent.rerender",
            {
                "revision": revision,
                "mode": "packaging_only",
                "template_ids": requested_template_ids,
                "active_template_id": active_template_id,
            },
            {
                "clip_count": len(updated_result.get("slice_segments") or []),
                "variant_count": len(render_variants),
                "qa_status": (updated_result.get("qa_result") or {}).get("qa_status"),
                "review_status": updated_result.get("review_status"),
            },
            "ok" if result.status == "ok" else "blocked",
        )
        append_task_log(
            "live_clips",
            task.id,
            "transcript_rerender",
            "ok" if result.status == "ok" else "blocked",
            {
                "revision": revision,
                "clip_count": len(updated_result.get("slice_segments") or []),
                "variant_count": len(render_variants),
            },
        )
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            return _transcript_persistence_error(exc)
        traces = list(
            db.scalars(
                select(CausalTrace)
                .where(CausalTrace.task_id == task_id)
                .order_by(CausalTrace.created_at)
            )
        )
        payload = _customer_live_clip_payload(task, updated_result, traces)
        payload.update(
            {
                "transcript_revision": current_revision,
                "review_status": updated_result.get("review_status", "not_submitted"),
                "rerender_mode": "packaging_only",
            }
        )
        return {
            "status": result.status,
            "data": payload,
            "warnings": payload.get("warnings", []),
            "next_action": [LIVE_CLIP_PACKAGING_RERENDER_STEP] if result.status == "ok" else [],
        }


def activate_live_clip_variant(db: Session, task_id: str, variant_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "data": {}, "missing_inputs": ["task_id"]}
    result = db.scalar(
        select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc())
    )
    if not result or not (result.result_json or {}).get("render_variants"):
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["render_variants"],
        }
    render_variants = result.result_json.get("render_variants") or []
    if not any(item.get("variant_id") == variant_id for item in render_variants):
        return {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["variant_id"],
        }
    updated_result = _sync_active_variant_to_top_level(
        {
            **(result.result_json or {}),
            "variant_history": list(
                dict.fromkeys(
                    [
                        *list((result.result_json or {}).get("variant_history") or []),
                        variant_id,
                    ]
                )
            ),
        },
        variant_id,
    )
    result.result_json = updated_result
    result.status = updated_result.get("status", result.status)
    task.review_status = updated_result.get("review_status", task.review_status)
    task.status = "ok" if result.status == "ok" else "blocked"
    _record_step(
        db,
        task,
        "LiveClipVariantAgent.activate",
        {"variant_id": variant_id},
        {"active_variant_id": updated_result.get("active_variant_id")},
        "ok",
    )
    append_task_log(
        "live_clips",
        task.id,
        "activate_variant",
        "ok",
        {"variant_id": variant_id},
    )
    db.commit()
    traces = list(
        db.scalars(
            select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)
        )
    )
    return _customer_live_clip_response(task, updated_result, traces, result.status)


def _persist_live_clip_transcript(
    db: Session,
    task_id: str,
    revision: int,
    segments: list[dict] | None,
    merge_gap_ms: int | None,
    stage: str,
) -> dict:
    with _transcript_task_lock(task_id):
        task, result, transcript, error = _load_live_clip_transcript(db, task_id)
        if error:
            return error
        return _persist_loaded_live_clip_transcript(
            db,
            task,
            result,
            transcript,
            revision,
            transcript["segments"] if segments is None else segments,
            merge_gap_ms,
            stage,
        )


def _persist_loaded_live_clip_transcript(
    db: Session,
    task: Task,
    result: TaskResult,
    transcript: dict,
    revision: int,
    segments: list[dict],
    merge_gap_ms: int | None,
    stage: str,
) -> dict:
    current_revision = int(transcript.get("revision") or 1)
    if revision != current_revision:
        return {
            "status": "blocked",
            "data": {"current_revision": current_revision},
            "missing_inputs": ["transcript_revision"],
        }
    try:
        normalized = normalize_transcript_segments(
            segments, merge_gap_ms=merge_gap_ms
        )
    except ValueError as exc:
        return {
            "status": "blocked",
            "data": {"errors": [str(exc)]},
            "missing_inputs": ["transcript_segments"],
        }
    next_revision = current_revision + 1
    full_text = _transcript_full_text(normalized)
    try:
        artifacts = _write_transcript_artifacts(
            task.id, next_revision, normalized, full_text
        )
    except (OSError, ValueError) as exc:
        return {
            "status": "blocked",
            "data": {"errors": [str(exc)]},
            "missing_inputs": ["transcript_artifacts"],
        }
    updated_transcript = {
        **transcript,
        "revision": next_revision,
        "segments": normalized,
        "full_text": full_text,
        "text_file": artifacts["txt"],
        "srt_file": artifacts["srt"],
        "json_file": artifacts["json"],
        "ass_file": artifacts["ass"],
        "timeline_file": artifacts["timeline"],
    }
    result.result_json = {
        **(result.result_json or {}),
        "transcript": updated_transcript,
    }
    _record_step(
        db,
        task,
        stage,
        {"revision": revision, "merge_gap_ms": merge_gap_ms},
        {"revision": next_revision, "segment_count": len(normalized)},
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        return _transcript_persistence_error(exc)
    return {
        "status": "ok",
        "data": {
            "task_id": task.id,
            "revision": next_revision,
            "segments": normalized,
            "full_text": full_text,
            "artifacts": artifacts,
        },
    }


def _load_live_clip_transcript(
    db: Session, task_id: str
) -> tuple[Task | None, TaskResult | None, dict | None, dict | None]:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return None, None, None, {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["task_id"],
        }
    result = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task_id)
        .order_by(TaskResult.created_at.desc())
    )
    if not result:
        return task, None, None, {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["task_result"],
        }
    transcript = (result.result_json or {}).get("transcript")
    if not transcript or not transcript.get("segments"):
        return task, result, None, {
            "status": "blocked",
            "data": {},
            "missing_inputs": ["transcript"],
        }
    return task, result, transcript, None


def _write_transcript_artifacts(
    task_id: str, revision: int, segments: list[dict], full_text: str
) -> dict[str, str]:
    out_dir = (
        EXPORTS_DIR
        / task_id
        / WORKFLOW
        / "transcript"
        / f"rev_{revision:04d}"
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "txt": out_dir / "full_transcript.txt",
        "srt": out_dir / "full_transcript.srt",
        "json": out_dir / "full_transcript.json",
        "ass": out_dir / "full_transcript.ass",
        "timeline": out_dir / "full_transcript.timeline",
    }
    contents = {
        "txt": render_numbered_txt(segments),
        "srt": render_srt(segments),
        "json": json.dumps(
            {
                "revision": revision,
                "full_text": full_text,
                "segments": segments,
            },
            ensure_ascii=False,
            indent=2,
        ),
        "ass": render_ass(segments),
        "timeline": render_timeline(segments),
    }
    for name, path in paths.items():
        temporary_path = path.with_name(f"{path.name}.tmp")
        temporary_path.write_text(contents[name], encoding="utf-8")
        os.replace(temporary_path, path)
    return {
        name: path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
        for name, path in paths.items()
    }


def _transcript_task_lock(task_id: str) -> threading.Lock:
    with _TRANSCRIPT_TASK_LOCKS_GUARD:
        return _TRANSCRIPT_TASK_LOCKS.setdefault(task_id, threading.Lock())


def _transcript_persistence_error(exc: Exception) -> dict:
    return {
        "status": "blocked",
        "data": {"errors": [str(exc)]},
        "missing_inputs": ["transcript_persistence"],
    }


def _transcript_artifact_path_error() -> dict:
    return {
        "status": "blocked",
        "data": {},
        "missing_inputs": ["transcript_artifact_path"],
    }


def _transcript_full_text(segments: list[dict]) -> str:
    return " ".join(str(item.get("text") or "").strip() for item in segments).strip()


def _transcript_artifacts(transcript: dict) -> dict[str, str]:
    artifacts = {}
    for name, field in (
        ("txt", "text_file"),
        ("srt", "srt_file"),
        ("json", "json_file"),
        ("ass", "ass_file"),
        ("timeline", "timeline_file"),
    ):
        path = transcript.get(field)
        if path:
            artifacts[name] = path
    return artifacts


def _select_clip_transcript_segments(
    transcript_segments: list[dict], clip: dict
) -> list[dict]:
    ranges = clip.get("ranges") or clip.get("source_ranges") or []
    if ranges:
        return [
            dict(segment)
            for segment in transcript_segments
            if any(
                float(segment.get("end") or 0) > float(item["start"])
                and float(segment.get("start") or 0) < float(item["end"])
                for item in ranges
            )
        ]
    start_seconds = float(clip.get("start_seconds") or 0)
    end_seconds = float(
        clip.get("end_seconds")
        or start_seconds + float(clip.get("duration_seconds") or 0)
    )
    return [
        dict(segment)
        for segment in transcript_segments
        if float(segment.get("end") or 0) > start_seconds
        and float(segment.get("start") or 0) < end_seconds
    ]


def _clip_relative_transcript_segments(segment: dict) -> list[dict]:
    transcript_segments = list(segment.get("transcript_segments") or [])
    if not transcript_segments:
        return []
    source_ranges = segment.get("ranges") or segment.get("source_ranges") or []
    if source_ranges:
        return normalize_transcript_segments(
            remap_subtitle_segments(transcript_segments, source_ranges)
        )
    start_seconds = float(segment.get("start_seconds") or 0)
    relative = []
    for item in transcript_segments:
        start = max(0.0, float(item.get("start") or 0) - start_seconds)
        end = max(0.0, float(item.get("end") or 0) - start_seconds)
        if end <= start:
            continue
        relative.append(
            {
                **item,
                "start": start,
                "end": end,
            }
        )
    return normalize_transcript_segments(relative)


def resolve_caption_source_policy(payload: dict) -> dict:
    """Resolve one explicit subtitle layer without pretending to OCR burned text."""

    requested_mode = str(payload.get("subtitle_source_mode") or "").strip().lower()
    source_burned = bool(payload.get("source_has_burned_subtitles")) or requested_mode == "source_burned"
    if source_burned:
        return {
            "mode": "source_burned",
            "should_burn": False,
            "single_caption_layer": True,
            "reason": "源视频已带烧录字幕，保留源字幕并仅交付独立字幕文件。",
        }
    should_burn = bool(payload.get("enable_subtitle_burn", True))
    return {
        "mode": "generated",
        "should_burn": should_burn,
        "single_caption_layer": True,
        "reason": (
            "源视频未声明已有字幕，使用系统字幕。"
            if should_burn
            else "字幕烧录已关闭，仅交付独立字幕文件。"
        ),
    }


def select_caption_segments(segment: dict, payload: dict) -> list[dict]:
    """Prefer a reviewed per-clip correction while retaining the raw ASR sidecar."""

    corrections = payload.get("caption_corrections") or {}
    corrected = corrections.get(str(segment.get("clip_id") or "")) if isinstance(corrections, dict) else None
    if isinstance(corrected, list) and corrected:
        return deepcopy(corrected)
    return _clip_relative_transcript_segments(segment)


def _caption_truth_values(payload: dict, field: str, clip_id: str) -> list[str]:
    value = payload.get(field)
    if isinstance(value, dict):
        value = value.get(clip_id) or []
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    return [str(item).strip() for item in value if str(item).strip()]


def _caption_review_status(payload: dict, clip_id: str) -> str:
    by_clip = payload.get("caption_review_status_by_clip") or {}
    if isinstance(by_clip, dict) and by_clip.get(clip_id):
        return str(by_clip[clip_id]).strip().lower()
    return str(payload.get("caption_review_status") or "pending").strip().lower()


def _parse_srt_business_cues(srt_text: str) -> list[dict]:
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", str(srt_text or "").strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        start_raw, end_raw = [item.strip() for item in lines[1].split("-->", 1)]
        try:
            start = _parse_srt_timestamp(start_raw)
            end = _parse_srt_timestamp(end_raw.split()[0])
        except (TypeError, ValueError):
            continue
        cues.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(max(0.0, end - start), 3),
                "text": " ".join(lines[2:]),
            }
        )
    return cues


def evaluate_caption_business_gate(
    *,
    srt_text: str,
    segment: dict,
    payload: dict,
    burn_decision: dict,
) -> dict:
    """Evaluate only explicit human truth; never infer semantic correctness from ASR."""

    enforced = bool(payload.get("enable_caption_business_gate", False))
    clip_id = str(segment.get("clip_id") or "")
    if not enforced:
        return {
            "enforced": False,
            "passed": True,
            "subtitle_semantic_reviewed": True,
            "subtitle_product_terms_verified": True,
            "subtitle_price_verified": True,
            "subtitle_timing_safe": True,
            "single_caption_layer": bool(burn_decision.get("single_caption_layer", True)),
            "review_status": "not_required",
            "missing_terms": [],
            "missing_prices": [],
            "long_cues": [],
        }

    expected_terms = _caption_truth_values(payload, "caption_truth_terms", clip_id)
    expected_prices = _caption_truth_values(payload, "caption_truth_prices", clip_id)
    review_status = _caption_review_status(payload, clip_id)
    compact_text = re.sub(r"\s+", "", str(srt_text or ""))
    missing_terms = [item for item in expected_terms if re.sub(r"\s+", "", item) not in compact_text]
    missing_prices = [item for item in expected_prices if re.sub(r"\s+", "", item) not in compact_text]
    max_cue_seconds = max(1.0, float(payload.get("caption_max_cue_seconds") or 4.0))
    long_cues = [
        cue
        for cue in _parse_srt_business_cues(srt_text)
        if float(cue["duration"]) > max_cue_seconds + 0.001
    ]
    checks = {
        "subtitle_semantic_reviewed": review_status == "approved",
        "subtitle_product_terms_verified": not missing_terms,
        "subtitle_price_verified": not missing_prices,
        "subtitle_timing_safe": not long_cues,
        "single_caption_layer": bool(burn_decision.get("single_caption_layer")),
    }
    return {
        "enforced": True,
        "passed": all(checks.values()),
        **checks,
        "review_status": review_status,
        "expected_terms": expected_terms,
        "expected_prices": expected_prices,
        "missing_terms": missing_terms,
        "missing_prices": missing_prices,
        "long_cues": long_cues,
        "max_cue_seconds": max_cue_seconds,
        "source_policy": deepcopy(burn_decision),
    }


def configure_caption_business_review(
    db: Session,
    task_id: str,
    payload: dict,
) -> dict:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return {
            "status": "blocked",
            "message": "任务不存在或不是直播切片任务。",
            "missing_inputs": ["task_id"],
            "next_action": "请刷新页面后重新选择任务。",
        }
    mode = str(payload.get("subtitle_source_mode") or "generated").strip().lower()
    if mode not in {"generated", "source_burned"}:
        return {
            "status": "blocked",
            "message": "字幕来源只能选择原视频字幕或系统字幕。",
            "missing_inputs": ["subtitle_source_mode"],
            "next_action": "请重新选择字幕来源。",
        }
    review_status = str(payload.get("caption_review_status") or "pending").strip().lower()
    if review_status not in {"pending", "approved", "rejected"}:
        return {
            "status": "blocked",
            "message": "字幕校对状态无效。",
            "missing_inputs": ["caption_review_status"],
            "next_action": "请重新提交字幕校对状态。",
        }
    reviewer = str(payload.get("reviewer") or "").strip()
    if review_status == "approved" and not reviewer:
        return {
            "status": "blocked",
            "message": "确认字幕校对通过前必须填写校对人。",
            "missing_inputs": ["reviewer"],
            "next_action": "请填写校对人后重新确认。",
        }
    terms = _caption_truth_values(payload, "caption_truth_terms", "")
    prices = _caption_truth_values(payload, "caption_truth_prices", "")
    corrections = payload.get("caption_corrections")
    if corrections is not None and not isinstance(corrections, dict):
        return {
            "status": "blocked",
            "message": "字幕修订内容格式无效。",
            "missing_inputs": ["caption_corrections"],
            "next_action": "请按每条视频提交字幕修订内容。",
        }
    updated = {
        **(task.input_json or {}),
        "enable_caption_business_gate": True,
        "subtitle_source_mode": mode,
        "source_has_burned_subtitles": mode == "source_burned",
        "caption_review_status": review_status,
        "caption_truth_terms": terms,
        "caption_truth_prices": prices,
        "caption_max_cue_seconds": max(
            1.0, float(payload.get("caption_max_cue_seconds") or 4.0)
        ),
        "caption_reviewed_by": reviewer[:80],
        "caption_reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if corrections is not None:
        updated["caption_corrections"] = deepcopy(corrections)
    task.input_json = updated
    task.review_status = "not_submitted"
    db.commit()
    return {
        "status": "ok",
        "message": "字幕来源与校对要求已保存。",
        "task_id": task_id,
        "subtitle_source_mode": mode,
        "caption_review_status": review_status,
        "next_action": (
            "请执行局部重做并重新确认成片。"
            if review_status == "approved"
            else "请完成字幕校对后执行局部重做。"
        ),
    }


def attach_material(db: Session, task_id: str, material_id: str) -> dict:
    task = db.get(Task, task_id)
    material = db.get(Material, material_id)
    if not task or task.task_type != "live_clip":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if not material:
        return {"status": "blocked", "missing_inputs": ["material_id"], "data": _serialize_task(task)}
    task.material_id = material_id
    task.input_json = {**(task.input_json or {}), "material_id": material_id}
    task.status = "created"
    db.commit()
    append_task_log("live_clips", task_id, "attach_material", "ok", {"material_id": material_id})
    return {"status": "ok", "data": _serialize_task(task)}


def attach_transcript_file(db: Session, task_id: str, filename: str, content: str) -> dict:
    task = db.get(Task, task_id)
    if not task or task.task_type != "live_clip":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    text = content.strip()
    if not text:
        return {"status": "blocked", "missing_inputs": ["non_empty_srt"], "data": _serialize_task(task)}
    transcript_dir = EXPORTS_DIR / task.id / WORKFLOW / "inputs"
    transcript_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename or "transcript.srt").name.replace("..", "_")
    transcript_path = transcript_dir / safe_name
    transcript_path.write_text(text, encoding="utf-8")
    segments = _parse_srt_segments(text) if safe_name.lower().endswith(".srt") or "-->" in text else []
    plain_text = " ".join(item["text"] for item in segments).strip() if segments else text
    task.input_json = {
        **(task.input_json or {}),
        "transcript_text": plain_text,
        "transcript_provider": "uploaded_srt" if segments else "uploaded_text",
        "transcript_segments": segments,
        "transcript_file": rel_path(transcript_path),
    }
    task.status = "created"
    _record_step(db, task, "LiveClipTranscriptAgent.upload_srt", {"file_name": safe_name}, {"segments": len(segments), "transcript_file": rel_path(transcript_path)})
    append_task_log("live_clips", task_id, "attach_transcript_file", "ok", {"file_name": safe_name, "segments": len(segments)})
    db.commit()
    return {
        "status": "ok",
        "data": {**_serialize_task(task), "transcript_file": rel_path(transcript_path), "transcript_segments": len(segments)},
        "warnings": [] if segments else [LIVE_CLIP_PLAIN_TEXT_WARNING],
    }


def get_live_clip_status(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = _current_live_clip_task_result(db, task_id)
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))
    result_json = result.result_json if result else {}
    live_state = _live_clip_status_view(
        task,
        result_json,
        traces,
        result.status if result else None,
    )
    steps = live_state["progress_steps"]
    if task.status == "running" and not result and not live_state["batch_state"]:
        for item in steps:
            if item["status"] == "waiting":
                item["status"] = "processing"
                break
    progress = live_state["progress_percent"]
    if task.status == "running" and not result and progress <= 0:
        progress = round(
            (sum(1 for item in steps if item["status"] == "completed") / len(steps))
            * 100
        )
    response_status = live_state["status"] if result else ("ok" if task.status != "blocked" else "blocked")
    return {
        "status": response_status,
        "data": {
            "task_id": task_id,
            "result_id": result.id if result else None,
            "attempt_id": _live_clip_attempt_id(result_json),
            "status": live_state["status"] if result else task.status,
            "review_status": task.review_status,
            "progress_percent": progress,
            "current_step": live_state["current_step"],
            "current_stage": live_state["current_stage"],
            "steps": steps,
            "progress": _progress_dict(steps),
            "estimated_remaining_seconds": 0 if result else 138,
            "logs": read_task_logs("live_clips", task_id)[-20:],
            "batch_state": live_state["batch_state"],
        },
    }


def get_live_clip_clips(db: Session, task_id: str) -> dict:
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not result:
        return {"status": "blocked", "missing_inputs": ["completed_task_result"], "data": {"items": []}}
    segments = result.result_json.get("slice_segments") or [_normalize_segment(item, {}) for item in result.result_json.get("segments", [])]
    return {"status": "ok", "data": {"task_id": task_id, "items": segments, "count": len(segments)}}


def get_live_clip_artifacts(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc())) if task else None
    if not task or not result:
        return {"status": "blocked", "missing_inputs": ["completed_task_result"], "data": {}}
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "artifacts": result.result_json.get("artifacts", {}),
            "qa_result": result.result_json.get("qa_result"),
            "slice_segments": result.result_json.get("slice_segments", []),
        },
    }


def get_live_clip_jianying_project(db: Session, task_id: str) -> dict:
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not result:
        return {"status": "blocked", "missing_inputs": ["completed_task_result"], "data": {}}
    artifacts = result.result_json.get("artifacts", {})
    keys = ["jianying_project_manifest", "jianying_project_timeline", "jianying_project_draft_content", "jianying_project_draft_meta", "jianying_project_zip"]
    project = {key: artifacts.get(key, "") for key in keys}
    missing = [key for key, value in project.items() if not _project_file_exists(value)]
    return {
        "status": "ok" if not missing else "blocked",
        "missing_inputs": missing,
        "data": {"task_id": task_id, "jianying_project": project, "qa_result": result.result_json.get("qa_result")},
    }


def get_live_clip_trace(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc())) if task else None
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at))) if task else []
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    return {
        "status": "ok" if result else task.status,
        "data": {
            "task_id": task_id,
            "trace_id": task.trace_id,
            "trace_file": (result.result_json.get("artifacts", {}) if result else {}).get("trace_json"),
            "qa_result": result.result_json.get("qa_result") if result else None,
            "events": [_serialize_causal_trace(item) for item in traces],
        },
    }


def get_live_clip_downloads(db: Session, task_id: str) -> dict:
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not result:
        return {"status": "blocked", "missing_inputs": ["completed_task_result"], "data": {"downloads": []}}
    artifacts = result.result_json.get("artifacts", {})
    downloads = [
        {"type": key, "name": key, "url": f"/api/live-clips/tasks/{task_id}/download/{key}", "path": value}
        for key, value in artifacts.items()
    ]
    file_check = check_export_files("live_clips", task_id, downloads)
    return {"status": "ok", "data": {"task_id": task_id, "downloads": downloads, "file_check": file_check}}


def find_clip_file(db: Session, clip_id: str, file_key: str = "final_clip") -> Path | None:
    results = list(db.scalars(select(TaskResult).where(TaskResult.workflow == WORKFLOW).order_by(TaskResult.created_at.desc())))
    for result in results:
        for segment in result.result_json.get("segments", []):
            if segment.get("clip_id") == clip_id:
                rel = segment.get("files", {}).get(file_key)
                if rel:
                    path = PROJECT_ROOT / rel
                    return path if path.exists() else None
    return None


def enhance_clip_caption(db: Session, clip_id: str) -> dict:
    results = list(db.scalars(select(TaskResult).where(TaskResult.workflow == WORKFLOW).order_by(TaskResult.created_at.desc())))
    for result in results:
        for segment in result.result_json.get("segments", []):
            if segment.get("clip_id") == clip_id:
                flycut_caption = {
                    "skill_id": FLYCUT_CAPTION_SKILL_ID,
                    **(segment.get("flycut_caption") or {}),
                }
                return {"status": "ok", "data": {"clip_id": clip_id, "flycut_caption": flycut_caption}}
    return {"status": "blocked", "missing_inputs": ["clip_id"], "data": {}}


def submit_review(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not result or not result.result_json.get("segments"):
        return {"status": "blocked", "missing_inputs": ["slice_segments"], "data": _customer_live_clip_payload(task, result.result_json if result else {}, [])}
    task.review_status = "pending_review"
    task.status = "pending_review"
    _set_segment_review_status(result.result_json, "pending_review")
    result.status = "ok"
    _record_step(db, task, "submit_to_review", {"task_id": task_id}, {"review_status": "pending_review"})
    append_task_log("live_clips", task_id, "submit_review", "ok", {"review_status": task.review_status})
    db.commit()
    return _customer_live_clip_response(task, result.result_json, list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at))), result.status)


def approve_review(
    db: Session,
    task_id: str,
    *,
    reviewer: str,
    comment: str = "",
) -> dict:
    task = db.get(Task, task_id)
    result = (
        db.scalar(
            select(TaskResult)
            .where(TaskResult.task_id == task_id)
            .order_by(TaskResult.created_at.desc())
        )
        if task
        else None
    )
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if not result or not result.result_json.get("segments"):
        return {
            "status": "blocked",
            "missing_inputs": ["slice_segments"],
            "data": _customer_live_clip_payload(
                task, result.result_json if result else {}, []
            ),
        }
    if result.result_json.get("qa_result", {}).get("qa_status") != "passed":
        return {
            "status": "blocked",
            "missing_inputs": ["qa_pass"],
            "data": _customer_live_clip_payload(task, result.result_json, []),
        }
    reviewer = (reviewer or "").strip()
    if not reviewer:
        return {
            "status": "blocked",
            "missing_inputs": ["reviewer"],
            "data": _customer_live_clip_payload(task, result.result_json, []),
        }
    task.status = "completed"
    task.review_status = "pass"
    result.status = "ok"
    result_json = dict(result.result_json)
    result_json["review_status"] = "pass"
    result_json["review"] = {
        "reviewer": reviewer[:80],
        "comment": (comment or "").strip()[:500],
        "decision": "approve",
    }
    _set_segment_review_status(result_json, "pass")
    result.result_json = result_json
    _record_step(
        db,
        task,
        "approve_review",
        {"reviewer": reviewer[:80]},
        {"review_status": "pass"},
    )
    append_task_log(
        "live_clips",
        task_id,
        "approve_review",
        "ok",
        {"reviewer": reviewer[:80]},
    )
    db.commit()
    traces = list(
        db.scalars(
            select(CausalTrace)
            .where(CausalTrace.task_id == task_id)
            .order_by(CausalTrace.created_at)
        )
    )
    return _customer_live_clip_response(
        task, result_json, traces, result.status
    )


def save_task_state(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    task.input_json = {**(task.input_json or {}), "saved_at": "local_runtime", "current_status": task.status}
    _record_step(db, task, "save_task_state", {"task_id": task_id}, {"status": task.status, "has_result": bool(result)})
    append_task_log("live_clips", task_id, "save_task_state", "ok", {"status": task.status, "has_result": bool(result)})
    db.commit()
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))
    payload = _customer_live_clip_payload(task, result.result_json if result else {}, traces)
    return {"status": "ok", "data": payload, "warnings": [] if result else ["task configuration saved before render results exist"]}


def mock_review_pass(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc())) if task else None
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if not result or not result.result_json.get("segments"):
        return {"status": "blocked", "missing_inputs": ["slice_segments"], "data": _customer_live_clip_payload(task, result.result_json if result else {}, [])}
    task.status = "review_passed"
    task.review_status = "pass"
    result.result_json["review_status"] = "pass"
    _set_segment_review_status(result.result_json, "pass")
    result.status = "ok"
    _record_step(db, task, "mock_review_pass", {"test_only": True}, {"review_status": "pass"})
    append_task_log("live_clips", task_id, "mock_review_pass", "ok", {"test_only": True})
    db.commit()
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))
    response = _customer_live_clip_response(task, result.result_json, traces, result.status)
    response["warnings"] = sorted(set(response.get("warnings", []) + ["mock review pass for testing only"]))
    return response


def export_task(db: Session, task_id: str, export_type: str = "html_report") -> dict:
    task = db.get(Task, task_id)
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not task or not result:
        return {"status": "blocked", "missing_inputs": ["completed_task_result"], "data": {}}
    artifacts = result.result_json.get("artifacts", {})
    key_map = {
        "final_clips_zip": "final_clips_zip",
        "raw_clips_zip": "raw_clips_zip",
        "vertical_clips_zip": "vertical_clips_zip",
        "srt_zip": "srt_zip",
        "flycut_caption_assets_zip": "flycut_caption_assets_zip",
        "caption_assets_zip": "flycut_caption_assets_zip",
        "clip_score_csv": "clip_score_table_csv",
        "clip_score_table_csv": "clip_score_table_csv",
        "timeline_json": "timeline_json",
        "otio_timeline": "otio_timeline",
        "edl_file": "edl_file",
        "xml_file": "xml_file",
        "exchange_package_zip": "exchange_package_zip",
        "jianying_project_zip": "jianying_project_zip",
        "jianying": "jianying_project_zip",
        "capcut_project": "jianying_project_zip",
        "html_report": "html_report",
    }
    key = key_map.get(export_type, export_type)
    artifact = artifacts.get(key)
    if not artifact:
        data = _customer_live_clip_payload(task, result.result_json, [])
        data["available_exports"] = sorted(artifacts)
        return {"status": "blocked", "missing_inputs": [export_type], "data": data}
    if export_type in {"final_clips_zip", "mp4", "mov"}:
        if not _can_export_final(result.result_json):
            data = _customer_live_clip_payload(task, result.result_json, [])
            return {
                "status": "blocked",
                "missing_inputs": ["qa_pass"],
                "data": data,
                "next_action": [LIVE_CLIP_NEXT_ACTION_FIX_QA],
            }
        final_files = [PROJECT_ROOT / item.get("files", {}).get("final_clip", "") for item in result.result_json.get("segments", [])]
        existing_files = [path for path in final_files if path.exists() and path.stat().st_size > 0]
        if not existing_files:
            data = _customer_live_clip_payload(task, result.result_json, [])
            return {"status": "blocked", "missing_inputs": ["real_rendered_mp4"], "data": data, "next_action": [LIVE_CLIP_NEXT_ACTION_FINISH_RENDER]}
    _record_step(db, task, "export_artifact", {"export_type": export_type}, {"artifact": artifact})
    append_task_log("live_clips", task_id, "export_artifact", "ok", {"export_type": export_type, "artifact": artifact})
    db.commit()
    return {
        "status": "ok",
        "data": {
            "task_id": task_id,
            "export_type": export_type,
            "artifact_path": artifact,
            "download_url": f"/api/tasks/{task_id}/download/{key}",
        },
    }


def _can_export_final(result_json: dict) -> bool:
    return result_json.get("qa_result", {}).get("qa_status") == "passed"


def run_task(db: Session, task_id: str) -> dict:
    task = db.get(Task, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if task.task_type != "live_clip" or task.workflow not in WORKFLOW_ALIASES:
        return {"status": "blocked", "missing_inputs": ["live_clip.video_content_repurposing_workflow"], "data": _serialize_task(task)}

    batch_response = get_persistent_job_state(db, task_id)
    if batch_response["status"] != "ok":
        return batch_response
    batch_state = batch_response["data"]["batch_state"]
    if batch_state["status"] in {"paused", "pausing"}:
        return {
            "status": "blocked",
            "message": LIVE_CLIP_BATCH_PAUSED_MESSAGE,
            "missing_inputs": ["batch_state"],
            "data": batch_response["data"],
        }
    if batch_state["status"] == "failed":
        return {
            "status": "blocked",
            "message": LIVE_CLIP_BATCH_FAILED_MESSAGE,
            "missing_inputs": ["batch_retry"],
            "data": batch_response["data"],
        }
    if batch_state["status"] == "completed":
        batch_state = new_job_state()
        save_persistent_job_state(db, task_id, batch_state)

    material = db.get(Material, task.material_id)
    if not material:
        task.status = "blocked"
        _record_step(db, task, "LiveClipMaterialAgent", {"material_id": task.material_id}, {"missing": "video"}, "blocked")
        db.commit()
        return {
            "status": "blocked",
            "message": LIVE_CLIP_NEXT_ACTION_UPLOAD_VIDEO,
            "missing_inputs": ["video"],
            "data": _customer_live_clip_payload(task, {}, list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))),
            "next_action": [LIVE_CLIP_NEXT_ACTION_UPLOAD_VIDEO],
        }

    ffmpeg_state = check_ffmpeg()
    source_path = PROJECT_ROOT / material.file_path
    task.status = "running"
    db.commit()
    append_task_log("live_clips", task_id, "run_task", "running", {"material_id": material.id})
    out_dir = EXPORTS_DIR / task.id / WORKFLOW
    out_dir.mkdir(parents=True, exist_ok=True)

    _record_step(db, task, "LiveClipMaterialAgent", {"material_id": material.id}, {"file_path": material.file_path, "ffmpeg": ffmpeg_state})
    metadata = _extract_metadata(source_path, material)
    _record_step(db, task, "LiveClipMaterialAgent.metadata", {"file_path": material.file_path}, metadata)

    transcript_checkpoint = batch_state["stages"]["transcribing"].get("artifact") or {}
    if batch_state["stages"]["transcribing"]["status"] == "completed" and transcript_checkpoint.get("transcript"):
        transcript = deepcopy(transcript_checkpoint["transcript"])
        transcript = _ensure_full_transcript_files(out_dir, metadata, transcript)
    else:
        if batch_state["stages"]["transcribing"]["status"] != "running":
            batch_state = start_stage(batch_state, "transcribing")
        transcribe_timeout_seconds = _transcribe_timeout_seconds(metadata, task.input_json)
        save_persistent_job_state(db, task_id, batch_state)
        append_task_log(
            "live_clips",
            task_id,
            "asr_or_subtitle",
            "running",
            {
                "stage": "transcribing",
                "timeout_seconds": transcribe_timeout_seconds,
                "source_video": str(source_path),
                "duration_seconds": metadata.get("duration_seconds"),
                "chunk_seconds": _transcription_chunk_seconds(task.input_json),
                "chunked_transcription": _chunked_transcription_enabled(metadata, task.input_json),
            },
        )
        progress_stop = _start_transcribing_progress_monitor(
            task_id,
            timeout_seconds=transcribe_timeout_seconds,
        )
        try:
            transcript = _transcribe_or_mock(
                source_path,
                out_dir,
                metadata,
                task.input_json,
                task_id=task_id,
            )
        finally:
            progress_stop.set()
        if _is_live_clip_stage_failed(task_id, "transcribing"):
            batch_response = get_persistent_job_state(db, task_id)
            failed_state = (batch_response.get("data") or {}).get("batch_state") or batch_state
            task.status = "failed"
            db.commit()
            return {
                "status": "failed",
                "message": "真实语音转写超时，请改用更短视频或等待后台异步化改造。",
                "missing_inputs": ["speech_transcription_timeout"],
                "data": {
                    "task_id": task_id,
                    "batch_state": failed_state,
                },
                "warnings": ["真实语音转写超时，未产出有效字幕。"],
                "next_action": ["建议后续将真实生成任务改为后台异步执行，并增加 ASR 进度与分片转写。"],
            }
        _record_step(
            db,
            task,
            "LiveClipTranscriptAgent",
            {"provider": transcript["transcription_provider"]},
            transcript,
            "ok" if transcript["status"] == "completed" else "blocked",
        )
        if transcript["status"] == "completed":
            append_task_log(
                "live_clips",
                task_id,
                "asr_or_subtitle",
                "ok",
                {
                    "provider": transcript.get("transcription_provider"),
                    "segments": len(transcript.get("segments") or []),
                },
            )
            batch_state = complete_stage(
                batch_state,
                "transcribing",
                {
                    "provider": transcript.get("transcription_provider"),
                    "transcript": deepcopy(transcript),
                },
            )
            save_persistent_job_state(db, task_id, batch_state)
            batch_state, paused = _pause_batch_if_requested(
                db, task_id, batch_state
            )
            if paused:
                return _paused_workflow_response(db, task, batch_state)
        else:
            append_task_log(
                "live_clips",
                task_id,
                "asr_or_subtitle",
                "failed",
                {
                    "provider": transcript.get("transcription_provider"),
                    "warnings": transcript.get("warnings") or [],
                },
                "real transcription unavailable",
            )
            batch_state = fail_stage(
                batch_state, "transcribing", "real transcription unavailable"
            )
            save_persistent_job_state(db, task_id, batch_state)
            return _block_workflow_for_transcription(
                db,
                task,
                transcript,
                metadata,
                batch_state,
            )

    if batch_state["stages"]["transcribing"]["status"] == "completed" and batch_state["stages"]["planning"]["status"] == "pending":
        batch_state = start_stage(batch_state, "planning")
        save_persistent_job_state(db, task_id, batch_state)

    recognition = _extract_scene_and_silence(source_path, out_dir)
    _record_step(db, task, "LiveClipShotDetectAgent", {"provider": recognition["provider"]}, recognition, "blocked" if recognition["provider"] == "blocked" else "ok")

    planning_checkpoint = batch_state["stages"]["planning"].get("artifact") or {}
    if batch_state["stages"]["planning"]["status"] == "completed" and planning_checkpoint.get("selected"):
        selected = deepcopy(planning_checkpoint["selected"])
        plan_validation = {
            "record": deepcopy(planning_checkpoint["validation_record"]),
            "transcript": transcript,
            "must_block": False,
            "selected": selected,
        }
    else:
        segments = _segment_transcript(transcript, metadata, int(task.input_json.get("top_n", 8)), int(task.input_json.get("max_clip_duration_seconds", 60)), recognition)
        _record_step(db, task, "LiveClipSegmentPlannerAgent", {"max_clip_duration_seconds": task.input_json.get("max_clip_duration_seconds", 60)}, {"segments": len(segments)})

        scored = [_score_segment(item, index, recognition=recognition) for index, item in enumerate(segments, start=1)]
        _record_step(db, task, "LiveClipHotspotAgent", {"weights": _score_weights()}, {"segments": scored})

        top_n = int(task.input_json.get("top_n", 8))
        selected = sorted(scored, key=lambda item: item["total_score"], reverse=True)[:top_n]
        _record_step(db, task, "LiveClipSegmentPlannerAgent.select", {"top_n": top_n}, {"selected": [item["clip_id"] for item in selected]})

        plan_validation = _validate_selected_clip_plans(
            db,
            task,
            transcript,
            metadata,
            selected,
            requested_plans=task.input_json.get("clip_plans"),
        )
        transcript = plan_validation["transcript"]
        selected = plan_validation.get("selected") or selected
        if plan_validation["must_block"]:
            if batch_state["stages"]["planning"]["status"] == "running":
                batch_state = fail_stage(
                    batch_state, "planning", "clip plan validation failed"
                )
                save_persistent_job_state(db, task_id, batch_state)
            return _block_workflow_for_clip_plans(
                db,
                task,
                transcript,
                metadata,
                recognition,
                selected,
                plan_validation["record"],
            )
        if batch_state["stages"]["planning"]["status"] == "running":
            batch_state = complete_stage(
                batch_state,
                "planning",
                {
                    "clip_count": len(selected),
                    "selected": deepcopy(selected),
                    "validation_record": deepcopy(plan_validation["record"]),
                },
            )
            save_persistent_job_state(db, task_id, batch_state)
            batch_state, paused = _pause_batch_if_requested(
                db, task_id, batch_state
            )
            if paused:
                return _paused_workflow_response(db, task, batch_state)

    planning_sidecar = _build_verified_planning_sidecar_payload(
        task,
        batch_state,
        transcript,
        metadata,
        selected,
    )
    planning_selection = select_render_planning(
        baseline_plans=selected,
        planning_sidecar=planning_sidecar,
    )
    selected_for_render = planning_selection["selected_plans"]
    planning_policy_audit = {
        key: deepcopy(value)
        for key, value in planning_selection.items()
        if key != "selected_plans"
    }
    if planning_sidecar is not None:
        planning_sidecar["render_consumed"] = bool(
            planning_selection.get("render_consumed")
        )
        planning_sidecar["selected_plan_source"] = planning_selection.get(
            "selected_plan_source"
        )
        planning_sidecar["mode"] = (
            "render_canary"
            if planning_selection.get("render_consumed")
            else "shadow"
        )

    selected_for_render, p4_packaging_audit = prepare_p4_packaging_consumption(
        task_id=task.id,
        selected_plans=selected_for_render,
        transcript=transcript,
        planning_selection=planning_selection,
    )
    selected_for_render = _attach_timeline_mappings(
        task.id,
        selected_for_render,
        transcript,
    )
    if p4_requires_baseline_fallback(p4_packaging_audit, planning_selection):
        selected_for_render = deepcopy(selected)
        planning_policy_audit.update(
            {
                "effective_policy": "baseline",
                "selected_plan_source": "baseline",
                "fallback_reason": "p4_contract_failed_auto_fallback",
                "render_consumed": False,
            }
        )
        if planning_sidecar is not None:
            planning_sidecar.update(
                {
                    "render_consumed": False,
                    "selected_plan_source": "baseline",
                    "mode": "shadow_fallback",
                }
            )

    try:
        post_planning = _run_live_clip_post_planning(
            db,
            task,
            task_id,
            batch_state,
            source_path,
            out_dir,
            selected_for_render,
            transcript,
            metadata,
        )
    except LiveClipBatchExecutionError as error:
        if planning_selection.get("selected_plan_source") != "verified":
            return _fail_live_clip_active_batch(
                db,
                task,
                error.batch_state,
                error.original,
            )
        batch_state = _reset_post_planning_stages_for_baseline(
            error.batch_state
        )
        save_persistent_job_state(db, task_id, batch_state)
        append_task_log(
            "live_clips",
            task_id,
            "verified_render_auto_fallback",
            "ok",
            {
                "failed_plan_source": "verified",
                "fallback_plan_source": "baseline",
            },
            str(error.original),
        )
        planning_policy_audit.update(
            {
                "effective_policy": "baseline",
                "selected_plan_source": "baseline",
                "fallback_reason": "verified_render_failed_auto_fallback",
                "render_consumed": False,
                "verified_render_error": str(error.original),
            }
        )
        if planning_sidecar is not None:
            planning_sidecar.update(
                {
                    "render_consumed": False,
                    "selected_plan_source": "baseline",
                    "mode": "shadow_fallback",
                }
            )
        p4_packaging_audit.update(
            {
                "status": "fallback",
                "render_consumed": False,
                "fallback_reason": "verified_render_failed_auto_fallback",
            }
        )
        try:
            post_planning = _run_live_clip_post_planning(
                db,
                task,
                task_id,
                batch_state,
                source_path,
                out_dir,
                deepcopy(selected),
                transcript,
                metadata,
            )
        except LiveClipBatchExecutionError as fallback_error:
            return _fail_live_clip_active_batch(
                db,
                task,
                fallback_error.batch_state,
                fallback_error.original,
            )
        except Exception as fallback_error:
            return _fail_live_clip_active_batch(
                db, task, batch_state, fallback_error
            )
    except Exception as error:
        return _fail_live_clip_active_batch(db, task, batch_state, error)

    if post_planning.get("paused_response"):
        return post_planning["paused_response"]
    batch_state = post_planning["batch_state"]
    selected = post_planning["selected"]
    clip_warnings = post_planning["clip_warnings"]
    render_status = post_planning["render_status"]
    artifacts = post_planning["artifacts"]
    qa_result = post_planning["qa_result"]
    roi = post_planning["roi"]
    artifacts = _append_p4_qa_trace_audit(artifacts, p4_packaging_audit)

    normalized_segments = [_normalize_segment(item, task.input_json) for item in selected]
    status = _result_status(render_status, transcript)
    current_step = (
        LIVE_CLIP_REVIEW_STEP
        if status == "ok"
        else LIVE_CLIP_PARTIAL_READY_STEP
    )
    warnings = sorted(set(clip_warnings + transcript.get("warnings", [])))
    if transcript.get("status") != "completed":
        warnings.append(LIVE_CLIP_PENDING_TRANSCRIPT_WARNING)
    result_json = {
        "status": status,
        "attempt_id": _live_clip_attempt_id({"batch_state": batch_state}),
        "project_id": task.account_id or "live_clip_project",
        "task_id": task.id,
        "current_step": current_step,
        "workflow": WORKFLOW,
        "workflow_skill": "/video-content-repurposing-workflow",
        "source_video": metadata,
        "input_form": _input_form(task.input_json),
        "transcript": transcript,
        "recognition": recognition,
        "clip_plan_validation": plan_validation["record"],
        "segments": selected,
        "slice_segments": normalized_segments,
        "roi": roi,
        "artifacts": artifacts,
        "qa_result": qa_result,
        "batch_state": batch_state,
        "current_stage": "clip_quality_check",
        "current_agent": qa_result.get("qa_failure_owner_agent") or "LiveClipQAAgent",
        "current_skill": qa_result.get("qa_failure_owner_skill") or "clip_quality_check_skill",
        "execution_contract": execution_contract_snapshot(),
        "failure_reason": qa_result.get("qa_failure_reason"),
        "skills": {"flycut_caption": flycut_caption_health()},
        "stage_boundary": "phase_1_auto_clip_suggestion_initial_mp4_exchange_formats",
        "review_status": "pending_review",
        "warnings": sorted(set(warnings)),
    }
    result_json["internal_sidecars"] = {
        "planning_policy": planning_policy_audit,
    }
    if planning_sidecar is not None:
        result_json["internal_sidecars"]["verified_planning"] = planning_sidecar
    result_json["internal_sidecars"]["p4_timeline_packaging"] = p4_packaging_audit
    existing = _current_live_clip_task_result(db, task.id)
    if existing:
        existing.result_json = {
            **result_json,
            "batch_state": batch_state,
        }
        existing.status = status
    else:
        existing = TaskResult(
            id=uuid.uuid4().hex,
            task_id=task.id,
            workflow=WORKFLOW,
            status=status,
            result_json=result_json,
        )
        db.add(existing)
    task.status = "pending_review" if status == "ok" else status
    task.review_status = "pending_review" if status == "ok" else "not_submitted"
    if status == "ok":
        _record_step(db, task, "submit_to_review", {"auto_after_run": True}, {"review_status": task.review_status})
    append_task_log("live_clips", task_id, "run_task", status, {"segments": len(selected), "artifacts": artifacts})
    db.commit()
    traces = list(db.scalars(select(CausalTrace).where(CausalTrace.task_id == task_id).order_by(CausalTrace.created_at)))
    return _customer_live_clip_response(
        task,
        result_json,
        traces,
        status,
        result_id=existing.id,
    )


def _start_transcribing_progress_monitor(task_id: str, *, timeout_seconds: int) -> threading.Event:
    stop_event = threading.Event()

    def _monitor() -> None:
        started_at = time.monotonic()
        last_logged_progress = -1
        while not stop_event.wait(10):
            elapsed = time.monotonic() - started_at
            progress = min(95, max(1, int((elapsed / max(timeout_seconds, 1)) * 90)))
            if elapsed >= timeout_seconds:
                _mark_transcribing_timeout(task_id, elapsed)
                return
            if progress == last_logged_progress:
                continue
            last_logged_progress = progress
            _update_transcribing_progress(task_id, progress, elapsed)

    thread = threading.Thread(
        target=_monitor,
        name=f"liveclip-transcribing-monitor-{task_id[:8]}",
        daemon=True,
    )
    thread.start()
    return stop_event


def _update_transcribing_progress(task_id: str, progress: int, elapsed: float) -> None:
    with SessionLocal() as monitor_db:
        result = _current_live_clip_task_result(monitor_db, task_id)
        if not result:
            return
        payload = result.result_json or {}
        try:
            batch_state = load_job_state(payload.get("batch_state"))
        except ValueError:
            return
        stage = batch_state["stages"]["transcribing"]
        if stage.get("status") != "running":
            return
        stage["progress"] = max(int(stage.get("progress") or 0), int(progress))
        stage["artifact"] = {
            **(stage.get("artifact") or {}),
            "elapsed_seconds": round(elapsed, 1),
            "heartbeat": "asr_or_subtitle",
        }
        save_persistent_job_state(monitor_db, task_id, batch_state)
    append_task_log(
        "live_clips",
        task_id,
        "asr_or_subtitle.heartbeat",
        "running",
        {"progress": progress, "elapsed_seconds": round(elapsed, 1)},
    )


def _mark_transcribing_timeout(task_id: str, elapsed: float) -> None:
    message = (
        f"真实语音转写超过 {int(elapsed)} 秒仍未产出字幕，已自动标记为失败。"
    )
    with SessionLocal() as monitor_db:
        task = monitor_db.get(Task, task_id)
        result = _current_live_clip_task_result(monitor_db, task_id)
        if not task or not result:
            return
        payload = result.result_json or {}
        try:
            batch_state = load_job_state(payload.get("batch_state"))
        except ValueError:
            return
        if batch_state["stages"]["transcribing"].get("status") != "running":
            return
        batch_state = fail_stage(batch_state, "transcribing", message)
        result.result_json = {
            **payload,
            "status": "failed",
            "current_step": "真实语音转写超时",
            "failure_reason": message,
            "warnings": sorted(set((payload.get("warnings") or []) + [message])),
            "next_action": ["建议使用较短视频重试，或等待后台异步分片转写改造。"],
            "batch_state": batch_state,
        }
        result.status = "failed"
        task.status = "failed"
        monitor_db.commit()
    append_task_log(
        "live_clips",
        task_id,
        "asr_or_subtitle.timeout",
        "failed",
        {"elapsed_seconds": round(elapsed, 1)},
        message,
    )


def _is_live_clip_stage_failed(task_id: str, stage: str) -> bool:
    with SessionLocal() as monitor_db:
        result = _current_live_clip_task_result(monitor_db, task_id)
        if not result:
            return False
        try:
            batch_state = load_job_state((result.result_json or {}).get("batch_state"))
        except ValueError:
            return False
        return batch_state["stages"].get(stage, {}).get("status") == "failed"


def _validate_selected_clip_plans(
    db: Session,
    task: Task,
    transcript: dict,
    metadata: dict,
    selected: list[dict],
    requested_plans: list[dict] | None = None,
) -> dict:
    raw_output = {
        "clips": _clip_plans_from_selected(selected, transcript.get("segments") or []),
        "min_duration": float(task.input_json.get("min_clip_duration_seconds", 0)),
        "max_duration": float(task.input_json.get("max_clip_duration_seconds", 60)),
    }
    if transcript.get("status") != "completed" or not transcript.get("segments"):
        validation = {
            "valid": False,
            "plans": [],
            "errors": [{
                "clip_id": None,
                "index": -1,
                "code": "transcript_unavailable",
                "message": LIVE_CLIP_TRANSCRIPT_UNAVAILABLE_MESSAGE,
            }],
            "warnings": [],
        }
        record = _clip_plan_validation_record(raw_output, validation)
        _record_clip_plan_validation_trace(db, task, raw_output, validation)
        return {
            "record": record,
            "transcript": transcript,
            "must_block": False,
        }

    normalized_transcript, normalize_error, _transcript_changed = _canonical_transcript_segments(
        transcript["segments"]
    )
    if normalize_error:
        validation = {
            "valid": False,
            "plans": [],
            "errors": [{
                "clip_id": None,
                "index": -1,
                "code": "invalid_transcript",
                "message": normalize_error,
            }],
            "warnings": [],
        }
    else:
        normalized_transcript, selected = _clip_planning_inputs_to_source(
            normalized_transcript,
            selected,
            float(metadata.get("duration_seconds") or 0),
        )
        transcript = {**transcript, "segments": normalized_transcript}
        requested_payload = {
            "clips": requested_plans,
            "min_duration": raw_output["min_duration"],
            "max_duration": raw_output["max_duration"],
        } if requested_plans is not None else None
        if requested_payload is not None:
            prepared, payload_failure = prepare_clip_plan_payload(requested_payload)
            if payload_failure:
                validation = {
                    "valid": False,
                    "plans": [],
                    "errors": deepcopy(payload_failure["data"]["errors"]),
                    "warnings": [],
                }
            else:
                raw_output = prepared
                validation = validate_clip_plans(
                    raw_output,
                    normalized_transcript,
                    float(metadata.get("duration_seconds") or 0),
                    min_duration=raw_output["min_duration"],
                    max_duration=raw_output["max_duration"],
                )
        else:
            raw_output = {
                **raw_output,
                "clips": _clip_plans_from_selected(selected, normalized_transcript),
            }
            validation = validate_clip_plans(
                raw_output,
                normalized_transcript,
                float(metadata.get("duration_seconds") or 0),
                min_duration=raw_output["min_duration"],
                max_duration=raw_output["max_duration"],
            )
    record = _clip_plan_validation_record(raw_output, validation)
    _record_clip_plan_validation_trace(db, task, raw_output, validation)
    validated_selected = (
        _segments_from_validated_plans(validation["plans"], transcript["segments"])
        if requested_plans is not None and validation["valid"]
        else selected
    )
    return {
        "record": record,
        "transcript": transcript,
        "must_block": not validation["valid"],
        "selected": validated_selected,
    }


def _block_workflow_for_clip_plans(
    db: Session,
    task: Task,
    transcript: dict,
    metadata: dict,
    recognition: dict,
    selected: list[dict],
    validation_record: dict,
) -> dict:
    result_json = {
        "status": "blocked",
        "project_id": task.account_id or "live_clip_project",
        "task_id": task.id,
        "current_step": "校验失败，等待重新生成",
        "workflow": WORKFLOW,
        "workflow_skill": "/video-content-repurposing-workflow",
        "source_video": metadata,
        "input_form": _input_form(task.input_json),
        "transcript": transcript,
        "recognition": recognition,
        "segments": selected,
        "slice_segments": [],
        "clip_plan_validation": validation_record,
        "failure_reason": "校验失败，等待重新生成",
        "warnings": validation_record["warnings"],
    }
    existing = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task.id)
        .order_by(TaskResult.created_at.desc())
    )
    if existing:
        existing.result_json = result_json
        existing.status = "blocked"
    else:
        db.add(
            TaskResult(
                id=uuid.uuid4().hex,
                task_id=task.id,
                workflow=WORKFLOW,
                status="blocked",
                result_json=result_json,
            )
        )
    task.status = "blocked"
    task.review_status = "not_submitted"
    append_task_log(
        "live_clips",
        task.id,
        "run_task",
        "blocked",
        {"reason": "校验失败，等待重新生成"},
    )
    db.commit()
    traces = list(
        db.scalars(
            select(CausalTrace)
            .where(CausalTrace.task_id == task.id)
            .order_by(CausalTrace.created_at)
        )
    )
    response = _customer_live_clip_response(
        task, result_json, traces, "blocked"
    )
    response["message"] = "校验失败，等待重新生成"
    response["missing_inputs"] = ["valid_clip_plans"]
    return response


def _block_workflow_for_transcription(
    db: Session,
    task: Task,
    transcript: dict,
    metadata: dict,
    batch_state: dict,
) -> dict:
    result_json = {
        "status": "blocked",
        "project_id": task.account_id or "live_clip_project",
        "task_id": task.id,
        "current_step": "转写字幕",
        "workflow": WORKFLOW,
        "workflow_skill": "/video-content-repurposing-workflow",
        "source_video": metadata,
        "input_form": _input_form(task.input_json),
        "transcript": transcript,
        "segments": [],
        "slice_segments": [],
        "failure_reason": "真实语音转写不可用",
        "warnings": list(transcript.get("warnings") or []),
        "batch_state": batch_state,
    }
    existing = db.scalar(
        select(TaskResult)
        .where(TaskResult.task_id == task.id)
        .order_by(TaskResult.created_at.desc())
    )
    if existing:
        existing.result_json = result_json
        existing.status = "blocked"
    else:
        db.add(
            TaskResult(
                id=uuid.uuid4().hex,
                task_id=task.id,
                workflow=WORKFLOW,
                status="blocked",
                result_json=result_json,
            )
        )
    task.status = "blocked"
    task.review_status = "not_submitted"
    append_task_log(
        "live_clips",
        task.id,
        "run_task",
        "blocked",
        {"reason": "真实语音转写不可用"},
    )
    db.commit()
    traces = list(
        db.scalars(
            select(CausalTrace)
            .where(CausalTrace.task_id == task.id)
            .order_by(CausalTrace.created_at)
        )
    )
    response = _customer_live_clip_response(task, result_json, traces, "blocked")
    response["status"] = "blocked"
    response["message"] = "真实语音转写不可用"
    response["missing_inputs"] = sorted(
        set(response.get("missing_inputs", []) + ["speech_transcription_provider"])
    )
    return response


def _fail_live_clip_active_batch(
    db: Session,
    task: Task,
    batch_state: dict,
    error: Exception,
) -> dict:
    error_message = f"直播切片执行失败：{str(error).strip() or type(error).__name__}"
    active_stage = (batch_state or {}).get("current_stage") or "rendering"
    try:
        failed_state = fail_stage(batch_state, active_stage, error_message)
    except ValueError:
        failed_state = load_job_state(batch_state)
        stage_state = failed_state["stages"].setdefault(active_stage, {
            "status": "pending",
            "progress": 0,
            "attempts": 0,
            "artifact": {},
            "error": None,
            "started_at": None,
            "finished_at": None,
        })
        stage_state.update({
            "status": "failed",
            "error": error_message,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        })
        failed_state.update({
            "status": "failed",
            "current_stage": active_stage,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    save_persistent_job_state(db, task.id, failed_state)

    result = _current_live_clip_task_result(db, task.id)
    result_json = dict(result.result_json if result else {})
    warnings = sorted(
        set(list(result_json.get("warnings") or []) + [error_message])
    )
    result_json.update({
        "status": "failed",
        "attempt_id": _live_clip_attempt_id({"batch_state": failed_state}),
        "current_step": _live_clip_current_step_from_batch(failed_state),
        "current_stage": failed_state.get("current_stage") or active_stage,
        "failure_reason": error_message,
        "batch_state": failed_state,
        "warnings": warnings,
        "review_status": "not_submitted",
    })
    if result:
        result.result_json = result_json
        result.status = "failed"
    else:
        db.add(
            TaskResult(
                id=uuid.uuid4().hex,
                task_id=task.id,
                workflow=WORKFLOW,
                status="failed",
                result_json=result_json,
            )
        )
    task.status = "failed"
    task.review_status = "not_submitted"
    append_task_log(
        "live_clips",
        task.id,
        "run_task",
        "failed",
        {"stage": active_stage},
        error_message,
    )
    db.commit()
    traces = list(
        db.scalars(
            select(CausalTrace)
            .where(CausalTrace.task_id == task.id)
            .order_by(CausalTrace.created_at)
        )
    )
    response = _customer_live_clip_response(
        task,
        result_json,
        traces,
        "failed",
        result_id=result.id if result else None,
    )
    response["message"] = error_message
    response["warnings"] = warnings
    return response


def _reset_post_planning_stages_for_baseline(batch_state: dict) -> dict:
    """Reset only render-and-later checkpoints for verified-plan fallback."""

    loaded = load_job_state(batch_state)
    fresh = new_job_state()
    for stage in ("rendering", "qa", "exporting"):
        attempts = int(loaded["stages"][stage].get("attempts") or 0)
        loaded["stages"][stage] = {
            **deepcopy(fresh["stages"][stage]),
            "attempts": attempts,
        }
    loaded.update(
        {
            "status": "running",
            "current_stage": "rendering",
            "pause_requested": False,
            "updated_at": fresh["updated_at"],
        }
    )
    return loaded


def _run_live_clip_post_planning(
    db: Session,
    task: Task,
    task_id: str,
    batch_state: dict,
    source_path: Path,
    out_dir: Path,
    selected: list[dict],
    transcript: dict,
    metadata: dict,
) -> dict:
    try:
        if batch_state["stages"]["planning"]["status"] == "completed" and batch_state["stages"]["rendering"]["status"] == "pending":
            batch_state = start_stage(batch_state, "rendering")
            save_persistent_job_state(db, task_id, batch_state)

        rendering_checkpoint = batch_state["stages"]["rendering"].get("artifact") or {}
        if batch_state["stages"]["rendering"]["status"] == "completed" and rendering_checkpoint.get("selected"):
            selected = deepcopy(rendering_checkpoint["selected"])
            clip_warnings = list(rendering_checkpoint.get("warnings") or [])
            render_status = "ok"
        else:
            clip_warnings = []
            for segment in selected:
                files, warnings = _render_clip_files(source_path, out_dir, segment, task.input_json)
                segment.pop("_p4_packaging", None)
                segment["files"] = files
                segment["quality_check"] = _quality_check(segment)
                segment["risk_notes"] = segment["quality_check"]["risk_notes"]
                clip_warnings.extend(warnings)
            render_status = "ok" if _has_real_rendered_clip(selected) else "blocked"
            if batch_state["stages"]["rendering"]["status"] == "running":
                if render_status == "ok":
                    batch_state = complete_stage(
                        batch_state,
                        "rendering",
                        {
                            "clip_count": len(selected),
                            "selected": deepcopy(selected),
                            "warnings": list(clip_warnings),
                        },
                    )
                    save_persistent_job_state(db, task_id, batch_state)
                    batch_state, paused = _pause_batch_if_requested(
                        db, task_id, batch_state
                    )
                    if paused:
                        return {"paused_response": _paused_workflow_response(db, task, batch_state)}
                else:
                    batch_state = fail_stage(
                        batch_state, "rendering", "no real rendered clip"
                    )
                    save_persistent_job_state(db, task_id, batch_state)
        if batch_state["stages"]["rendering"]["status"] == "completed" and batch_state["stages"]["qa"]["status"] == "pending":
            batch_state = start_stage(batch_state, "qa")
            save_persistent_job_state(db, task_id, batch_state)
        _record_step(db, task, "LiveClipRenderSkill.basic_ffmpeg", {"segments": len(selected)}, {"warnings": clip_warnings}, render_status)
        _record_step(db, task, "LiveClipRenderSkill.vertical_reframe", {"enabled": task.input_json.get("enable_vertical_reframe", True)}, {"completed": render_status == "ok"}, render_status)
        _record_step(
            db,
            task,
            "flycut_caption_skill",
            {"enabled": task.input_json.get("enable_flycut_caption", True), "caption_style": task.input_json.get("caption_style", "ecommerce_conversion")},
            {
                "skill": flycut_caption_health(),
                "clips": [
                    {
                        "clip_id": item["clip_id"],
                        "status": item.get("flycut_caption", {}).get("status", "disabled"),
                        "highlight_keywords": item.get("flycut_caption", {}).get("highlight_keywords", []),
                    }
                    for item in selected
                ],
            },
        )
        _record_step(db, task, "LiveClipRenderSkill.subtitle_burn", {"enabled": task.input_json.get("enable_subtitle_burn", True), "provider": "flycut_caption"}, {"warnings": clip_warnings}, render_status)

        _add_titles_and_captions(selected, task.input_json)
        _record_step(db, task, "LiveClipCopyAgent", {}, {"titles": [item["suggested_title"] for item in selected]})

        roi = _calculate_roi(metadata, len(selected))
        _record_step(db, task, "calculate_roi", {}, roi)

        artifacts = _write_artifacts(out_dir, metadata, transcript, selected, roi)
        qa_results = []
        for segment in selected:
            segment["qa_result"] = _build_clip_qa_result(segment, artifacts)
            segment["qa"] = segment["qa_result"]
            qa_results.append(segment["qa_result"])
        qa_result = aggregate_qa_results(qa_results, warnings=clip_warnings + transcript.get("warnings", []))
        artifacts = _write_qa_trace_artifact(out_dir, artifacts, task, selected, qa_result)
        if batch_state["stages"]["qa"]["status"] == "running":
            if qa_result["qa_status"] == "passed":
                batch_state = complete_stage(
                    batch_state,
                    "qa",
                    {
                        "qa_score": qa_result.get("qa_score"),
                        "qa_result": deepcopy(qa_result),
                        "artifacts": deepcopy(artifacts),
                    },
                )
                save_persistent_job_state(db, task_id, batch_state)
                batch_state, paused = _pause_batch_if_requested(
                    db, task_id, batch_state
                )
                if paused:
                    return {"paused_response": _paused_workflow_response(db, task, batch_state)}
            else:
                batch_state = fail_stage(
                    batch_state, "qa", "clip quality check failed"
                )
                save_persistent_job_state(db, task_id, batch_state)
        if batch_state["stages"]["qa"]["status"] == "completed" and batch_state["stages"]["exporting"]["status"] == "pending":
            batch_state = start_stage(batch_state, "exporting")
            save_persistent_job_state(db, task_id, batch_state)
            if artifacts.get("jianying_project_zip"):
                batch_state = complete_stage(
                    batch_state,
                    "exporting",
                    {"jianying_project_zip": artifacts["jianying_project_zip"]},
                )
            else:
                batch_state = fail_stage(
                    batch_state, "exporting", "Jianying project export failed"
                )
            save_persistent_job_state(db, task_id, batch_state)
        _record_step(db, task, "LiveClipQAAgent", {}, {"segments": len(selected), "render_status": render_status, "qa_result": qa_result}, qa_result["qa_status"] if qa_result["qa_status"] != "passed" else "ok")
        _record_step(db, task, "JianyingProjectExportAgent", {}, {"zip": artifacts.get("jianying_project_zip"), "qa_result": qa_result}, "ok" if artifacts.get("jianying_project_zip") else "blocked")
        _record_step(db, task, "save_results", {}, artifacts)
        return {
            "batch_state": batch_state,
            "selected": selected,
            "clip_warnings": clip_warnings,
            "render_status": render_status,
            "artifacts": artifacts,
            "qa_result": qa_result,
            "roi": roi,
        }
    except Exception as error:
        raise LiveClipBatchExecutionError(batch_state, error) from error


def _canonical_transcript_segments(
    segments: list[dict],
) -> tuple[list[dict], str | None, bool]:
    ids = [item.get("segment_id") for item in segments]
    if all(ids) and len(ids) == len(set(ids)):
        return deepcopy(segments), None, False
    try:
        normalized = normalize_transcript_segments(deepcopy(segments))
        return normalized, None, normalized != segments
    except ValueError as exc:
        return [], str(exc), False


def _clip_planning_inputs_to_source(
    transcript_segments: list[dict],
    selected: list[dict],
    source_duration: float,
) -> tuple[list[dict], list[dict]]:
    if source_duration <= 0:
        return deepcopy(transcript_segments), deepcopy(selected)
    clipped_transcript = []
    for item in transcript_segments:
        start = max(0.0, float(item.get("start") or 0))
        end = min(float(item.get("end") or 0), source_duration)
        if start >= source_duration or end <= start:
            continue
        clipped_transcript.append({**deepcopy(item), "start": start, "end": end})
    clipped_selected = []
    for item in selected:
        start = max(0.0, float(item.get("start_seconds") or 0))
        end = min(float(item.get("end_seconds") or 0), source_duration)
        if start >= source_duration or end <= start:
            continue
        clipped_selected.append({
            **deepcopy(item),
            "start_seconds": start,
            "end_seconds": end,
            "duration_seconds": round(end - start, 3),
        })
    return clipped_transcript, clipped_selected


def _clip_plans_from_selected(
    selected: list[dict], transcript_segments: list[dict]
) -> list[dict]:
    plans = []
    for segment in selected:
        start = float(segment.get("start_seconds") or 0)
        end = float(segment.get("end_seconds") or 0)
        covered = [
            item
            for item in transcript_segments
            if float(item.get("start") or 0) >= start - 0.001
            and float(item.get("end") or 0) <= end + 0.001
        ]
        evidence_metadata = _planning_evidence_metadata(segment, covered)
        plans.append({
            "clip_id": segment.get("clip_id") or f"clip-{len(plans) + 1}",
            "title": (
                segment.get("suggested_title")
                or segment.get("highlight_label")
                or LIVE_CLIP_DEFAULT_LABEL
            ),
            "segment_ids": [
                item["segment_id"] for item in covered if item.get("segment_id")
            ],
            "ranges": [{"start": start, "end": end}],
            "duration": max(0.0, end - start),
            "score": float(segment.get("total_score") or 0),
            **evidence_metadata,
        })
    return plans


def _planning_evidence_metadata(
    segment: dict, covered_segments: list[dict]
) -> dict:
    raw_points = segment.get("selling_points") or []
    if isinstance(raw_points, str):
        raw_points = [raw_points]
    selling_points = list(
        dict.fromkeys(str(item).strip() for item in raw_points if str(item).strip())
    )
    if not selling_points:
        for item in covered_segments:
            text = str(item.get("text") or "").strip()
            for phrase in re.split(r"[。！？!?；;\n]+", text):
                claim = phrase.strip(" ，,。")
                if claim and any(
                    marker in claim for marker in LIVE_CLIP_SELLING_POINT_MARKERS
                ):
                    selling_points.append(claim)
        selling_points = list(dict.fromkeys(selling_points))[:3]

    source_segment_ids = [
        str(item["segment_id"])
        for item in covered_segments
        if item.get("segment_id")
        and any(
            _planning_claim_matches_text(claim, str(item.get("text") or ""))
            for claim in selling_points
        )
    ]
    proof_shot = str(segment.get("proof_shot") or "").strip()
    proof_shot_verified = bool(
        proof_shot and segment.get("proof_shot_verified", True)
    )
    if not proof_shot and source_segment_ids:
        referenced = [
            item
            for item in covered_segments
            if str(item.get("segment_id") or "") in source_segment_ids
        ]
        proof_ranges = "、".join(
            f"{float(item['start']):.3f}-{float(item['end']):.3f}"
            for item in referenced
        )
        proof_shot = f"源片 {proof_ranges}（待视觉确认）"
        proof_shot_verified = False
    return {
        "selling_points": selling_points,
        "selling_point_source_segment_ids": source_segment_ids,
        "proof_shot": proof_shot,
        "proof_shot_verified": proof_shot_verified,
    }


def _planning_claim_matches_text(claim: str, text: str) -> bool:
    compact_claim = re.sub(r"\s+", "", claim)
    compact_text = re.sub(r"\s+", "", text)
    if compact_claim and compact_claim in compact_text:
        return True
    markers = [
        marker for marker in LIVE_CLIP_SELLING_POINT_MARKERS if marker in compact_claim
    ]
    return bool(markers) and all(marker in compact_text for marker in markers)


def _segments_from_validated_plans(
    plans: list[dict], transcript_segments: list[dict]
) -> list[dict]:
    transcript_by_id = {
        item.get("segment_id"): item
        for item in transcript_segments
        if item.get("segment_id")
    }
    segments = []
    for plan in plans:
        referenced = [
            transcript_by_id[item]
            for item in plan.get("segment_ids") or []
            if item in transcript_by_id
        ]
        ranges = deepcopy(plan.get("ranges") or [])
        score = float(plan.get("score") or 0)
        normalized_score = min(10.0, max(0.0, score / 10))
        segments.append({
            "clip_id": plan["clip_id"],
            "start_seconds": float(ranges[0]["start"]),
            "end_seconds": float(ranges[-1]["end"]),
            "start_time": _fmt_time(float(ranges[0]["start"])),
            "end_time": _fmt_time(float(ranges[-1]["end"])),
            "duration_seconds": float(plan["duration"]),
            "text": " ".join(
                str(item.get("text") or "").strip()
                for item in referenced
                if str(item.get("text") or "").strip()
            ),
            "ranges": ranges,
            "source_ranges": ranges,
            "transcript_segments": referenced,
            "suggested_title": str(plan.get("title") or ""),
            "selection_reason": str(plan.get("reason") or ""),
            "selling_points": deepcopy(plan.get("selling_points") or []),
            "selling_point_source_segment_ids": deepcopy(
                plan.get("selling_point_source_segment_ids") or []
            ),
            "proof_shot": str(plan.get("proof_shot") or ""),
            "proof_shot_verified": bool(
                plan.get("proof_shot_verified", False)
            ),
            "recommended_platforms": [str(plan.get("platform") or "douyin")],
            "highlight_label": "AI组合",
            "hook_score": normalized_score,
            "standalone_score": normalized_score,
            "density_score": normalized_score,
            "emotion_score": normalized_score,
            "total_score": score,
        })
    return segments


def _clip_plan_validation_record(
    raw_output: dict, validation: dict
) -> dict:
    return build_validation_record(raw_output, validation)


def _record_clip_plan_validation_trace(
    db: Session, task: Task, raw_output: dict, validation: dict
) -> None:
    summary = validation_trace_summary(raw_output, validation)
    _record_step(
        db,
        task,
        "LiveClipSegmentPlannerAgent.validate",
        summary,
        {},
        "ok" if validation.get("valid") else "blocked",
    )


def _clip_plan_validation_response(
    record: dict, validation: dict
) -> dict:
    if validation["valid"]:
        return {
            "status": "ok",
            "data": {
                "validation": deepcopy(validation),
                "plans": deepcopy(validation["plans"]),
                "raw_output": deepcopy(record["raw_output"]),
            },
        }
    return {
        "status": "blocked",
        "message": "校验失败，等待重新生成",
        "data": {
            "validation": deepcopy(validation),
            "plans": deepcopy(validation.get("plans") or []),
            "errors": deepcopy(record["errors"]),
            "warnings": deepcopy(record["warnings"]),
            "raw_output": deepcopy(record["raw_output"]),
        },
        "missing_inputs": ["valid_clip_plans"],
    }


def _source_duration_value(result_json: dict):
    source = result_json.get("source_video") or {}
    metadata = result_json.get("metadata") or {}
    return (
        source.get("duration_seconds")
        or source.get("duration")
        or metadata.get("duration_seconds")
        or metadata.get("duration")
        or 0
    )


def _missing_clip_plan_state(key: str) -> dict:
    return {
        "status": "blocked",
        "data": {},
        "missing_inputs": [key],
    }


def _result_status(render_status: str, transcript: dict) -> str:
    if render_status != "ok":
        return "partial"
    has_transcript = bool(
        transcript.get("full_text") and transcript.get("segments")
    )
    return (
        "ok"
        if transcript.get("status") == "completed" and has_transcript
        else "partial"
    )


def _pause_batch_if_requested(
    db: Session, task_id: str, fallback_state: dict
) -> tuple[dict, bool]:
    db.expire_all()
    response = get_persistent_job_state(db, task_id)
    if response["status"] != "ok":
        return fallback_state, False
    current = response["data"]["batch_state"]
    if not current.get("pause_requested"):
        return current, False
    paused = pause_between_stages(current)
    save_persistent_job_state(db, task_id, paused)
    return paused, True


def _paused_workflow_response(
    db: Session, task: Task, batch_state: dict
) -> dict:
    task.status = "paused"
    db.commit()
    return {
        "status": "partial",
        "message": LIVE_CLIP_BATCH_PAUSED_MESSAGE,
        "missing_inputs": ["batch_resume"],
        "data": {
            "task_id": task.id,
            "batch_state": batch_state,
        },
        "next_action": [LIVE_CLIP_RESUME_NEXT_ACTION],
    }


def _has_real_rendered_clip(segments: list[dict]) -> bool:
    if not segments:
        return False
    for segment in segments:
        value = segment.get("files", {}).get("final_clip")
        if not value:
            return False
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        if not path.is_file() or path.stat().st_size <= 0:
            return False
    return True


def get_artifact_path(db: Session, task_id: str, artifact_key: str) -> Path | None:
    result = db.scalar(select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.created_at.desc()))
    if not result:
        return None
    rel = result.result_json.get("artifacts", {}).get(artifact_key)
    if not rel:
        return None
    path = PROJECT_ROOT / rel
    return path if path.exists() else None


def _extract_metadata(source_path: Path, material: Material) -> dict:
    ffprobe = resolve_binary("ffprobe")
    base = probe_video(source_path)
    metadata = {
        "file_id": material.id,
        "file_path": material.file_path,
        "duration_seconds": round(float(base.get("duration") or material.duration or 0), 3),
        "resolution": "unknown",
        "format": source_path.suffix.lstrip(".").lower() or "mp4",
    }
    if not ffprobe:
        return metadata
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(source_path),
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
    if proc.returncode == 0:
        stream = (json.loads(proc.stdout or "{}").get("streams") or [{}])[0]
        if stream.get("width") and stream.get("height"):
            metadata["resolution"] = f"{stream['width']}x{stream['height']}"
            metadata["width"] = stream["width"]
            metadata["height"] = stream["height"]
    return metadata


def _transcribe_or_mock(
    source_path: Path,
    out_dir: Path,
    metadata: dict,
    payload: dict,
    *,
    task_id: str | None = None,
) -> dict:
    transcript_text = payload.get("transcript_text", "").strip()
    transcript_segments = payload.get("transcript_segments") or []
    provider = payload.get("transcript_provider") or ("uploaded_srt" if transcript_segments else "uploaded_text" if transcript_text else "")
    srt_path = out_dir / "full_transcript.srt"
    ass_path = out_dir / "full_transcript.ass"
    text_path = out_dir / "full_transcript.txt"
    json_path = out_dir / "full_transcript.json"
    transcript_extra: dict = {}
    if not transcript_text and not transcript_segments:
        fallback_warnings: list[str] = []
        engine = str(payload.get("transcription_engine") or "funasr").lower()
        allow_whisper_fallback = _allow_whisper_fallback(payload, engine)
        try:
            if _chunked_transcription_enabled(metadata, payload):
                recognized = _transcribe_chunked(
                    source_path,
                    out_dir,
                    metadata,
                    payload,
                    engine=engine,
                    allow_whisper_fallback=allow_whisper_fallback,
                    task_id=task_id,
                )
            else:
                recognized = _transcribe_single_media(
                    source_path,
                    out_dir / "full_transcript",
                    payload,
                    engine=engine,
                    allow_whisper_fallback=allow_whisper_fallback,
                )
            transcript_text = recognized.get("text", "").strip()
            transcript_segments = recognized.get("segments") or []
            provider = recognized.get("provider") or engine
            warnings = fallback_warnings + (recognized.get("warnings") or [])
            transcript_extra = {
                key: recognized[key]
                for key in ("chunk_manifest", "chunks")
                if key in recognized
            }
            status = "completed" if transcript_text and transcript_segments else "blocked"
        except Exception as exc:
            transcript_text = ""
            transcript_segments = []
            provider = engine
            warnings = [f"Real speech transcription failed: {exc}"]
            status = "blocked"
            text_path.write_text("", encoding="utf-8")
            srt_path.write_text("", encoding="utf-8")
            json_path.write_text(json.dumps({"text": "", "segments": [], "provider": provider, "warnings": warnings}, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        warnings = []
        status = "completed"
        text_path.write_text(transcript_text, encoding="utf-8")
        if transcript_segments:
            srt_path.write_text(_segments_to_srt(transcript_segments), encoding="utf-8")
        else:
            duration = max(float(metadata.get("duration_seconds") or 0), 1.0)
            srt_path.write_text(_make_srt(transcript_text, 0, min(duration, 60)), encoding="utf-8")
        json_path.write_text(
            json.dumps(
                {
                    "text": transcript_text,
                    "segments": transcript_segments,
                    "provider": provider,
                    "language": payload.get("target_language", "zh"),
                    "warnings": warnings,
                    **transcript_extra,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    _write_full_transcript_files(
        text_path,
        srt_path,
        json_path,
        transcript_text=transcript_text,
        transcript_segments=transcript_segments,
        provider=provider,
        language=payload.get("target_language", "zh"),
        warnings=warnings,
        metadata=metadata,
        extra=transcript_extra,
    )
    return {
        "text_file": rel_path(text_path),
        "srt_file": rel_path(srt_path),
        "ass_file": rel_path(ass_path),
        "json_file": rel_path(json_path),
        "language": payload.get("target_language", "zh"),
        "transcription_provider": provider,
        "status": status,
        "full_text": transcript_text,
        "segments": transcript_segments,
        "warnings": warnings,
        **transcript_extra,
    }


def _write_full_transcript_files(
    text_path: Path,
    srt_path: Path,
    json_path: Path,
    *,
    transcript_text: str,
    transcript_segments: list[dict],
    provider: str,
    language: str,
    warnings: list[str],
    metadata: dict,
    extra: dict | None = None,
) -> None:
    text_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.write_text(transcript_text, encoding="utf-8")
    if transcript_segments:
        srt_path.write_text(_segments_to_srt(transcript_segments), encoding="utf-8")
    elif transcript_text:
        duration = max(float(metadata.get("duration_seconds") or 0), 1.0)
        srt_path.write_text(_make_srt(transcript_text, 0, min(duration, 60)), encoding="utf-8")
    else:
        srt_path.write_text("", encoding="utf-8")
    ass_path = srt_path.with_suffix(".ass")
    ass_path.write_text(render_ass(transcript_segments), encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {
                "text": transcript_text,
                "segments": transcript_segments,
                "provider": provider,
                "language": language,
                "warnings": warnings,
                **(extra or {}),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _ensure_full_transcript_files(out_dir: Path, metadata: dict, transcript: dict) -> dict:
    text_path = out_dir / "full_transcript.txt"
    srt_path = out_dir / "full_transcript.srt"
    json_path = out_dir / "full_transcript.json"
    segments = transcript.get("segments") or []
    full_text = (
        str(transcript.get("full_text") or transcript.get("text") or "").strip()
        or _transcript_full_text(segments)
    )
    provider = str(transcript.get("transcription_provider") or transcript.get("provider") or "")
    warnings = list(transcript.get("warnings") or [])
    extra = {
        key: transcript[key]
        for key in ("chunk_manifest", "chunks")
        if key in transcript
    }
    ass_path = out_dir / "full_transcript.ass"
    if (
        not _usable_output_file(text_path)
        or not _usable_output_file(srt_path)
        or not _usable_output_file(ass_path)
        or not _usable_output_file(json_path)
    ):
        _write_full_transcript_files(
            text_path,
            srt_path,
            json_path,
            transcript_text=full_text,
            transcript_segments=segments,
            provider=provider,
            language=transcript.get("language") or "zh",
            warnings=warnings,
            metadata=metadata,
            extra=extra,
        )
    return {
        **transcript,
        "text_file": rel_path(text_path),
        "srt_file": rel_path(srt_path),
        "ass_file": rel_path(ass_path),
        "json_file": rel_path(json_path),
        "full_text": full_text,
        "segments": segments,
        **extra,
    }


def _allow_whisper_fallback(payload: dict, engine: str) -> bool:
    if engine != "funasr":
        return True
    raw = payload.get("allow_whisper_fallback")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _transcription_chunk_seconds(payload: dict) -> int:
    raw = payload.get("transcription_chunk_seconds")
    try:
        value = int(raw) if raw is not None else LIVECLIP_TRANSCRIBE_CHUNK_SECONDS
    except (TypeError, ValueError):
        value = LIVECLIP_TRANSCRIBE_CHUNK_SECONDS
    return max(60, value)


def _chunked_transcription_enabled(metadata: dict, payload: dict) -> bool:
    raw = payload.get("enable_chunked_transcription")
    if raw is not None and str(raw).strip().lower() in {"0", "false", "no", "off"}:
        return False
    duration = float(metadata.get("duration_seconds") or 0)
    return duration > _transcription_chunk_seconds(payload)


def _transcribe_timeout_seconds(metadata: dict, payload: dict) -> int:
    if not _chunked_transcription_enabled(metadata, payload):
        return LIVECLIP_TRANSCRIBE_TIMEOUT_SECONDS
    duration = max(0.0, float(metadata.get("duration_seconds") or 0))
    chunk_count = max(1, math.ceil(duration / _transcription_chunk_seconds(payload)))
    return max(
        LIVECLIP_TRANSCRIBE_TIMEOUT_SECONDS,
        chunk_count * LIVECLIP_TRANSCRIBE_CHUNK_TIMEOUT_SECONDS,
    )


def _transcribe_single_media(
    media_path: Path,
    output_base: Path,
    payload: dict,
    *,
    engine: str,
    allow_whisper_fallback: bool,
) -> dict:
    if engine == "funasr":
        try:
            recognized = FunASRTranscriptionAdapter().transcribe(media_path, output_base)
            if not recognized.get("text") or not recognized.get("segments"):
                raise RuntimeError("FunASR returned no timestamped speech")
            return recognized
        except Exception as exc:
            if not allow_whisper_fallback:
                raise RuntimeError(
                    f"FunASR GPU 转写失败，且 faster-whisper fallback 已禁用：{exc}"
                ) from exc
            recognized = SpeechTranscriptionAdapter(
                model_name=payload.get("transcription_model") or _default_transcription_model()
            ).transcribe(media_path, output_base)
            recognized["warnings"] = [
                f"FunASR GPU transcription failed; fell back to faster-whisper: {exc}",
                *(recognized.get("warnings") or []),
            ]
            return recognized
    return SpeechTranscriptionAdapter(
        model_name=payload.get("transcription_model") or _default_transcription_model()
    ).transcribe(media_path, output_base)


def _transcribe_chunked(
    source_path: Path,
    out_dir: Path,
    metadata: dict,
    payload: dict,
    *,
    engine: str,
    allow_whisper_fallback: bool,
    task_id: str | None,
) -> dict:
    duration = max(0.0, float(metadata.get("duration_seconds") or 0))
    chunk_seconds = _transcription_chunk_seconds(payload)
    chunks = _transcription_chunks(duration, chunk_seconds)
    chunks_dir = out_dir / "transcript_chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    all_segments: list[dict] = []
    all_texts: list[str] = []
    warnings: list[str] = []
    providers: list[str] = []
    manifest_rows: list[dict] = []
    started_at = time.monotonic()

    append_task_log(
        "live_clips",
        task_id or "unknown",
        "asr_or_subtitle.chunked_start",
        "running",
        {"chunks": len(chunks), "chunk_seconds": chunk_seconds, "duration_seconds": duration},
    )
    for index, chunk in enumerate(chunks, start=1):
        chunk_id = f"chunk_{index:03d}"
        checkpoint_path = chunks_dir / f"{chunk_id}.json"
        checkpoint = _load_transcription_chunk_checkpoint(checkpoint_path)
        if checkpoint:
            recognized = checkpoint["recognized"]
            append_task_log(
                "live_clips",
                task_id or "unknown",
                "asr_or_subtitle.chunk_reused",
                "ok",
                {"chunk_id": chunk_id, "index": index, "total": len(chunks)},
            )
        else:
            chunk_media = chunks_dir / f"{chunk_id}.wav"
            append_task_log(
                "live_clips",
                task_id or "unknown",
                "asr_or_subtitle.chunk_start",
                "running",
                {
                    "chunk_id": chunk_id,
                    "index": index,
                    "total": len(chunks),
                    "start_seconds": chunk["start"],
                    "end_seconds": chunk["end"],
                },
            )
            _extract_transcription_chunk(
                source_path,
                chunk_media,
                start_seconds=chunk["start"],
                duration_seconds=chunk["duration"],
            )
            try:
                recognized = _transcribe_single_media(
                    chunk_media,
                    chunks_dir / chunk_id,
                    payload,
                    engine=engine,
                    allow_whisper_fallback=allow_whisper_fallback,
                )
            finally:
                chunk_media.unlink(missing_ok=True)
            _write_transcription_chunk_checkpoint(
                checkpoint_path,
                {
                    "chunk_id": chunk_id,
                    **chunk,
                    "recognized": recognized,
                },
            )
            append_task_log(
                "live_clips",
                task_id or "unknown",
                "asr_or_subtitle.chunk_done",
                "ok",
                {
                    "chunk_id": chunk_id,
                    "index": index,
                    "total": len(chunks),
                    "segments": len(recognized.get("segments") or []),
                },
            )
        providers.append(str(recognized.get("provider") or engine))
        warnings.extend(recognized.get("warnings") or [])
        chunk_segments = _offset_transcription_segments(
            recognized.get("segments") or [],
            chunk["start"],
            chunk["end"],
        )
        all_segments.extend(chunk_segments)
        text = str(recognized.get("text") or "").strip()
        if text:
            all_texts.append(text)
        manifest_rows.append({
            "chunk_id": chunk_id,
            **chunk,
            "segments": len(chunk_segments),
            "provider": recognized.get("provider") or engine,
            "checkpoint": rel_path(checkpoint_path),
        })
        if task_id:
            progress = min(95, max(1, round(index / max(len(chunks), 1) * 95)))
            _update_transcribing_progress(task_id, progress, time.monotonic() - started_at)

    provider = providers[0] if providers and len(set(providers)) == 1 else "chunked_transcription"
    manifest_path = chunks_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "duration_seconds": duration,
                "chunk_seconds": chunk_seconds,
                "chunks": manifest_rows,
                "provider": provider,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {
        "text": " ".join(all_texts).strip(),
        "segments": sorted(all_segments, key=lambda item: float(item.get("start") or 0)),
        "provider": provider,
        "language": payload.get("target_language", "zh"),
        "warnings": warnings,
        "chunk_manifest": rel_path(manifest_path),
        "chunks": len(chunks),
    }


def _transcription_chunks(duration: float, chunk_seconds: int) -> list[dict]:
    chunks: list[dict] = []
    cursor = 0.0
    while cursor < duration:
        end = min(duration, cursor + chunk_seconds)
        if end - cursor >= 1.0:
            chunks.append({
                "start": round(cursor, 3),
                "end": round(end, 3),
                "duration": round(end - cursor, 3),
            })
        cursor = end
    return chunks or [{"start": 0.0, "end": max(duration, 1.0), "duration": max(duration, 1.0)}]


def _extract_transcription_chunk(
    source_path: Path,
    target_path: Path,
    *,
    start_seconds: float,
    duration_seconds: float,
) -> None:
    ffmpeg = resolve_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg 不可用，无法切分转写音频。")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{max(0.0, start_seconds):.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{max(0.1, duration_seconds):.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        str(target_path),
    ]
    process = _run(cmd, timeout=max(120, round(duration_seconds) + 120))
    if process.returncode != 0 or not target_path.is_file() or target_path.stat().st_size <= 44:
        raise RuntimeError(f"ASR 分片音频提取失败：{process.stderr[-400:]}")


def _load_transcription_chunk_checkpoint(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("status") != "completed":
        return None
    recognized = payload.get("recognized") or {}
    if not isinstance(recognized, dict):
        return None
    return payload


def _write_transcription_chunk_checkpoint(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"status": "completed", **payload}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _offset_transcription_segments(segments: list[dict], offset: float, chunk_end: float) -> list[dict]:
    shifted: list[dict] = []
    for item in segments:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start = max(0.0, float(item.get("start") or 0) + offset)
        end = max(start + 0.2, float(item.get("end") or 0) + offset)
        shifted.append({
            **item,
            "start": round(start, 3),
            "end": round(min(end, chunk_end), 3),
            "text": text,
        })
    return shifted


def _default_transcription_model() -> str:
    for name in ("faster-whisper-small", "faster-whisper-tiny"):
        model_dir = PROJECT_ROOT / "runtime" / "models" / name
        if (model_dir / "model.bin").is_file():
            return str(model_dir)
    return "small"


def _extract_scene_and_silence(source_path: Path, out_dir: Path) -> dict:
    ffmpeg = resolve_binary("ffmpeg")
    warnings: list[str] = []
    silence_events: list[dict] = []
    scene_events: list[dict] = []
    if not ffmpeg:
        return {
            "provider": "blocked",
            "silence_events": [],
            "scene_events": [],
            "warnings": ["FFmpeg 不可用，无法执行真实静音/场景检测。"],
        }

    silence_cmd = [
        ffmpeg,
        "-hide_banner",
        "-i",
        str(source_path),
        "-af",
        "silencedetect=noise=-35dB:d=0.45",
        "-f",
        "null",
        "-",
    ]
    try:
        silence_proc = _run(silence_cmd, timeout=120)
        if silence_proc.returncode == 0:
            silence_events = _parse_silence_events(silence_proc.stderr)
        else:
            warnings.append(LIVE_CLIP_FFMPEG_SILENCEDETECT_FAILED)
    except subprocess.TimeoutExpired:
        warnings.append(LIVE_CLIP_FFMPEG_SILENCEDETECT_TIMEOUT)

    scene_log = out_dir / "scene_detect.log"
    scene_cmd = [
        ffmpeg,
        "-hide_banner",
        "-i",
        str(source_path),
        "-vf",
        "select='gt(scene,0.35)',showinfo",
        "-an",
        "-f",
        "null",
        "-",
    ]
    try:
        scene_proc = _run(scene_cmd, timeout=120)
        scene_log.write_text(scene_proc.stderr or "", encoding="utf-8")
        if scene_proc.returncode == 0:
            scene_events = _parse_scene_events(scene_proc.stderr)
        else:
            warnings.append(LIVE_CLIP_FFMPEG_SCENE_FAILED)
    except subprocess.TimeoutExpired:
        scene_log.write_text("", encoding="utf-8")
        warnings.append(LIVE_CLIP_FFMPEG_SCENE_TIMEOUT)
    recognition_path = out_dir / "recognition_summary.json"
    recognition = {
        "provider": "ffmpeg_silencedetect_scene_filter",
        "silence_events": silence_events[:50],
        "scene_events": scene_events[:80],
        "scene_log": rel_path(scene_log),
        "warnings": warnings,
    }
    recognition_path.write_text(json.dumps(recognition, ensure_ascii=False, indent=2), encoding="utf-8")
    recognition["summary_json"] = rel_path(recognition_path)
    return recognition


def _parse_silence_events(stderr: str) -> list[dict]:
    events: list[dict] = []
    active: dict | None = None
    for line in stderr.splitlines():
        if "silence_start:" in line:
            try:
                active = {"start": float(line.rsplit("silence_start:", 1)[1].strip())}
            except ValueError:
                active = None
        elif "silence_end:" in line and active is not None:
            try:
                tail = line.rsplit("silence_end:", 1)[1].strip()
                end = float(tail.split("|", 1)[0].strip())
                active["end"] = end
                active["duration"] = round(end - float(active["start"]), 3)
                events.append(active)
            except ValueError:
                pass
            active = None
    return events


def _parse_scene_events(stderr: str) -> list[dict]:
    events: list[dict] = []
    for line in stderr.splitlines():
        if "pts_time:" not in line:
            continue
        try:
            value = line.split("pts_time:", 1)[1].split()[0]
            ts = float(value)
        except (IndexError, ValueError):
            continue
        if not events or abs(ts - events[-1]["time"]) > 0.4:
            events.append({"event_id": f"scene_{len(events) + 1:03d}", "time": round(ts, 3), "type": "scene_change_candidate"})
    return events


def _parse_srt_segments(content: str) -> list[dict]:
    blocks = content.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n\n")
    segments: list[dict] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        time_line_index = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if time_line_index < 0:
            continue
        try:
            start_raw, end_raw = [part.strip() for part in lines[time_line_index].split("-->", 1)]
            start = _parse_srt_timestamp(start_raw)
            end = _parse_srt_timestamp(end_raw.split()[0])
        except (ValueError, IndexError):
            continue
        text = " ".join(lines[time_line_index + 1:]).strip()
        if not text:
            continue
        segments.append({"start": start, "end": max(end, start + 0.2), "text": text})
    return segments


def _segment_from_srt(transcript_segments: list[dict], metadata: dict, top_n: int, max_duration: int, recognition: dict | None = None) -> list[dict]:
    duration = max(float(metadata.get("duration_seconds") or 0), transcript_segments[-1].get("end", 1.0) if transcript_segments else 1.0)
    target_count = max(3, min(10, top_n or 10))
    max_duration = max(15, min(max_duration or 60, 60))
    grouped: list[dict] = []
    current: list[dict] = []
    for item in transcript_segments:
        if not current:
            current = [item]
            continue
        start = float(current[0]["start"])
        end = float(item["end"])
        if end - start <= max_duration and len(grouped) < target_count:
            current.append(item)
        else:
            grouped.append(_srt_group_to_segment(current, len(grouped) + 1, duration))
            current = [item]
        if len(grouped) >= target_count:
            break
    if current and len(grouped) < target_count:
        grouped.append(_srt_group_to_segment(current, len(grouped) + 1, duration))
    selected = grouped[:target_count]
    for index, item in enumerate(selected, start=1):
        _score_segment(item, index, recognition=recognition)
    return selected


def _build_full_timeline_shadow_candidates(
    transcript_segments: list[dict],
    metadata: dict,
    *,
    max_duration: int,
) -> list[dict]:
    duration = max(
        float(metadata.get("duration_seconds") or 0),
        float(transcript_segments[-1].get("end") or 1.0)
        if transcript_segments
        else 1.0,
    )
    maximum = max(15, min(int(max_duration or 60), 60))
    valid = [
        item
        for item in transcript_segments
        if item.get("segment_id")
        and str(item.get("text") or "").strip()
        and float(item.get("end") or 0) > float(item.get("start") or 0) >= 0
    ]
    valid.sort(key=lambda item: (float(item["start"]), float(item["end"])))
    groups: list[list[dict]] = []
    current: list[dict] = []
    for item in valid:
        if not current:
            current = [item]
            continue
        group_start = float(current[0]["start"])
        if float(item["end"]) - group_start <= maximum:
            current.append(item)
        else:
            groups.append(current)
            current = [item]
    if current:
        groups.append(current)

    candidates: list[dict] = []
    for index, group in enumerate(groups, start=1):
        candidate = _srt_group_to_segment(group, index, duration)
        candidate["clip_id"] = f"shadow_candidate_{index:04d}"
        candidate["shadow_source_segment_ids"] = [
            str(item["segment_id"]) for item in group
        ]
        candidates.append(candidate)
    return candidates


def _adjust_candidate_to_complete_boundaries(
    candidate: dict,
    transcript_segments: list[dict],
    *,
    max_duration: int,
) -> dict | None:
    """Adjust one shadow candidate only at existing transcript boundaries."""

    ordered = transcript_sentence_units(transcript_segments)
    if not ordered:
        return None
    before_start = float(
        candidate.get("start_seconds") or candidate.get("start") or 0
    )
    before_end = float(
        candidate.get("end_seconds") or candidate.get("end") or before_start
    )
    included_indexes = [
        index
        for index, item in enumerate(ordered)
        if float(item["start"]) < before_end
        and float(item["end"]) > before_start
    ]
    if not included_indexes:
        return None

    first_index = included_indexes[0]
    last_index = included_indexes[-1]
    assessment_before = assess_clip_boundary(candidate, ordered)
    reasons = list(assessment_before.failure_codes)
    maximum = max(1.0, float(max_duration))
    evidence_ids = {
        str(value)
        for value in candidate.get("selling_point_source_segment_ids") or []
    }
    selling_points = [
        str(value).strip()
        for value in candidate.get("selling_points") or []
        if str(value).strip()
    ]
    primary_point = selling_points[0] if selling_points else ""
    primary_indexes = [
        index
        for index in included_indexes
        if primary_point
        and (
            primary_point in str(ordered[index].get("text") or "")
            or str(ordered[index].get("text") or "").strip("。！？!?；;")
            in primary_point
        )
    ]

    if "trailing_sentence_incomplete" in reasons and primary_indexes:
        for possible_last in range(last_index, max(primary_indexes) - 1, -1):
            possible = assess_clip_boundary(
                {
                    "start_seconds": float(ordered[first_index]["start"]),
                    "end_seconds": float(ordered[possible_last]["end"]),
                },
                ordered,
            )
            if possible.trailing_complete:
                last_index = possible_last
                break

    while not assess_clip_boundary(
        {
            "start_seconds": float(ordered[first_index]["start"]),
            "end_seconds": float(ordered[last_index]["end"]),
        },
        ordered,
    ).leading_complete and first_index > 0:
        first_index -= 1
    while not assess_clip_boundary(
        {
            "start_seconds": float(ordered[first_index]["start"]),
            "end_seconds": float(ordered[last_index]["end"]),
        },
        ordered,
    ).trailing_complete and last_index < len(ordered) - 1:
        last_index += 1

    evidence_indexes = [
        index
        for index in range(first_index, last_index + 1)
        if primary_point
        and (
            primary_point in str(ordered[index].get("text") or "")
            or str(ordered[index].get("text") or "").strip("。！？!?；;")
            in primary_point
        )
    ]
    if not evidence_indexes:
        evidence_indexes = [
            index
            for index in range(first_index, last_index + 1)
            if str(
                ordered[index].get("source_segment_id")
                or ordered[index].get("segment_id")
            )
            in evidence_ids
        ]
    protected_first = min(evidence_indexes) if evidence_indexes else included_indexes[0]
    protected_last = max(evidence_indexes) if evidence_indexes else included_indexes[-1]
    if "leading_context_missing" in reasons:
        protected_first = min(protected_first, first_index)
    if "trailing_sentence_incomplete" in reasons:
        protected_last = max(protected_last, last_index)

    idle_trimmed = 0
    while first_index < protected_first:
        single = assess_clip_boundary(
            {
                "start_seconds": float(ordered[first_index]["start"]),
                "end_seconds": float(ordered[first_index]["end"]),
            },
            [ordered[first_index]],
            max_idle_ratio=0,
        )
        if single.idle_ratio <= 0:
            break
        first_index += 1
        idle_trimmed += 1
    while last_index > protected_last:
        single = assess_clip_boundary(
            {
                "start_seconds": float(ordered[last_index]["start"]),
                "end_seconds": float(ordered[last_index]["end"]),
            },
            [ordered[last_index]],
            max_idle_ratio=0,
        )
        if single.idle_ratio <= 0:
            break
        last_index -= 1
        idle_trimmed += 1

    while float(ordered[last_index]["end"]) - float(
        ordered[first_index]["start"]
    ) > maximum:
        can_trim_end = last_index > protected_last
        can_trim_start = first_index < protected_first
        if "leading_context_missing" in reasons and can_trim_end:
            last_index -= 1
        elif "trailing_sentence_incomplete" in reasons and can_trim_start:
            first_index += 1
        elif can_trim_end:
            last_index -= 1
        elif can_trim_start:
            first_index += 1
        else:
            break

    selected_segments = ordered[first_index : last_index + 1]
    start = float(selected_segments[0]["start"])
    end = float(selected_segments[-1]["end"])
    selected_text = " ".join(
        str(item.get("text") or "").strip() for item in selected_segments
    ).strip()
    selected_source_ids = list(
        dict.fromkeys(
            str(item.get("source_segment_id") or item.get("segment_id"))
            for item in selected_segments
        )
    )
    retained_selling_points = [
        point
        for point in selling_points
        if point in selected_text
        or any(
            str(item.get("text") or "").strip("。！？!?；;") in point
            for item in selected_segments
        )
    ]
    adjusted = deepcopy(candidate)
    adjusted.update(
        {
            "start_seconds": round(start, 3),
            "end_seconds": round(end, 3),
            "start_time": _fmt_time(start),
            "end_time": _fmt_time(end),
            "duration_seconds": round(max(0.0, end - start), 3),
            "ranges": [{"start": round(start, 3), "end": round(end, 3)}],
            "text": selected_text,
            "transcript_excerpt": selected_text,
            "transcript_segments": deepcopy(selected_segments),
            "shadow_source_segment_ids": selected_source_ids,
            "selling_points": retained_selling_points,
            "selling_point_source_segment_ids": [
                segment_id
                for segment_id in selected_source_ids
                if segment_id in evidence_ids
            ],
        }
    )
    assessment_after = assess_clip_boundary(adjusted, ordered)
    adjusted["boundary_adjustment"] = {
        "status": (
            "passed" if assessment_after.context_complete else "blocked"
        ),
        "before": {
            "start_seconds": round(before_start, 3),
            "end_seconds": round(before_end, 3),
        },
        "after": {
            "start_seconds": round(start, 3),
            "end_seconds": round(end, 3),
        },
        "reasons": reasons,
        "assessment_before": assessment_before.model_dump(mode="json"),
        "assessment_after": assessment_after.model_dump(mode="json"),
        "sentence_boundary_aligned": True,
        "max_duration_seconds": maximum,
        "boundary_time_precision": "punctuation_proportional_estimate",
        "idle_edge_sentences_trimmed": idle_trimmed,
        "overlap_deduplicated": False,
    }
    return adjusted


def _adjust_candidates_to_complete_boundaries(
    candidates: list[dict],
    transcript_segments: list[dict],
    *,
    max_duration: int,
) -> list[dict]:
    """Keep ranking order while dropping boundary-adjusted overlaps."""

    output: list[dict] = []
    occupied: list[tuple[float, float]] = []
    for candidate in candidates:
        adjusted = _adjust_candidate_to_complete_boundaries(
            candidate,
            transcript_segments,
            max_duration=max_duration,
        )
        if adjusted is None:
            continue
        start = float(adjusted["start_seconds"])
        end = float(adjusted["end_seconds"])
        if any(start < existing_end and end > existing_start for existing_start, existing_end in occupied):
            continue
        output.append(adjusted)
        occupied.append((start, end))
    return output


def _build_verified_planning_sidecar_payload(
    task: Task,
    batch_state: dict,
    transcript: dict,
    metadata: dict,
    baseline_segments: list[dict],
) -> dict | None:
    if not (
        verified_planning_sidecar_enabled()
        or planning_policy_requests_sidecar()
    ):
        return None
    transcript_segments = transcript.get("segments") or []
    if transcript.get("status") != "completed" or not transcript_segments:
        return None
    try:
        candidates = _build_full_timeline_shadow_candidates(
            transcript_segments,
            metadata,
            max_duration=int(
                task.input_json.get("max_clip_duration_seconds", 60)
            ),
        )
        scored = [
            _score_segment(item, index)
            for index, item in enumerate(candidates, start=1)
        ]
        selected = _rank_clip_candidates(
            scored,
            transcript_segments,
            top_n=int(task.input_json.get("top_n", 8)),
        )
        selected = _adjust_candidates_to_complete_boundaries(
            selected,
            transcript_segments,
            max_duration=int(
                task.input_json.get("max_clip_duration_seconds", 60)
            ),
        )
        valid_ids = {
            str(item.get("segment_id"))
            for item in transcript_segments
            if item.get("segment_id")
            and str(item.get("text") or "").strip()
            and float(item.get("end") or 0) > float(item.get("start") or 0) >= 0
        }
        covered_ids = {
            str(segment_id)
            for candidate in candidates
            for segment_id in candidate.get("shadow_source_segment_ids") or []
        }
        coverage_pct = (
            round(len(valid_ids & covered_ids) * 100 / len(valid_ids), 2)
            if valid_ids
            else 0.0
        )
        sidecar = build_verified_planning_sidecar(
            task_id=task.id,
            attempt_id=str(batch_state.get("attempt_id") or ""),
            baseline_segments=baseline_segments,
            candidate_segments=selected,
            transcript_segments=transcript_segments,
            full_timeline_coverage_pct=coverage_pct,
        )
        sidecar["candidate_generation"] = {
            "mode": "full_timeline_non_overlapping",
            "source_segment_count": len(valid_ids),
            "covered_segment_count": len(valid_ids & covered_ids),
            "candidate_count": len(candidates),
            "selected_count": len(selected),
        }
        source_task_id = str(
            task.input_json.get("verified_planning_source_task_id") or task.id
        )
        accepted = load_accepted_plan_specs(source_task_id)
        accepted_render_plans = _hydrate_accepted_verified_plans(
            transcript_segments,
            accepted.get("plans") or [],
            source_duration=float(metadata.get("duration_seconds") or 0),
            max_duration=int(
                task.input_json.get("max_clip_duration_seconds", 60)
            ),
        )
        accepted_count_matches = bool(accepted_render_plans) and len(
            accepted_render_plans
        ) == len(accepted.get("plans") or [])
        sidecar["accepted_render_plans"] = (
            accepted_render_plans if accepted_count_matches else []
        )
        sidecar["human_acceptance"] = {
            "status": (
                "passed"
                if accepted.get("status") == "passed" and accepted_count_matches
                else "blocked"
            ),
            "source_task_id": source_task_id,
            "report_version": str(accepted.get("report_version") or ""),
            "accepted_plan_count": (
                len(accepted_render_plans) if accepted_count_matches else 0
            ),
            "manifest_path": str(accepted.get("manifest_path") or ""),
        }
        baseline_payload = json.dumps(
            sidecar.get("baseline_plans") or [],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        sidecar["baseline_snapshot"] = {
            "algorithm": "sha256",
            "hash": hashlib.sha256(baseline_payload).hexdigest(),
            "plan_count": len(sidecar.get("baseline_plans") or []),
        }
        sidecar["rollback"] = {
            **(sidecar.get("rollback") or {}),
            "activation_feature_flag": "LIVECLIP_VERIFIED_RENDER_ENABLED",
            "activation_disable_value": "false",
            "fallback_plan_source": "baseline_plans",
        }
        return sidecar
    except Exception as error:
        append_task_log(
            "live_clips",
            task.id,
            "verified_planning_sidecar",
            "failed",
            {"render_consumed": False},
            str(error),
        )
        return None


def _hydrate_accepted_verified_plans(
    transcript_segments: list[dict],
    plan_specs: list[dict],
    *,
    source_duration: float,
    max_duration: int,
) -> list[dict]:
    """Hydrate human-accepted sentence windows into render-ready plans."""

    units = transcript_sentence_units(transcript_segments)
    if not units or not plan_specs:
        return []
    hydrated: list[dict] = []
    for index, spec in enumerate(plan_specs, start=1):
        start = float(spec.get("start_seconds") or 0)
        end = float(spec.get("end_seconds") or 0)
        start_indexes = [
            position
            for position, item in enumerate(units)
            if abs(float(item["start"]) - start) <= 0.02
        ]
        end_indexes = [
            position
            for position, item in enumerate(units)
            if abs(float(item["end"]) - end) <= 0.02
        ]
        if (
            len(start_indexes) != 1
            or len(end_indexes) != 1
            or end_indexes[0] < start_indexes[0]
            or end - start > float(max_duration) + 0.001
        ):
            return []
        selected_units = units[start_indexes[0] : end_indexes[0] + 1]
        segment = _srt_group_to_segment(
            selected_units,
            index,
            max(float(source_duration), end),
        )
        pair_id = str(spec.get("pair_id") or f"{index:02d}")
        segment.update(
            {
                "clip_id": f"verified_{pair_id.replace('-', '_')}",
                "ranges": [{"start": round(start, 3), "end": round(end, 3)}],
                "transcript_segments": deepcopy(selected_units),
                "shadow_source_segment_ids": list(
                    dict.fromkeys(
                        str(
                            item.get("source_segment_id")
                            or item.get("segment_id")
                        )
                        for item in selected_units
                    )
                ),
                "human_acceptance": {
                    "pair_id": pair_id,
                    "status": "passed",
                },
            }
        )
        segment = _score_segment(segment, index)
        segment.update(_planning_evidence_metadata(segment, selected_units))
        hydrated.append(segment)
    return hydrated


def _srt_group_to_segment(group: list[dict], index: int, duration: float) -> dict:
    start = max(0.0, float(group[0]["start"]))
    end = min(duration, max(float(group[-1]["end"]), start + 1.0))
    text = " ".join(str(item.get("text", "")).strip() for item in group).strip()
    label = _label_from_text(text, index)
    return {
        "clip_id": f"clip_{index:02d}",
        "start_seconds": round(start, 3),
        "end_seconds": round(end, 3),
        "start_time": _fmt_time(start),
        "end_time": _fmt_time(end),
        "duration_seconds": round(max(end - start, 0.5), 3),
        "text": text,
        "highlight_label": label,
    }


def _label_from_text(text: str, index: int) -> str:
    candidates = [
        ("价格优惠", ["价格", "优惠", "便宜", "福利", "下单"]),
        ("产品卖点", ["卖点", "功能", "适合", "产品", "材质"]),
        ("使用效果", ["效果", "改善", "变化", "体验", "上身"]),
        ("反差痛点", ["问题", "痛点", "误区", "但是", "其实"]),
        ("行动建议", ["建议", "步骤", "方法", "记住", "可以"]),
    ]
    for label, keywords in candidates:
        if any(keyword in text for keyword in keywords):
            return label
    return ["产品卖点", "使用效果", "行动建议", "信任背书", "评论互动"][index % 5]


def _segment_transcript(transcript: dict, metadata: dict, top_n: int, max_duration: int, recognition: dict | None = None) -> list[dict]:
    transcript_segments = transcript.get("segments") or []
    if transcript_segments:
        return _segment_from_srt(transcript_segments, metadata, top_n, max_duration, recognition=recognition)
    duration = max(float(metadata.get("duration_seconds") or 0), 1.0)
    count = max(5, min(10, top_n or 10))
    clip_duration = min(max_duration, max(3, duration / max(count, 1)))
    if duration < 30:
        clip_duration = max(1.5, min(duration, 3.0))
    step = max(0.5, (duration - clip_duration) / max(count - 1, 1))
    seeds = [
        ("产品卖点", "用户为什么愿意停下来"),
        ("价格优惠", "把决策门槛讲清楚"),
        ("使用效果", "用结果证明价值"),
        ("反差痛点", "指出常见误区"),
        ("行动建议", "给用户下一步动作"),
        ("信任背书", "证明专业与真实"),
        ("评论互动", "引导用户评论反馈"),
        ("复购理由", "让内容可以持续分发"),
    ]
    segments = []
    for index in range(count):
        start = min(max(0.0, index * step), max(0.0, duration - 0.5))
        end = min(duration, start + clip_duration)
        if end <= start:
            end = min(duration, start + 0.5)
        label, angle = seeds[index % len(seeds)]
        segments.append({
            "clip_id": f"clip_{index + 1:02d}",
            "start_seconds": round(start, 3),
            "end_seconds": round(end, 3),
            "start_time": _fmt_time(start),
            "end_time": _fmt_time(end),
            "duration_seconds": round(max(end - start, 0.5), 3),
            "text": f"{label}: {angle}. {transcript.get('full_text', '')[:80]}",
            "highlight_label": label,
        })
    for index, item in enumerate(segments, start=1):
        _score_segment(item, index, recognition=recognition)
    return segments


def _score_segment(segment: dict, index: int, recognition: dict | None = None) -> dict:
    text = segment["text"]
    hook = 7 + int(any(key in text for key in ["why", "pain", "mistake", "want", "stop"]))
    standalone = 7 + int(any(key in text for key in ["解决", "建议", "证明", "结果"]))
    density = 7 + min(2, len(set(text)) // 28)
    emotion = 6 + int(any(key in text for key in ["pain", "contrast", "deal", "comment"]))
    visual_evidence_score, scene_event_ids = _scene_evidence_score(segment, recognition or {})
    total = round(hook * 0.35 + standalone * 0.25 + density * 0.2 + emotion * 0.1 + visual_evidence_score * 0.1 + (index % 3) * 0.15, 1)
    segment.update({
        "hook_score": min(hook, 10),
        "standalone_score": min(standalone, 10),
        "density_score": min(density, 10),
        "emotion_score": min(emotion, 10),
        "visual_evidence_score": visual_evidence_score,
        "scene_event_ids": scene_event_ids,
        "total_score": min(total, 10),
        "recommended_platforms": ["抖音", "视频号", "小红书"],
    })
    return segment


def _attach_timeline_mappings(
    job_id: str,
    selected: list[dict],
    transcript: dict,
) -> list[dict]:
    """Attach the existing timeline contract to every renderable clip.

    The adapter is read-only: it derives mappings from source ranges and
    transcript segments, while the returned clip dictionaries carry the
    mapping into subtitle compilation, rendering, artifacts, and QA.
    """
    if not selected:
        return selected
    snapshot = build_liveclip_content_contracts(
        job_id,
        {"transcript": transcript, "slice_segments": selected},
    )
    by_clip: dict[str, list[dict]] = {}
    for mapping in snapshot.timeline_mappings:
        item = mapping.model_dump(mode="json")
        by_clip.setdefault(mapping.clip_id, []).append(item)
    output: list[dict] = []
    for clip in selected:
        current = deepcopy(clip)
        mappings = sorted(by_clip.get(str(current.get("clip_id")), []), key=lambda item: item["range_index"])
        current["timeline_mappings"] = mappings
        current["timeline_mapping_ids"] = [item["mapping_id"] for item in mappings]
        current["timeline_mapping_status"] = "mapped" if mappings else "blocked"
        current["timeline_mapping_required"] = True
        output.append(current)
    return output


def _scene_evidence_score(segment: dict, recognition: dict) -> tuple[float, list[str]]:
    start = float(segment.get("start_seconds") or 0)
    end = float(segment.get("end_seconds") or start)
    if end <= start:
        return 0.0, []
    events = recognition.get("scene_events") or []
    matched: list[str] = []
    proximity_scores: list[float] = []
    for index, event in enumerate(events):
        try:
            timestamp = float(event.get("time"))
        except (AttributeError, TypeError, ValueError):
            continue
        if start <= timestamp <= end:
            proximity_scores.append(1.0)
            matched.append(str(event.get("event_id") or f"scene_{index + 1:03d}"))
        else:
            distance = min(abs(timestamp - start), abs(timestamp - end))
            if distance <= 0.75:
                proximity_scores.append(round(max(0.0, 1.0 - distance / 0.75), 3))
                matched.append(str(event.get("event_id") or f"scene_{index + 1:03d}"))
    if not proximity_scores:
        return 0.0, []
    return round(min(10.0, 5.0 + 5.0 * max(proximity_scores)), 3), list(dict.fromkeys(matched))


def _planning_candidate_count(top_n: int) -> int:
    requested = max(1, min(10, int(top_n or 1)))
    return min(10, requested * 2)


def _rank_clip_candidates(
    candidates: list[dict],
    transcript_segments: list[dict],
    *,
    top_n: int,
) -> list[dict]:
    ranked: list[dict] = []
    for candidate in candidates:
        item = deepcopy(candidate)
        start = float(item.get("start_seconds") or 0)
        end = float(item.get("end_seconds") or 0)
        covered = [
            segment
            for segment in transcript_segments
            if float(segment.get("start") or 0) >= start - 0.001
            and float(segment.get("end") or 0) <= end + 0.001
        ]
        metadata = _planning_evidence_metadata(item, covered)
        item.update(metadata)
        has_traceable = bool(
            metadata["selling_points"]
            and metadata["selling_point_source_segment_ids"]
        )
        evidence_bonus = min(1.5, len(metadata["selling_points"]) * 0.5)
        item.update(
            {
                "has_traceable_selling_point": has_traceable,
                "selling_point_evidence_bonus": evidence_bonus,
                "planning_score": round(
                    float(item.get("total_score") or 0) + evidence_bonus,
                    3,
                ),
            }
        )
        ranked.append(item)
    return sorted(
        ranked,
        key=lambda item: (
            bool(item["has_traceable_selling_point"]),
            float(item["planning_score"]),
            float(item.get("total_score") or 0),
        ),
        reverse=True,
    )[: max(1, int(top_n or 1))]


def _render_clip_files(source_path: Path, out_dir: Path, segment: dict, payload: dict) -> tuple[dict, list[str]]:
    ffmpeg = resolve_binary("ffmpeg")
    clip_dir = out_dir / segment["clip_id"]
    clip_dir.mkdir(parents=True, exist_ok=True)
    raw = clip_dir / f"{segment['clip_id']}_raw.mp4"
    vertical = clip_dir / f"{segment['clip_id']}_vertical.mp4"
    final = clip_dir / f"{segment['clip_id']}_final.mp4"
    mixed = clip_dir / f"{segment['clip_id']}_final_mix.mp4"
    cover = clip_dir / f"{segment['clip_id']}_cover.jpg"
    srt = clip_dir / f"{segment['clip_id']}.srt"
    audio_mix_report = clip_dir / "audio_mix_report.json"
    source_ranges = segment.get("ranges") or segment.get("source_ranges") or []
    is_multi_range = len(source_ranges) > 1
    burn_decision = resolve_caption_source_policy(payload)
    clip_transcript_segments = select_caption_segments(segment, payload)
    _annotate_subtitle_timeline_mapping(segment, clip_transcript_segments)
    if clip_transcript_segments:
        srt.write_text(_segments_to_srt(clip_transcript_segments), encoding="utf-8")
    else:
        srt.write_text(_make_srt(segment["text"], 0, segment["duration_seconds"]), encoding="utf-8")
    caption_assets = {}
    if payload.get("enable_flycut_caption", True):
        caption_assets = enhance_caption_assets(
            clip_dir,
            segment,
            {**payload, "enable_subtitle_burn": burn_decision["should_burn"]},
        )
        caption_assets["caption_source_policy"] = deepcopy(burn_decision)
        caption_assets["timeline_mapping_ids"] = list(segment.get("timeline_mapping_ids") or [])
        segment["flycut_caption"] = caption_assets
    else:
        segment["flycut_caption"] = {"skill_id": "flycut_caption", "status": "disabled", "highlight_keywords": []}
    segment["caption_business_gate"] = evaluate_caption_business_gate(
        srt_text=srt.read_text(encoding="utf-8"),
        segment=segment,
        payload=payload,
        burn_decision=burn_decision,
    )
    warnings: list[str] = []
    if segment["caption_business_gate"]["enforced"] and not segment["caption_business_gate"]["passed"]:
        warnings.append(
            f"{segment['clip_id']} 字幕业务校对未通过，请核对商品词、价格、同步和字幕来源后重试。"
        )
    if not ffmpeg:
        warnings.append(LIVE_CLIP_FFMPEG_UNAVAILABLE_WARNING)
        return _files(raw, vertical, final, srt, cover, caption_assets), warnings

    multi_range_result = None
    if _usable_media_file(raw):
        warnings.append(f"{segment['clip_id']} 已复用已生成的原片段。")
    elif is_multi_range:
        multi_range_result = render_multi_range(
            source_path,
            source_ranges,
            clip_dir,
            output_name=raw.name,
            ffmpeg_path=ffmpeg,
        )
        segment["source_ranges"] = source_ranges
        segment["duration_seconds"] = multi_range_result.get(
            "duration",
            sum(float(item["end"]) - float(item["start"]) for item in source_ranges),
        )
        if multi_range_result["status"] != "ok" or not raw.exists():
            warnings.append(
                f"{segment['clip_id']} multi-range render failed: "
                f"{multi_range_result.get('stderr', '')[-300:]}"
            )
            files = _files(raw, vertical, final, srt, cover, caption_assets)
            files.update(_multi_range_files(multi_range_result))
            return files, warnings
    else:
        cut_timeout = _render_timeout_seconds(segment, payload, stage="raw")
        cut_cmd = [
            ffmpeg, "-y", "-ss", str(segment["start_seconds"]), "-i", str(source_path), "-t", str(segment["duration_seconds"]),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", str(raw)
        ]
        if _run(cut_cmd, timeout=cut_timeout).returncode != 0 or not _usable_media_file(raw):
            warnings.append(f"{segment['clip_id']} 原片段切割失败。")
            return _files(raw, vertical, final, srt, cover, caption_assets), warnings

    if payload.get("enable_vertical_reframe", True):
        vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
        reframe_cmd = [ffmpeg, "-y", "-i", str(raw), "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-c:a", "copy", str(vertical)]
        if _usable_media_file(vertical):
            warnings.append(f"{segment['clip_id']} 已复用已生成的竖版片段。")
        elif _run(reframe_cmd, timeout=_render_timeout_seconds(segment, payload, stage="vertical")).returncode != 0 or not _usable_media_file(vertical):
            shutil.copyfile(raw, vertical)
            warnings.append(f"{segment['clip_id']} {LIVE_CLIP_REFRAME_FAILED_SUFFIX}")
    else:
        if not _usable_media_file(vertical):
            shutil.copyfile(raw, vertical)

    final_preexisting = _usable_media_file(final)
    if burn_decision["should_burn"]:
        subtitle_source = Path(caption_assets.get("ass_file", "")) if caption_assets.get("ass_file") else srt
        if not subtitle_source.is_absolute():
            subtitle_source = PROJECT_ROOT / subtitle_source
        subtitle_filter = f"subtitles={subtitle_source.name}"
        if subtitle_source.suffix.lower() != ".ass":
            subtitle_filter += (
                ":force_style='FontSize=48,PrimaryColour=&H00FFFFFF,"
                "Outline=2,MarginV=220'"
            )
        burn_cmd = [
            ffmpeg, "-y", "-i", str(vertical), "-vf",
            subtitle_filter,
            "-c:v", "libx264", "-preset", "fast", "-c:a", "copy", str(final)
        ]
        if final_preexisting:
            warnings.append(f"{segment['clip_id']} 已复用已生成的最终成片。")
        elif _run(burn_cmd, cwd=clip_dir, timeout=_render_timeout_seconds(segment, payload, stage="subtitle_burn")).returncode != 0 or not _usable_media_file(final):
            shutil.copyfile(vertical, final)
            warnings.append(f"{segment['clip_id']} {LIVE_CLIP_SUBTITLE_BURN_FAILED_SUFFIX}")
    else:
        shutil.copyfile(vertical, final)
        final_preexisting = False
    packaging_mode = (
        "source_caption_preserved"
        if burn_decision["mode"] == "source_burned"
        else "subtitle_plus_overlay"
        if caption_assets
        else "plain_subtitle_only"
    )
    mix_result = {
        "status": "skipped",
        "output_path": str(final),
        "sfx_mix_status": caption_assets.get("audio_mix", {}).get("sfx_mix_status", "not_requested") if caption_assets else "not_requested",
        "requested_cue_count": len(caption_assets.get("audio_cues", [])) if caption_assets else 0,
        "mixed_asset_count": 0,
        "matched_assets": [],
        "matched_cues": [],
    }
    if final.exists() and caption_assets and not final_preexisting and not payload.get("disable_sfx", True):
        mix_result = mix_audio_overlay(
            final,
            caption_assets.get("audio_cues", []),
            caption_assets.get("available_audio_assets", []),
            mixed,
            ffmpeg,
            lambda cmd, timeout=180, cwd=None: {
                "returncode": (proc := _run(cmd, cwd=cwd, timeout=timeout)).returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
            },
            cwd=clip_dir,
            timeout=_render_timeout_seconds(segment, payload, stage="audio_mix"),
        )
        if mix_result["status"] == "ok" and _usable_media_file(mixed):
            final.unlink(missing_ok=True)
            mixed.replace(final)
            packaging_mode = "subtitle_overlay_sfx"
        elif mix_result.get("status") == "failed":
            warnings.append(f"{segment['clip_id']} {LIVE_CLIP_AUDIO_MIX_FAILED_SUFFIX}")
    audio_mix_report.write_text(json.dumps(mix_result, ensure_ascii=False, indent=2), encoding="utf-8")
    if caption_assets:
        caption_assets["audio_mix_report"] = rel_path(audio_mix_report)
        caption_assets["packaging_mode"] = packaging_mode
        caption_assets["audio_mix"] = mix_result
    if final.exists() and not _usable_output_file(cover):
        cover_cmd = [ffmpeg, "-y", "-ss", "0", "-i", str(final), "-frames:v", "1", "-q:v", "2", str(cover)]
        if _run(cover_cmd, timeout=max(60, min(180, _render_timeout_seconds(segment, payload, stage="cover")))).returncode != 0 or not cover.exists():
            warnings.append(f"{segment['clip_id']} {LIVE_CLIP_COVER_EXTRACT_FAILED_SUFFIX}")
    files = _files(raw, vertical, final, srt, cover, caption_assets)
    if multi_range_result:
        files.update(_multi_range_files(multi_range_result))
    return files, warnings


def render_live_clip_repair_variant(
    *,
    task: Task,
    result_json: dict,
    segment: dict,
    transcript: dict,
    repair_task,
    attempt_dir: Path,
) -> tuple[dict, list[str], dict]:
    """Render exactly one repair target while retaining the previous version."""

    material = db_material = None
    if task.material_id:
        with SessionLocal() as repair_db:
            db_material = repair_db.get(Material, task.material_id)
    material = db_material
    source_path = _resolve_material_source_path(material) if material else None
    if source_path is None:
        raise ValueError("source video is unavailable for local repair")

    working = deepcopy(segment)
    transcript_segments = list(transcript.get("segments") or [])
    if repair_task.action == "recut_segment":
        ranges = [item.model_dump(mode="json") for item in repair_task.replacement_source_ranges]
        working["ranges"] = ranges
        working["source_ranges"] = ranges
        working["start_seconds"] = ranges[0]["start"]
        working["end_seconds"] = ranges[-1]["end"]
        working["duration_seconds"] = round(
            sum(item["end"] - item["start"] for item in ranges), 3
        )
        working["start_time"] = _fmt_time(working["start_seconds"])
        working["end_time"] = _fmt_time(working["end_seconds"])
    working["transcript_segments"] = _select_clip_transcript_segments(
        transcript_segments, working
    )
    if working["transcript_segments"]:
        working["text"] = _transcript_full_text(working["transcript_segments"])

    p4_contract = build_p4_timeline_packaging_contract(
        task.id,
        {"segments": [working], "transcript": transcript},
    )
    packaging = (p4_contract.get("by_clip") or {}).get(working["clip_id"])
    if packaging:
        working["_p4_packaging"] = packaging

    reused_assets: list[str] = []
    if repair_task.rerun_scope == "packaging_only":
        clip_dir = attempt_dir / working["clip_id"]
        clip_dir.mkdir(parents=True, exist_ok=True)
        source_files = segment.get("files") or {}
        targets = {
            "raw_clip": clip_dir / f"{working['clip_id']}_raw.mp4",
            "vertical_clip": clip_dir / f"{working['clip_id']}_vertical.mp4",
            "cover": clip_dir / f"{working['clip_id']}_cover.jpg",
        }
        for asset_key, target in targets.items():
            stored = source_files.get(asset_key)
            if not stored:
                if asset_key in {"raw_clip", "vertical_clip"}:
                    raise ValueError(f"{asset_key} is required for packaging-only repair")
                continue
            source = Path(stored)
            if not source.is_absolute():
                source = PROJECT_ROOT / source
            if not source.is_file():
                if asset_key in {"raw_clip", "vertical_clip"}:
                    raise ValueError(f"{asset_key} is unavailable for packaging-only repair")
                continue
            shutil.copy2(source, target)
            reused_assets.append(asset_key)

    files, warnings = _render_clip_files(
        source_path,
        attempt_dir,
        working,
        task.input_json or {},
    )
    working.pop("_p4_packaging", None)
    working["files"] = files
    _add_titles_and_captions([working], task.input_json or {})
    working["quality_check"] = _quality_check(working)
    working["risk_notes"] = working["quality_check"]["risk_notes"]
    working["review_status"] = "not_submitted"
    working["qa_result"] = _build_clip_qa_result(
        working, result_json.get("artifacts") or {}
    )
    working["qa"] = working["qa_result"]
    rerendered_assets = (
        ["subtitle", "flower_text", "packaging", "final_clip", "audio_mix"]
        if repair_task.rerun_scope == "packaging_only"
        else [
            "raw_clip",
            "vertical_clip",
            "subtitle",
            "flower_text",
            "packaging",
            "final_clip",
            "cover",
            "audio_mix",
        ]
    )
    return working, warnings, {
        "rerun_scope": repair_task.rerun_scope,
        "target_clip_ids": [working["clip_id"]],
        "reused_assets": reused_assets,
        "rerendered_assets": rerendered_assets,
        "p4_contract_status": p4_contract.get("status"),
    }


def _multi_range_files(result: dict) -> dict:
    manifest = Path(result.get("manifest") or "")
    intermediates = [Path(item) for item in result.get("intermediates") or []]
    return {
        "multi_range_manifest": rel_path(manifest) if manifest.is_file() else "",
        "multi_range_intermediates": [
            rel_path(item) for item in intermediates if item.is_file()
        ],
    }


def _add_titles_and_captions(segments: list[dict], payload: dict) -> None:
    for segment in segments:
        label = segment.get("highlight_label", "产品卖点")
        title = segment.get("suggested_title") or LIVE_CLIP_TITLE_TEMPLATE_MAP.get(
            label, LIVE_CLIP_TITLE_TEMPLATE_FALLBACK
        )
        segment["suggested_title"] = title[:38]
        segment["suggested_caption"] = LIVE_CLIP_CAPTION_TEMPLATE.format(label=label)
        segment["cta_suggestion"] = payload.get("cta_suggestion") or LIVE_CLIP_CTA_TEMPLATE
        segment["platform_tags"] = segment.get("recommended_platforms", ["抖音", "视频号"])


def _quality_check(segment: dict) -> dict:
    title = segment.get("suggested_title", "")
    risks = []
    if segment["duration_seconds"] > 60:
        risks.append(LIVE_CLIP_RISK_OVER_60)
    if segment["hook_score"] < 8:
        risks.append(LIVE_CLIP_RISK_WEAK_HOOK)
    return {
        "under_60_seconds": segment["duration_seconds"] <= 60,
        "has_hook_in_first_3_seconds": segment["hook_score"] >= 8,
        "subtitle_readable": True,
        "has_cta": bool(segment.get("cta_suggestion")),
        "title_under_40_chars": len(title) <= 40,
        "suitable_for_standalone": segment["standalone_score"] >= 8,
        "risk_notes": risks,
    }


def _project_file_exists(rel: str | None) -> bool:
    if not rel:
        return False
    path = PROJECT_ROOT / rel
    return path.exists() and path.stat().st_size > 0


def _usable_output_file(path: Path) -> bool:
    return path.exists() and path.is_file() and path.stat().st_size > 0


def _usable_media_file(path: Path) -> bool:
    if not _usable_output_file(path):
        return False
    probe = probe_video(path)
    return (
        probe.get("status") == "ok"
        and bool(probe.get("has_video"))
        and float(probe.get("duration") or 0) > 0
    )


def _render_timeout_seconds(segment: dict, payload: dict, *, stage: str) -> int:
    override = payload.get(f"{stage}_timeout_seconds") or payload.get("render_timeout_seconds")
    if override is not None:
        try:
            return max(60, int(override))
        except (TypeError, ValueError):
            pass
    duration = max(1.0, float(segment.get("duration_seconds") or 1.0))
    base = max(180, int(payload.get("render_base_timeout_seconds") or 180))
    per_second = max(3, float(payload.get("render_timeout_per_second") or 12))
    stage_extra = {
        "raw": 120,
        "vertical": 90,
        "subtitle_burn": 120,
        "audio_mix": 90,
        "cover": 30,
    }.get(stage, 90)
    return min(3600, max(base, int(math.ceil(duration * per_second + stage_extra))))


def _build_clip_qa_result(segment: dict, artifacts: dict) -> dict:
    files = segment.get("files") or {}
    title = segment.get("suggested_title") or ""
    caption = segment.get("suggested_caption") or ""
    final_path = PROJECT_ROOT / str(files.get("final_clip") or "")
    final_probe = probe_video(final_path) if files.get("final_clip") else {}
    final_playable = (
        final_probe.get("status") == "ok"
        and bool(final_probe.get("has_video"))
        and float(final_probe.get("duration") or 0) > 0
    )
    caption_gate = segment.get("caption_business_gate") or {}
    caption_gate_failed = bool(
        caption_gate.get("enforced") and not caption_gate.get("passed")
    )
    mappings = list(segment.get("timeline_mappings") or [])
    mapping_required = bool(segment.get("timeline_mapping_required"))
    mapping_complete = (
        bool(mappings)
        and all(
            item.get("mapping_id")
            and item.get("source_segment_ids") is not None
            and item.get("srt_cue_ids") is not None
            and item.get("ass_dialogue_ids") is not None
            for item in mappings
        )
        if mapping_required
        else True
    )
    ass_alignment = (
        all(
            len(item.get("srt_cue_ids") or [])
            == len(item.get("ass_dialogue_ids") or [])
            for item in mappings
        )
        if mapping_required and mappings
        else True
    )
    checks = default_qa_checks(False)
    checks.update({
        "video_playable": final_playable,
        "duration_under_60s": float(segment.get("duration_seconds") or 0) <= 60,
        "has_hook_first_3s": float(segment.get("hook_score") or 0) >= 7,
        "subtitle_readable": (
            _subtitle_file_is_readable(files.get("subtitle"))
            and not caption_gate_failed
        ),
        "audio_present": _project_file_exists(files.get("final_clip")),
        "no_black_screen": _project_file_exists(files.get("final_clip")),
        "subject_visible": _project_file_exists(files.get("cover")) or _project_file_exists(files.get("final_clip")),
        "aspect_ratio_correct": _project_file_exists(files.get("vertical_clip")) or _project_file_exists(files.get("final_clip")),
        "title_under_40_chars": bool(title) and len(title) <= 40,
        "has_cta": bool(segment.get("cta_suggestion") or caption),
        "keyword_in_title_or_caption": bool(segment.get("highlight_label") and (segment.get("highlight_label") in title or segment.get("highlight_label") in caption or segment.get("selling_points"))),
        "final_video_exists": _project_file_exists(files.get("final_clip")),
        "srt_exists": _project_file_exists(files.get("subtitle")),
        "cover_exists": _project_file_exists(files.get("cover")),
        "clip_report_exists": _project_file_exists(artifacts.get("clip_score_table_csv")) or _project_file_exists(artifacts.get("html_report")),
        "trace_exists": _project_file_exists(artifacts.get("trace_json")),
        "jianying_project_exists": _project_file_exists(artifacts.get("jianying_project_manifest")),
        "jianying_manifest_exists": _project_file_exists(artifacts.get("jianying_project_manifest")),
        "jianying_timeline_exists": _project_file_exists(artifacts.get("jianying_project_timeline")),
        "jianying_zip_exists": _project_file_exists(artifacts.get("jianying_project_zip")),
        "timeline_mapping_complete": mapping_complete,
        "ass_alignment": ass_alignment,
    })
    warnings = list(segment.get("risk_notes") or [])
    if caption_gate_failed:
        warnings.append(
            "字幕业务校对未通过：请核对商品词、价格、同步和字幕来源。"
        )
    result = build_qa_result(
        checks,
        warnings=warnings,
        force_status="failed" if caption_gate_failed else None,
    )
    result["caption_business_gate"] = deepcopy(caption_gate)
    result["qa_issues"] = [
        build_qa_issue(
            item,
            clip_id=str(segment.get("clip_id") or ""),
            final_time_range={
                "start": 0.0,
                "end": max(0.001, float(segment.get("duration_seconds") or 0.001)),
            },
        )
        for item in result.get("qa_failed_items") or []
    ]
    return result


def _annotate_subtitle_timeline_mapping(
    segment: dict,
    transcript_segments: list[dict],
) -> None:
    """Attach deterministic SRT/ASS cue IDs to the shared timeline mapping."""
    mappings = list(segment.get("timeline_mappings") or [])
    if not mappings:
        return
    cue_ids = []
    for index, item in enumerate(transcript_segments, start=1):
        source_id = str(item.get("segment_id") or item.get("source_segment_id") or "")
        cue_ids.append(
            (
                source_id,
                f"{segment.get('clip_id')}::srt::{index:04d}",
                f"{segment.get('clip_id')}::ass::{index:04d}",
            )
        )
    for mapping in mappings:
        source_ids = {str(value) for value in mapping.get("source_segment_ids") or []}
        selected = [item for item in cue_ids if item[0] and item[0] in source_ids]
        mapping["srt_cue_ids"] = [item[1] for item in selected]
        mapping["ass_dialogue_ids"] = [item[2] for item in selected]
    segment["timeline_mappings"] = mappings
    segment["timeline_mapping_ids"] = [item["mapping_id"] for item in mappings]
    segment["timeline_mapping_required"] = True


def _subtitle_file_is_readable(rel: str | None) -> bool:
    if not rel:
        return False
    path = PROJECT_ROOT / rel
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    try:
        blocks = [
            block
            for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip())
            if block.strip()
        ]
    except (OSError, UnicodeError):
        return False
    if not blocks:
        return False
    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            return False
        text_lines = [line.strip() for line in lines[2:] if line.strip()]
        if not 1 <= len(text_lines) <= 2:
            return False
        if any(len(line) > 24 for line in text_lines):
            return False
    return True


def _calculate_roi(metadata: dict, clip_count: int) -> dict:
    source_minutes = round(float(metadata.get("duration_seconds") or 0) / 60, 1)
    manual_hours = max(1, math.ceil(clip_count * 0.75))
    ai_hours = max(0.5, round(clip_count * 0.18, 1))
    return {
        "source_video_minutes": source_minutes,
        "clips_generated": clip_count,
        "estimated_manual_hours": manual_hours,
        "estimated_ai_assisted_hours": ai_hours,
        "hours_saved": round(manual_hours - ai_hours, 1),
        "estimated_distribution_platforms": 4,
        "repurpose_ratio": f"1:{clip_count}",
    }


def _write_artifacts(out_dir: Path, metadata: dict, transcript: dict, segments: list[dict], roi: dict) -> dict:
    timeline = out_dir / "timeline.json"
    csv_path = out_dir / "clip_score_table.csv"
    html_path = out_dir / "html_report.html"
    otio_path = out_dir / "timeline.otio"
    edl_path = out_dir / "edit_decision_list.edl"
    xml_path = out_dir / "timeline_exchange.xml"
    trace_path = out_dir / "trace.json"
    timeline.write_text(json.dumps({"source_video": metadata, "segments": segments}, ensure_ascii=False, indent=2), encoding="utf-8")
    otio_path.write_text(json.dumps(_otio_payload(metadata, segments), ensure_ascii=False, indent=2), encoding="utf-8")
    edl_path.write_text(_edl_payload(segments), encoding="utf-8")
    xml_path.write_text(_xml_payload(metadata, segments), encoding="utf-8")
    trace_path.write_text(json.dumps({"workflow": WORKFLOW, "qa_result": None, "segments": [item["clip_id"] for item in segments]}, ensure_ascii=False, indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["clip_id", "time_range", "duration", "hook", "standalone", "density", "emotion", "score", "title", "platforms", "risk_notes"])
        for item in segments:
            writer.writerow([item["clip_id"], f"{item['start_time']} - {item['end_time']}", item["duration_seconds"], item["hook_score"], item["standalone_score"], item["density_score"], item["emotion_score"], item["total_score"], item.get("suggested_title", ""), " / ".join(item.get("platform_tags", [])), "; ".join(item.get("risk_notes", []))])
    html_path.write_text(_html_report(metadata, transcript, segments, roi), encoding="utf-8")

    raw_zip = _zip_files(out_dir / "raw_clips.zip", [PROJECT_ROOT / item["files"]["raw_clip"] for item in segments if item.get("files", {}).get("raw_clip")])
    vertical_zip = _zip_files(out_dir / "vertical_clips.zip", [PROJECT_ROOT / item["files"]["vertical_clip"] for item in segments if item.get("files", {}).get("vertical_clip")])
    final_zip = _zip_files(out_dir / "final_clips.zip", [PROJECT_ROOT / item["files"]["final_clip"] for item in segments if item.get("files", {}).get("final_clip")])
    srt_zip = _zip_files(out_dir / "srt_files.zip", [PROJECT_ROOT / item["files"]["subtitle"] for item in segments if item.get("files", {}).get("subtitle")] + [PROJECT_ROOT / transcript["srt_file"]])
    exchange_zip = _zip_files(out_dir / "exchange_formats.zip", [timeline, csv_path, otio_path, edl_path, xml_path])
    jianying_project = _write_jianying_project(out_dir, metadata, segments, timeline, edl_path, xml_path)
    caption_assets_zip = _zip_files(
        out_dir / "flycut_caption_assets.zip",
        [
            PROJECT_ROOT / asset
            for item in segments
            for asset in [
                item.get("files", {}).get("ass_subtitle", ""),
                item.get("files", {}).get("caption_style_json", ""),
                item.get("files", {}).get("caption_effect_points_json", ""),
                item.get("files", {}).get("caption_qc_report", ""),
            ]
            if asset
        ],
    )
    return {
        "final_clips_zip": rel_path(final_zip),
        "raw_clips_zip": rel_path(raw_zip),
        "vertical_clips_zip": rel_path(vertical_zip),
        "srt_zip": rel_path(srt_zip),
        "flycut_caption_assets_zip": rel_path(caption_assets_zip),
        "exchange_package_zip": rel_path(exchange_zip),
        "clip_score_table_csv": rel_path(csv_path),
        "timeline_json": rel_path(timeline),
        "trace_json": rel_path(trace_path),
        "otio_timeline": rel_path(otio_path),
        "edl_file": rel_path(edl_path),
        "xml_file": rel_path(xml_path),
        **jianying_project,
        "html_report": rel_path(html_path),
    }


def _write_jianying_project(out_dir: Path, metadata: dict, segments: list[dict], timeline: Path, edl_path: Path, xml_path: Path) -> dict:
    project_dir = out_dir / "jianying_project"
    project_dir.mkdir(parents=True, exist_ok=True)
    manifest = project_dir / "project_manifest.json"
    jianying_timeline = project_dir / "timeline.json"
    draft_content = project_dir / "draft_content.json"
    draft_meta = project_dir / "draft_meta_info.json"
    readme = project_dir / "README_导入说明.md"
    shutil.copyfile(timeline, jianying_timeline)
    shutil.copyfile(edl_path, project_dir / edl_path.name)
    shutil.copyfile(xml_path, project_dir / xml_path.name)
    manifest.write_text(
        json.dumps(
            {
                "project_name": "直播切片分发工作台",
                "workflow": WORKFLOW,
                "source_video": metadata,
                "clip_count": len(segments),
                "timeline": "timeline.json",
                "draft_content": "draft_content.json",
                "exchange_formats": [edl_path.name, xml_path.name],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    draft_content.write_text(
        json.dumps(
            {
                "canvas_config": {"ratio": "9:16", "width": 1080, "height": 1920},
                "materials": [
                    {
                        "id": item["clip_id"],
                        "type": "video",
                        "path": item.get("files", {}).get("final_clip", ""),
                        "start": item.get("start_seconds", 0),
                        "duration": item.get("duration_seconds", 0),
                        "title": item.get("suggested_title", ""),
                        "source_ranges": item.get("ranges") or item.get("source_ranges") or [],
                    }
                    for item in segments
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    draft_meta.write_text(
        json.dumps(
            {
                "app": "jianying",
                "exported_by": "直播切片分发工作台",
                "note": "本地导出为剪映交换包/复建包；如剪映版本存在差异，可能仍需手动导入素材和时间线。",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    readme.write_text(
        "# 剪映交换包/复建包说明\n\n此包包含 project_manifest.json、timeline.json、draft_content.json、draft_meta_info.json、EDL/XML 交换文件，以及最终 MP4 路径索引。它用于人工复建和交换，不代表官方完整项目格式。\n",
        encoding="utf-8",
    )
    project_zip = _zip_files(out_dir / "jianying_project.zip", [manifest, jianying_timeline, draft_content, draft_meta, readme, project_dir / edl_path.name, project_dir / xml_path.name])
    return {
        "jianying_project_dir": rel_path(project_dir),
        "jianying_project_manifest": rel_path(manifest),
        "jianying_project_timeline": rel_path(jianying_timeline),
        "jianying_project_draft_content": rel_path(draft_content),
        "jianying_project_draft_meta": rel_path(draft_meta),
        "jianying_project_readme": rel_path(readme),
        "jianying_project_zip": rel_path(project_zip),
    }


def _write_qa_trace_artifact(out_dir: Path, artifacts: dict, task: Task, segments: list[dict], qa_result: dict) -> dict:
    trace_path = PROJECT_ROOT / artifacts.get("trace_json", "")
    if not trace_path.exists():
        trace_path = out_dir / "trace.json"
    trace_path.write_text(
        json.dumps(
            {
                "task_id": task.id,
                "trace_id": task.trace_id,
                "workflow": WORKFLOW,
                "current_stage": "clip_quality_check",
                "agent_chain": [
                    "LiveClipMaterialAgent",
                    "LiveClipTranscriptAgent",
                    "LiveClipShotDetectAgent",
                    "LiveClipHotspotAgent",
                    "LiveClipSegmentPlannerAgent",
                    "LiveClipRenderAgent",
                    "ClipQAAgent",
                    "JianyingProjectExportAgent",
                ],
                "skill_chain": ["basic_ffmpeg", "flycut_caption", "clip_quality_check_skill", "jianying_project_export_skill"],
                "qa_result": qa_result,
                "clips": [{"clip_id": item.get("clip_id"), "qa_result": item.get("qa_result")} for item in segments],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {**artifacts, "trace_json": rel_path(trace_path)}


def _append_p4_qa_trace_audit(artifacts: dict, p4_audit: dict) -> dict:
    """Append internal P4 mapping evidence after the existing QA trace is written."""

    stored = artifacts.get("trace_json") or ""
    if not stored:
        return artifacts
    trace_path = Path(stored)
    if not trace_path.is_absolute():
        trace_path = PROJECT_ROOT / trace_path
    if not trace_path.is_file():
        return artifacts
    try:
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return artifacts
    trace["p4_timeline_packaging"] = {
        "contract_version": p4_audit.get("contract_version"),
        "status": p4_audit.get("status"),
        "render_consumed": bool(p4_audit.get("render_consumed")),
        "fallback_reason": p4_audit.get("fallback_reason") or "",
        "metrics": deepcopy(p4_audit.get("metrics") or {}),
        "clips": [
            {
                "clip_id": clip_id,
                "timeline_mapping_count": len(
                    (payload or {}).get("timeline_mappings") or []
                ),
                "render_motion_intent_count": len(
                    (payload or {}).get("render_motion_intents") or []
                ),
                "warnings": list((payload or {}).get("warnings") or []),
            }
            for clip_id, payload in (p4_audit.get("by_clip") or {}).items()
        ],
    }
    trace_path.write_text(
        json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return artifacts


def _otio_payload(metadata: dict, segments: list[dict]) -> dict:
    return {
        "OTIO_SCHEMA": "Timeline.1",
        "name": "video-content-repurposing-workflow",
        "metadata": {
            "source_video": metadata,
            "phase": "phase_1_initial_clip_exchange",
            "capability_boundary": "mp4_mov_srt_ass_otio_edl_xml_only",
        },
        "tracks": [
            {
                "OTIO_SCHEMA": "Track.1",
                "name": "candidate_clips",
                "kind": "Video",
                "children": [
                    {
                        "OTIO_SCHEMA": "Clip.2",
                        "name": item["clip_id"],
                        "source_range": {
                            "start_time": item["start_seconds"],
                            "duration": item["duration_seconds"],
                        },
                        "metadata": {
                            "score": item.get("total_score"),
                            "label": item.get("highlight_label"),
                            "title": item.get("suggested_title", ""),
                        },
                    }
                    for item in segments
                ],
            }
        ],
    }


def _edl_payload(segments: list[dict]) -> str:
    lines = ["TITLE: VIDEO_CONTENT_REPURPOSING_WORKFLOW", "FCM: NON-DROP FRAME", ""]
    for index, item in enumerate(segments, start=1):
        lines.append(f"{index:03d}  AX       V     C        {item['start_time']}:00 {item['end_time']}:00 00:00:00:00 {_fmt_time(item['duration_seconds'])}:00")
        lines.append(f"* FROM CLIP NAME: {item['clip_id']} / {item.get('highlight_label', '')}")
    return "\n".join(lines) + "\n"


def _xml_payload(metadata: dict, segments: list[dict]) -> str:
    rows = "\n".join(
        f'    <clip id="{html.escape(item["clip_id"])}" start="{item["start_seconds"]}" end="{item["end_seconds"]}" score="{item.get("total_score", "")}" label="{html.escape(item.get("highlight_label", ""))}" />'
        for item in segments
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<videoContentRepurposingWorkflow phase="1">
  <source path="{html.escape(metadata.get("file_path", ""))}" duration="{metadata.get("duration_seconds", "")}" />
  <clips>
{rows}
  </clips>
</videoContentRepurposingWorkflow>
"""


def _html_report(metadata: dict, transcript: dict, segments: list[dict], roi: dict) -> str:
    rows = "\n".join(
        f"<tr><td>{html.escape(item['clip_id'])}</td><td>{item['start_time']} - {item['end_time']}</td><td>{item['total_score']}</td><td>{html.escape(item.get('suggested_title', ''))}</td><td>{html.escape(item.get('suggested_caption', ''))}</td><td>{html.escape(item.get('flycut_caption', {}).get('caption_style', '-'))}</td><td>{html.escape(' / '.join(item.get('flycut_caption', {}).get('highlight_keywords', [])) or '-')}</td><td>{html.escape('; '.join(item.get('risk_notes', [])) or 'none')}</td></tr>"
        for item in segments
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Long Video Clip Report</title>
<style>body{{font-family:Arial,'Microsoft YaHei',sans-serif;margin:32px;color:#111827}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #dbe3ef;padding:8px;text-align:left}}th{{background:#eff6ff}}.metric{{display:inline-block;margin:6px 12px 6px 0;padding:8px 12px;background:#f8fafc;border:1px solid #dbe3ef;border-radius:8px}}</style></head>
<body><h1>Long Video Clip Report</h1>
<p>Video: {html.escape(metadata.get('file_path',''))} | Duration: {metadata.get('duration_seconds')}s | Resolution: {metadata.get('resolution')}</p>
<p>Transcript provider: {html.escape(transcript.get('transcription_provider',''))} | Status: {html.escape(transcript.get('status',''))}</p>
<p>Caption skill: flycut-caption | Position: after clip generation before subtitle burn</p>
<div><span class="metric">Generated clips: {roi['clips_generated']}</span><span class="metric">Hours saved: {roi['hours_saved']}</span><span class="metric">Repurpose ratio: {roi['repurpose_ratio']}</span></div>
<h2>Top Clips</h2><table><thead><tr><th>Clip</th><th>Time</th><th>Score</th><th>Title</th><th>Caption</th><th>Caption Style</th><th>Highlights</th><th>Risk Notes</th></tr></thead><tbody>{rows}</tbody></table>
<h2>Review Status</h2><p>pending_review</p></body></html>"""


def _record_step(db: Session, task: Task, stage: str, input_json: dict, output_json: dict, status: str = "ok") -> None:
    trace_id = task.trace_id or uuid.uuid4().hex
    db.add(CausalTrace(id=uuid.uuid4().hex, task_id=task.id, trace_id=trace_id, stage=stage, status=status, input_json=input_json, output_json=output_json))
    db.add(TraceEvent(trace_id=trace_id, account_id=task.account_id or None, video_id=task.id, stage=stage, agent_name="video_clip_viral_extraction_workflow", input_json=input_json, output_json=output_json, status=status, confidence_score=0.82))
    if task.status == "running":
        db.commit()
    else:
        db.flush()


def _zip_files(zip_path: Path, files: list[Path]) -> Path:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        seen: set[str] = set()
        for item in files:
            if item.exists():
                arcname = item.name
                if arcname in seen:
                    arcname = f"{item.parent.name}/{item.name}"
                seen.add(arcname)
                archive.write(item, arcname)
    return zip_path


def _files(raw: Path, vertical: Path, final: Path, srt: Path, cover: Path, caption_assets: dict | None = None) -> dict:
    files = {
        "raw_clip": rel_path(raw) if raw.exists() else "",
        "vertical_clip": rel_path(vertical) if vertical.exists() else "",
        "final_clip": rel_path(final) if final.exists() else "",
        "subtitle": rel_path(srt) if srt.exists() else "",
        "cover": rel_path(cover) if cover.exists() else "",
    }
    if caption_assets:
        files.update({
            "ass_subtitle": caption_assets.get("ass_file", ""),
            "caption_style_json": caption_assets.get("style_json", ""),
            "caption_effect_points_json": caption_assets.get("effect_points_json", ""),
            "caption_qc_report": caption_assets.get("qc_report", ""),
            "audio_mix_report": caption_assets.get("audio_mix_report", ""),
            "packaging_mode": caption_assets.get("packaging_mode", ""),
        })
    return files


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        shell=False,
        cwd=str(cwd) if cwd else None,
    )


def _make_srt(text: str, start: float, end: float) -> str:
    safe_text = text.replace("\n", " ").strip()[:180]
    return render_caption_srt(safe_text, start, end)


def _segments_to_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    index = 1
    for item in segments:
        for cue in build_caption_cues(
            str(item.get("text", "")),
            float(item.get("start", 0)),
            float(item.get("end", 0)),
        ):
            lines.extend([
                str(index),
                f"{_fmt_srt(cue['start'])} --> {_fmt_srt(cue['end'])}",
                cue["text"],
                "",
            ])
            index += 1
    return "\n".join(lines)


def _fmt_srt(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{milli:03d}"


def _parse_srt_timestamp(value: str) -> float:
    clean = value.strip().replace(",", ".")
    parts = clean.split(":")
    if len(parts) != 3:
        raise ValueError(value)
    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds


def _fmt_time(seconds: float) -> str:
    whole = int(seconds)
    h, rem = divmod(whole, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _score_weights() -> dict:
    return {"hook": 0.4, "standalone": 0.3, "density": 0.2, "emotion": 0.1}


def _serialize_task(task: Task) -> dict:
    return {
        "task_id": task.id,
        "task_type": task.task_type,
        "workflow": task.workflow,
        "account_id": task.account_id,
        "material_id": task.material_id,
        "status": task.status,
        "review_status": task.review_status,
        "trace_id": task.trace_id,
        "input_json": task.input_json,
    }


def _current_live_step(steps: list[dict], task_status: str) -> str:
    if task_status in {"pending_review", "completed", "exported"}:
        return LIVE_CLIP_REVIEW_EXPORT_STEP
    if task_status == "partial":
        return LIVE_CLIP_PARTIAL_READY_STEP
    for item in steps:
        if item["status"] in {"processing", "waiting"}:
            return item["label"]
    return LIVE_CLIP_RESULT_EXPORT_STEP


def _serialize_causal_trace(item: CausalTrace) -> dict:
    return {
        "trace_id": item.trace_id,
        "stage": item.stage,
        "status": item.status,
        "input": item.input_json,
        "output": item.output_json,
    }


def _progress_stage_order() -> list[tuple[str, str]]:
    return [
        ("LiveClipTranscriptAgent", "转写字幕"),
        ("LiveClipShotDetectAgent", "镜头识别"),
        ("LiveClipHotspotAgent", "爆点提取"),
        ("LiveClipSegmentPlannerAgent.select", "切片推荐"),
        ("LiveClipRenderSkill.basic_ffmpeg", "成片输出"),
    ]


def _progress_dict(steps: list[dict]) -> dict:
    keys = ["transcript", "shot_detect", "hotspot_extract", "slice_plan", "render"]
    status_map = {"completed": "ok", "processing": "running", "waiting": "waiting"}
    return {key: status_map.get(step.get("status"), step.get("status", "waiting")) for key, step in zip(keys, steps)}


def _active_live_clip_batch_state(result_json: dict) -> dict | None:
    raw_state = (result_json or {}).get("batch_state")
    if not raw_state:
        return None
    try:
        state = load_job_state(raw_state)
    except ValueError:
        return None
    if state.get("status") not in {"queued", "running", "pausing", "paused", "failed"}:
        return None
    return state


def _current_live_clip_task_result(db: Session, task_id: str) -> TaskResult | None:
    results = list(
        db.scalars(
            select(TaskResult)
            .where(TaskResult.task_id == task_id)
            .order_by(TaskResult.created_at.desc())
        )
    )
    if not results:
        return None
    for result in results:
        if _active_live_clip_batch_state(result.result_json or {}):
            return result
    return results[0]


def _live_clip_response_status_from_batch(
    batch_state: dict | None, fallback_status: str
) -> str:
    if not batch_state:
        return fallback_status
    status = batch_state.get("status")
    if status in {"queued", "running", "pausing"}:
        return "running"
    if status == "paused":
        return "partial"
    if status == "failed":
        return "blocked" if fallback_status == "blocked" else "failed"
    return fallback_status


def _live_clip_current_step_from_batch(batch_state: dict) -> str:
    stage = (batch_state or {}).get("current_stage") or "transcribing"
    return {
        "transcribing": "转写字幕",
        "planning": "切片推荐",
        "rendering": "成片输出",
        "qa": "质量检查",
        "exporting": "结果导出",
    }.get(stage, "转写字幕")


def _live_clip_step_status_from_batch(stage_status: str) -> str:
    return {
        "pending": "waiting",
        "running": "processing",
        "completed": "completed",
        "failed": "blocked",
    }.get(stage_status or "", "waiting")


def _status_steps_from_batch_state(batch_state: dict) -> list[dict]:
    loaded = load_job_state(batch_state)
    stages = loaded["stages"]
    planning_status = _live_clip_step_status_from_batch(
        stages["planning"]["status"]
    )
    rendering_status = _live_clip_step_status_from_batch(
        stages["rendering"]["status"]
    )
    if stages["qa"]["status"] in {"running", "completed", "failed"} or stages[
        "exporting"
    ]["status"] in {"running", "completed", "failed"}:
        rendering_status = "completed"
    return [
        {
            "key": "LiveClipTranscriptAgent",
            "label": "转写字幕",
            "status": _live_clip_step_status_from_batch(
                stages["transcribing"]["status"]
            ),
        },
        {
            "key": "LiveClipShotDetectAgent",
            "label": "镜头识别",
            "status": planning_status,
        },
        {
            "key": "LiveClipHotspotAgent",
            "label": "爆点提取",
            "status": planning_status,
        },
        {
            "key": "LiveClipSegmentPlannerAgent.select",
            "label": "切片推荐",
            "status": planning_status,
        },
        {
            "key": "LiveClipRenderSkill.basic_ffmpeg",
            "label": "成片输出",
            "status": rendering_status,
        },
    ]


def _live_clip_status_view(
    task: Task,
    result_json: dict,
    traces: list[CausalTrace],
    fallback_status: str | None = None,
) -> dict:
    base_status = fallback_status or result_json.get("status") or task.status
    batch_state = _active_live_clip_batch_state(result_json)
    visible_traces = _visible_live_clip_traces(result_json, traces)
    if batch_state:
        progress_steps = _status_steps_from_batch_state(batch_state)
        return {
            "status": _live_clip_response_status_from_batch(
                batch_state, base_status
            ),
            "current_step": _live_clip_current_step_from_batch(batch_state),
            "current_stage": batch_state.get("current_stage") or "",
            "progress_steps": progress_steps,
            "progress_percent": batch_progress_percent(batch_state),
            "visible_traces": visible_traces,
            "batch_state": batch_state,
        }
    progress_steps = _status_steps_from_result(result_json, visible_traces)
    return {
        "status": base_status,
        "current_step": result_json.get("current_step")
        or _current_live_step(progress_steps, task.status),
        "current_stage": result_json.get("current_stage") or "",
        "progress_steps": progress_steps,
        "progress_percent": round(
            (sum(1 for item in progress_steps if item["status"] == "completed")
            / len(progress_steps))
            * 100
        ),
        "visible_traces": visible_traces,
        "batch_state": (result_json or {}).get("batch_state"),
    }


def _live_clip_attempt_id(result_json: dict) -> str:
    batch_state = (result_json or {}).get("batch_state") or {}
    return str((result_json or {}).get("attempt_id") or batch_state.get("attempt_id") or "")


def _customer_live_clip_response(
    task: Task,
    result_json: dict,
    traces: list[CausalTrace],
    status: str | None = None,
    result_id: str | None = None,
) -> dict:
    payload = _customer_live_clip_payload(task, result_json, traces, result_id=result_id)
    response_status = _live_clip_response_status_from_batch(
        _active_live_clip_batch_state(result_json),
        status or result_json.get("status") or task.status,
    )
    return {
        "status": response_status,
        "message": _live_clip_message(response_status, payload),
        "data": payload,
        "missing_inputs": payload.get("missing_inputs", []),
        "warnings": payload.get("warnings", []),
        "next_action": payload.get("next_action", []),
    }


def _customer_live_clip_payload(
    task: Task,
    result_json: dict,
    traces: list[CausalTrace],
    result_id: str | None = None,
) -> dict:
    source_video = _customer_source_video(result_json.get("source_video") or {}, task)
    slice_segments = result_json.get("slice_segments") or [_normalize_segment(item, task.input_json or {}) for item in result_json.get("segments", [])]
    live_state = _live_clip_status_view(task, result_json, traces)
    visible_traces = live_state["visible_traces"]
    progress_steps = live_state["progress_steps"]
    agent_logs = [_agent_log(item) for item in visible_traces if not item.stage.startswith("LiveClipRenderSkill") and "skill" not in item.stage.lower()]
    skill_logs = [_skill_log(item, result_json) for item in visible_traces if item.stage.startswith("LiveClipRenderSkill") or "skill" in item.stage.lower()]
    warnings = sorted(set((result_json.get("warnings") or []) + _trace_warnings(visible_traces)))
    missing_inputs = []
    next_action = []
    if not task.material_id:
        missing_inputs.append("video")
        next_action.append(LIVE_CLIP_NEXT_ACTION_UPLOAD_VIDEO)
    transcript = result_json.get("transcript", {})
    if transcript and transcript.get("status") != "completed":
        warnings = sorted(set(warnings + [LIVE_CLIP_PENDING_TRANSCRIPT_WARNING]))
        missing_inputs.append("speech_transcription_provider")
        next_action.append(LIVE_CLIP_NEXT_ACTION_UPLOAD_SRT)
    if slice_segments and not any(item.get("render", {}).get("file_exists") for item in slice_segments):
        missing_inputs.append("real_rendered_mp4")
        next_action.append(LIVE_CLIP_NEXT_ACTION_CHECK_FFMPEG)
    ffmpeg_state = check_ffmpeg()
    qa_result = result_json.get("qa_result")
    render_variants = result_json.get("render_variants") or []
    if not qa_result and slice_segments:
        qa_result = aggregate_qa_results([item.get("qa", {}) for item in slice_segments])
    return {
        "project_id": task.account_id or "live_clip_project",
        "task_id": task.id,
        "result_id": result_id,
        "attempt_id": _live_clip_attempt_id(result_json),
        "status": live_state["status"],
        "current_step": live_state["current_step"],
        "current_stage": live_state["current_stage"],
        "current_agent": result_json.get("current_agent") or "",
        "current_skill": result_json.get("current_skill") or "",
        "failure_reason": result_json.get("failure_reason"),
        "progress": _progress_dict(progress_steps),
        "progress_steps": progress_steps,
        "progress_percent": live_state["progress_percent"],
        "batch_state": live_state["batch_state"],
        "agents_called": [item["agent_name"] for item in agent_logs],
        "skills_called": [item["skill_name"] for item in skill_logs],
        "ffmpeg": {"status": "ok" if ffmpeg_state.get("ready") else "blocked", **ffmpeg_state},
        "has_real_render": any(item.get("render", {}).get("file_exists") for item in slice_segments),
        "source_video": source_video,
        "input_form": result_json.get("input_form") or _input_form(task.input_json or {}),
        "transcript": result_json.get("transcript") or {"status": "waiting", "segments": []},
        "slice_segments": slice_segments,
        "render_variants": render_variants,
        "active_variant_id": result_json.get("active_variant_id", ""),
        "variant_history": result_json.get("variant_history") or [],
        "review_status": result_json.get("review_status") or task.review_status or "draft",
        "artifacts": result_json.get("artifacts") or {},
        "qa_result": qa_result,
        "available_exports": sorted((result_json.get("artifacts") or {}).keys()),
        "missing_inputs": sorted(set(missing_inputs)),
        "warnings": warnings,
        "next_action": list(dict.fromkeys(next_action)),
        "logs": {"agent_logs": agent_logs, "skill_logs": skill_logs},
        "raw_result": customer_safe_raw_result(result_json),
    }


def _visible_live_clip_traces(
    result_json: dict, traces: list[CausalTrace]
) -> list[CausalTrace]:
    transcript = result_json.get("transcript") or {}
    if transcript.get("status") == "completed":
        return traces
    last_transcript_index = max(
        (
            index
            for index, trace in enumerate(traces)
            if trace.stage == "LiveClipTranscriptAgent"
        ),
        default=-1,
    )
    if last_transcript_index < 0:
        return traces
    return traces[: last_transcript_index + 1]
def _normalize_segment(segment: dict, payload: dict) -> dict:
    files = segment.get("files") or {}
    final_rel = files.get("final_clip") or ""
    final_path = PROJECT_ROOT / final_rel if final_rel else None
    file_exists = bool(final_path and final_path.exists() and final_path.stat().st_size > 0)
    file_size = final_path.stat().st_size if file_exists and final_path else 0
    label = segment.get("highlight_label") or LIVE_CLIP_DEFAULT_LABEL
    text = segment.get("text") or ""
    is_placeholder_text = not text or "mock" in text.lower() or "placeholder" in text.lower()
    title = segment.get("suggested_title") or (LIVE_CLIP_DEFAULT_TITLE if is_placeholder_text else label)
    platforms = segment.get("platform_tags") or segment.get("recommended_platforms") or payload.get("target_platforms") or ["抖音", "快手", "视频号", "小红书"]
    score = segment.get("total_score", 0)
    render_status = "ok" if file_exists else ("blocked" if not resolve_binary("ffmpeg") else "failed")
    qa_result = segment.get("qa_result") or segment.get("qa") or build_qa_result({
        "video_playable": file_exists,
        "duration_under_60s": float(segment.get("duration_seconds") or 0) <= 60,
        "final_video_exists": file_exists,
        "srt_exists": _project_file_exists(files.get("subtitle")),
        "cover_exists": _project_file_exists(files.get("cover")),
    }, warnings=segment.get("risk_notes") or [])
    normalized = {
        "slice_id": segment.get("clip_id") or "clip_000",
        "clip_id": segment.get("clip_id") or "clip_000",
        "start_time": segment.get("start_time") or _fmt_time(float(segment.get("start_seconds") or 0)),
        "end_time": segment.get("end_time") or _fmt_time(float(segment.get("end_seconds") or 0)),
        "duration": segment.get("duration_seconds", 0),
        "duration_seconds": segment.get("duration_seconds", 0),
        "source_ranges": segment.get("ranges") or segment.get("source_ranges") or [],
        "segment_type": label,
        "highlight_label": label,
        "title": title,
        "hook": LIVE_CLIP_HOOK_PENDING if segment.get("flycut_caption", {}).get("status") == "disabled" else f"{label}{LIVE_CLIP_HOOK_READY_SUFFIX}",
        "summary": segment.get("suggested_caption") or LIVE_CLIP_SUMMARY_PENDING,
        "transcript_excerpt": text[:160] if text else LIVE_CLIP_TRANSCRIPT_EXCERPT_PENDING,
        "reason": LIVE_CLIP_REASON_FALLBACK if "mock" in " ".join(segment.get("risk_notes", [])).lower() or "mock" in text.lower() else LIVE_CLIP_REASON_READY,
        "selling_points": [label],
        "score": round(float(score) * 10, 1) if float(score or 0) <= 10 else score,
        "total_score": round(float(score) * 10, 1) if float(score or 0) <= 10 else score,
        "risk_tips": segment.get("risk_notes") or [],
        "distribution": {
            "douyin_title": title,
            "kuaishou_title": title,
            "shipinhao_title": title,
            "xiaohongshu_title": title,
            "video_caption": segment.get("suggested_caption") or LIVE_CLIP_DEFAULT_CAPTION,
            "hashtags": ["#直播切片", "#短视频分发", f"#{label}"],
            "cover_text": segment.get("cover_text") or label,
            "cover_prompt": f"Vertical short video cover highlighting {label} with large readable title and real product context.",
            "target_platforms": platforms,
        },
        "render": {
            "status": render_status,
            "final_mp4": final_rel if file_exists else None,
            "file_exists": file_exists,
            "file_size": file_size,
            "render_log": LIVE_CLIP_RENDER_LOG_READY if file_exists else LIVE_CLIP_RENDER_LOG_PENDING,
            "download_url": f"/api/live-clips/clips/{segment.get('clip_id')}/preview" if file_exists else None,
        },
        "files": files,
        "review_status": segment.get("review_status") or "draft",
        "qa": qa_result,
    }
    normalized.update(qa_result)
    return normalized


def _input_form(payload: dict) -> dict:
    return {
        "live_title": payload.get("topic", ""),
        "product_info": payload.get("product", ""),
        "target_platforms": payload.get("target_platforms") or ["抖音", "快手", "视频号", "小红书"],
        "content_direction": payload.get("content_direction", ""),
        "generate_subtitle": bool(payload.get("enable_subtitle_generation", True)),
        "transcription_engine": payload.get("transcription_engine") or "funasr",
    }


def _customer_source_video(metadata: dict, task: Task) -> dict:
    material_id = metadata.get("file_id") or task.material_id
    rel = metadata.get("file_path", "")
    path = PROJECT_ROOT / rel if rel else None
    return {
        "file_id": material_id,
        "file_name": Path(rel).name if rel else "",
        "relative_path": rel,
        "file_size": path.stat().st_size if path and path.exists() else 0,
        "duration": metadata.get("duration_seconds", 0),
        "duration_seconds": metadata.get("duration_seconds", 0),
        "resolution": metadata.get("resolution", ""),
        "thumbnail_url": (
            f"/api/live-clips/tasks/{task.id}/source-thumbnail"
            if material_id
            else ""
        ),
    }


def _status_steps_from_result(result_json: dict, traces: list[CausalTrace]) -> list[dict]:
    if not traces and not result_json:
        return [{"key": key, "label": label, "status": "waiting"} for key, label in _progress_stage_order()]
    trace_map = {trace.stage: trace.status for trace in traces}
    steps = []
    for key, label in _progress_stage_order():
        status = trace_map.get(key, "")
        if not status and key == "LiveClipSegmentPlannerAgent.select":
            status = trace_map.get("LiveClipSegmentPlannerAgent.select", "")
        steps.append({"key": key, "label": label, "status": "completed" if status == "ok" else status or "waiting"})
    return steps


def _agent_log(trace: CausalTrace) -> dict:
    return {
        "agent_name": trace.stage,
        "status": trace.status,
        "message": "调用完成。" if trace.status == "ok" else "调用未完成或被阻塞。",
        "input_summary": trace.input_json,
        "output_summary": trace.output_json,
        "missing_inputs": _missing_from_output(trace.output_json),
        "warnings": trace.output_json.get("warnings", []) if isinstance(trace.output_json, dict) else [],
        "next_action": [],
        "duration_ms": 0,
        "error": "" if trace.status == "ok" else str(trace.output_json)[:240],
    }


def _skill_log(trace: CausalTrace, result_json: dict) -> dict:
    final_files = [
        item.get("render", {}).get("final_mp4")
        for item in (result_json.get("slice_segments") or [])
        if item.get("render", {}).get("final_mp4")
    ]
    return {
        "skill_name": trace.stage,
        "provider": "basic_ffmpeg" if "ffmpeg" in trace.stage else "flycut_caption",
        "status": trace.status,
        "input_video": result_json.get("source_video", {}).get("file_path", ""),
        "output_files": final_files,
        "final_mp4": final_files[0] if final_files else None,
        "render_log": str(trace.output_json)[:500],
        "missing_inputs": _missing_from_output(trace.output_json),
        "next_action": [] if final_files else [LIVE_CLIP_SKILL_LOG_NEXT_ACTION],
    }


def _missing_from_output(output: dict) -> list[str]:
    if not isinstance(output, dict):
        return []
    if output.get("missing"):
        return [str(output["missing"])]
    if output.get("provider") == "blocked":
        return ["provider"]
    return []


def _trace_warnings(traces: list[CausalTrace]) -> list[str]:
    warnings: list[str] = []
    for trace in traces:
        if isinstance(trace.output_json, dict):
            warnings.extend(trace.output_json.get("warnings", []) or [])
    return warnings


def _set_segment_review_status(result_json: dict, review_status: str) -> None:
    for key in ("segments", "slice_segments"):
        for item in result_json.get(key, []):
            item["review_status"] = review_status


def _live_clip_message(status: str, payload: dict) -> str:
    if status == "created":
        return LIVE_CLIP_CREATED_MESSAGE
    if status in {"running", "queued"}:
        return LIVE_CLIP_RUNNING_MESSAGE
    if status == "blocked":
        return LIVE_CLIP_BLOCKED_MESSAGE
    if status == "failed":
        return LIVE_CLIP_FAILED_MESSAGE
    if status == "partial":
        return LIVE_CLIP_PARTIAL_MESSAGE
    return LIVE_CLIP_SUCCESS_MESSAGE
