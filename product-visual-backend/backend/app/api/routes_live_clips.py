from __future__ import annotations

import uuid
from pathlib import Path
import threading

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.agents.director_agent import LiveClipDirectorAgent
from backend.app.core.agent_registry import default_agent_registry
from backend.app.core.dag_persistence import DAGPersistenceStore
from backend.app.core.dag_engine import DAGEngine
from backend.app.core.database import SessionLocal, get_db
from backend.app.core.paths import EXPORTS_DIR, PROJECT_ROOT, TMP_DIR
from backend.app.core.response import api_response
from backend.app.core.task_queue import TaskQueueManager
from backend.app.core.trace_logger import TraceLogger
from backend.app.media.video_probe import probe_video
from backend.app.services.material_service import MAX_VIDEO_SIZE_BYTES, VIDEO_CONTENT_TYPES, save_material
from backend.app.services.live_clip_template_registry import get_template_registry
from backend.app.services.delivery_package_service import (
    build_delivery_package_preview,
    create_delivery_package,
    get_delivery_package,
    get_delivery_package_download_path,
)
from backend.app.services.liveclip_download_token_service import verify_delivery_package_download_token
from backend.app.services.live_clip_job_service import (
    control_persistent_job_state,
    get_persistent_job_state,
)
from backend.app.services.live_clip_service import (
    activate_live_clip_variant,
    approve_review,
    attach_material,
    attach_transcript_file,
    configure_caption_business_review,
    create_task,
    enhance_clip_caption,
    export_task,
    find_clip_file,
    get_artifact_path,
    get_live_clip_artifacts,
    get_live_clip_clips,
    get_live_clip_downloads,
    get_live_clip_jianying_project,
    get_live_clip_source_thumbnail,
    get_live_clip_status,
    get_live_clip_transcript,
    get_live_clip_transcript_export,
    get_live_clip_trace,
    get_task_result,
    mock_review_pass,
    normalize_live_clip_transcript,
    rerender_live_clip_from_transcript,
    run_task,
    save_task_state,
    submit_review,
    update_live_clip_transcript,
    validate_live_clip_plans,
)
from backend.app.media.ffmpeg_service import check_ffmpeg
from backend.app.models.task import Task, TaskResult
from backend.app.contracts.repair_task_contract import RepairRestoreRequest, RepairTask
from backend.app.services.liveclip_repair_service import (
    execute_liveclip_repair,
    list_liveclip_repairs,
    restore_liveclip_repair_attempt,
)
from backend.app.services.opening_hook_service import (
    build_opening_hook_plan,
    evaluate_opening_hook_qa,
)
from backend.app.services.product_catalog_service import (
    load_product_catalog,
    parse_product_catalog,
    save_product_catalog,
)
from backend.app.schemas.live_clip_plan import ClipPlanValidationRequest
from backend.app.schemas.live_clip_transcript import (
    TranscriptNormalizeRequest,
    TranscriptRerenderRequest,
    TranscriptUpdateRequest,
    VariantActivateRequest,
)

router = APIRouter()
SYSTEM_QUEUE = TaskQueueManager()
SYSTEM_DAG_STORE = DAGPersistenceStore(EXPORTS_DIR / "_system" / "dag_state.jsonl")
_LIVECLIP_BACKGROUND_RUNS: set[str] = set()
_LIVECLIP_BACKGROUND_RUNS_LOCK = threading.Lock()

LIVECLIP_CUSTOMER_DEMO_PLANS = [
    {
        "clip_id": "clip_001",
        "title": "女装上衣开场介绍",
        "segment_ids": ["seg_0001", "seg_0002"],
        "ranges": [{"start": 0.0, "end": 8.16}],
        "duration": 8.16,
        "score": 92,
        "reason": "开场介绍和版型卖点",
        "platform": "douyin",
    },
    {
        "clip_id": "clip_002",
        "title": "面料细节与使用场景",
        "segment_ids": ["seg_0003", "seg_0004", "seg_0005"],
        "ranges": [{"start": 8.16, "end": 16.5}],
        "duration": 8.34,
        "score": 90,
        "reason": "场景和面料证明",
        "platform": "douyin",
    },
    {
        "clip_id": "clip_003",
        "title": "搭配建议与购买提示",
        "segment_ids": ["seg_0006", "seg_0007", "seg_0008", "seg_0009"],
        "ranges": [{"start": 16.5, "end": 28.16}],
        "duration": 11.66,
        "score": 88,
        "reason": "搭配建议和行动引导",
        "platform": "douyin",
    },
]


def _liveclip_customer_state(data: dict, status: str) -> str:
    if status == "failed" or data.get("status") == "failed":
        return "failed"
    if status == "running" or data.get("status") == "running":
        return "generating"
    if not data.get("task_id") and not data.get("job_id"):
        return "draft"
    if not (data.get("source_video") or {}).get("material_id") and not data.get("slice_segments"):
        return "material_ready" if data.get("task_id") else "draft"
    if data.get("review_status") in {"pass", "approved"}:
        return "approved"
    if data.get("review_status") == "pending_review" or status == "ok":
        return "needs_review"
    if data.get("slice_segments"):
        return "preview_ready"
    return "material_ready"


def _customer_step_label(value: str) -> str:
    text = str(value or "")
    if "审核" in text or "QA" in text:
        return "QA检查"
    if "交付" in text or "导出" in text:
        return "交付完成"
    if "字幕" in text or "转写" in text:
        return "生成字幕"
    if "切片" in text or "成片" in text:
        return "生成短视频"
    if "上传" in text:
        return "上传完成"
    return text or "处理中"


def _delivery_package_zip_exists(task_id: str) -> bool:
    if not task_id:
        return False
    return (EXPORTS_DIR / task_id / "delivery_package.zip").is_file()


def _customer_clip_item(item: dict, task_id: str = "") -> dict:
    clip_id = item.get("clip_id") or item.get("slice_id") or ""
    distribution = item.get("distribution") or {}
    files = item.get("files") or {}
    qa = item.get("qa") or item.get("qa_result") or {}
    evidence = []
    for value in item.get("selling_point_evidence") or []:
        if isinstance(value, str):
            evidence.append({"claim": value, "text": value, "time_range": {}})
            continue
        if not isinstance(value, dict):
            continue
        evidence.append(
            {
                "claim": str(value.get("claim") or value.get("selling_point") or ""),
                "text": str(value.get("evidence_text") or value.get("text") or ""),
                "time_range": {
                    "start": float(value.get("source_start") or value.get("start") or 0),
                    "end": float(value.get("source_end") or value.get("end") or 0),
                },
            }
        )
    return {
        "clip_id": clip_id,
        "url": f"/api/liveclip/tasks/{task_id}/clips/{clip_id}/preview" if task_id and clip_id else (f"/api/live-clips/clips/{clip_id}/preview" if clip_id else ""),
        "download_url": f"/api/liveclip/tasks/{task_id}/clips/{clip_id}/download" if task_id and clip_id else "",
        "duration": float(item.get("duration_seconds") or item.get("duration") or 0),
        "title": item.get("title") or item.get("suggested_title") or distribution.get("douyin_title") or clip_id,
        "subtitle": "generated" if files.get("subtitle") else "",
        "qa_status": "passed" if (item.get("qa_status") or qa.get("qa_status")) == "passed" else "failed",
        "selection_reason": str(item.get("reason") or item.get("segment_reason") or ""),
        "selling_points": [
            str(value.get("claim") or value.get("text") or "")
            if isinstance(value, dict)
            else str(value)
            for value in item.get("selling_points") or []
            if value
        ],
        "evidence": evidence,
    }


_CUSTOMER_QA_PROBLEM_LABELS = {
    "subtitle_readable": "字幕可读性需要处理",
    "srt_exists": "字幕文件需要重新生成",
    "flower_text_collision": "重点文字位置需要调整",
    "clip_boundary_incomplete": "短视频开头或结尾不完整",
    "duration_under_60s": "短视频时长需要调整",
    "has_hook_first_3s": "开头吸引力需要增强",
}

_CUSTOMER_REPAIR_ACTION_LABELS = {
    "regenerate_subtitle": "重新生成这条视频的字幕包装",
    "regenerate_flower_text": "重新调整这条视频的重点文字",
    "rerender_packaging": "重新生成这条视频的视觉包装",
    "recut_segment": "重新选择这条视频的起止位置",
}


def _customer_result_record(db: Session, task_id: str) -> TaskResult | None:
    return db.scalar(
        select(TaskResult)
        .where(
            TaskResult.task_id == task_id,
            TaskResult.workflow == "video_clip_viral_extraction",
        )
        .order_by(TaskResult.created_at.desc())
    )


def _customer_result_data(db: Session, task_id: str) -> dict:
    record = _customer_result_record(db, task_id)
    return record.result_json or {} if record else {}


def _customer_qa_issue_items(data: dict) -> list[dict]:
    candidates = list((data.get("qa_result") or {}).get("qa_issues") or [])
    for clip in data.get("slice_segments") or data.get("segments") or []:
        qa = clip.get("qa") or clip.get("qa_result") or {}
        candidates.extend(qa.get("qa_issues") or [])
    output = []
    seen = set()
    for issue in candidates:
        issue_id = str(issue.get("issue_id") or "")
        if not issue_id or issue_id in seen:
            continue
        seen.add(issue_id)
        check_key = str(issue.get("check_key") or "")
        action = str(issue.get("suggested_action") or "rerender_packaging")
        time_range = issue.get("final_time_range") or {"start": 0.0, "end": 0.001}
        output.append(
            {
                "issue_id": issue_id,
                "clip_id": str(issue.get("clip_id") or ""),
                "problem": _CUSTOMER_QA_PROBLEM_LABELS.get(check_key, "这条视频需要局部调整"),
                "reason": str(issue.get("reason") or _CUSTOMER_QA_PROBLEM_LABELS.get(check_key, "需要局部调整")),
                "time_range": {
                    "start": float(time_range.get("start") or 0),
                    "end": float(time_range.get("end") or 0.001),
                },
                "action_label": _CUSTOMER_REPAIR_ACTION_LABELS.get(action, "局部重新生成"),
                "can_retry": action != "recut_segment",
            }
        )
    return output


def _find_customer_internal_issue(data: dict, issue_id: str, clip_id: str) -> dict | None:
    candidates = list((data.get("qa_result") or {}).get("qa_issues") or [])
    for clip in data.get("slice_segments") or data.get("segments") or []:
        qa = clip.get("qa") or clip.get("qa_result") or {}
        candidates.extend(qa.get("qa_issues") or [])
    return next(
        (
            item
            for item in candidates
            if str(item.get("issue_id") or "") == issue_id
            and str(item.get("clip_id") or "") == clip_id
        ),
        None,
    )


def _customer_repair_summary(data: dict) -> dict:
    state = ((data.get("internal_sidecars") or {}).get("repair_state") or {})
    current_revision = int(state.get("current_revision") or 1)
    versions = []
    for attempt in state.get("attempts") or []:
        repair_task = attempt.get("repair_task") or {}
        action = str(repair_task.get("action") or "")
        change = _CUSTOMER_REPAIR_ACTION_LABELS.get(
            action,
            "恢复上一版本" if attempt.get("status") == "restored" else "局部调整",
        ).replace("这条视频的", "")
        versions.append(
            {
                "version": int(attempt.get("repair_revision") or 1),
                "status": "已通过质检" if attempt.get("status") in {"passed", "restored"} else "需要继续处理",
                "change": change,
                "created_at": str(attempt.get("created_at") or ""),
                "is_current": int(attempt.get("repair_revision") or 0) == current_revision,
            }
        )
    return {
        "status": "ok",
        "current_version": current_revision,
        "versions": versions,
        "can_restore_previous": any(
            bool((attempt.get("repair_task") or {}).get("clip_id"))
            and bool(attempt.get("before_segment"))
            for attempt in state.get("attempts") or []
        ),
    }


def _customer_render_versions(data: dict) -> list[dict]:
    current = str(data.get("active_variant_id") or "")
    versions = []
    for item in data.get("render_variants") or []:
        variant_id = str(item.get("variant_id") or "")
        if not variant_id:
            continue
        summary = item.get("summary") or {}
        versions.append(
            {
                "version_id": variant_id,
                "name": str(item.get("template_name") or item.get("name") or "视频版本"),
                "reason": str(item.get("recommended_reason") or item.get("reason") or ""),
                "qa_status": "passed" if summary.get("qa_status") == "passed" else "failed",
                "is_current": variant_id == current,
            }
        )
    return versions


def _customer_blocked(message: str, missing_inputs: list[str] | None = None, *, status: str = "blocked") -> dict:
    return {
        "status": status,
        "message": message,
        "next_action": message,
        "missing_inputs": missing_inputs or [],
        "warnings": [message],
    }


def _customer_export_blocked(package: dict) -> dict:
    message = str(package.get("message") or "交付包暂不可用，请按提示处理后重试。")
    next_action = package.get("next_action") or [message]
    if isinstance(next_action, list):
        next_action = next_action[0] if next_action else message
    return {
        "status": package.get("status") or "blocked",
        "message": message,
        "next_action": next_action,
        "missing_inputs": package.get("missing_inputs") or [],
        "warnings": package.get("warnings") or [message],
        "zip_url": "",
        "files": {"videos": [], "subtitles": [], "copywriting": "", "manifest": ""},
    }


def _find_customer_clip(db: Session, clip_id: str) -> dict | None:
    results = list(
        db.scalars(
            select(TaskResult)
            .where(TaskResult.workflow == "video_clip_viral_extraction")
            .order_by(TaskResult.created_at.desc())
        )
    )
    for result in results:
        for clip in (result.result_json or {}).get("slice_segments") or []:
            if clip.get("clip_id") == clip_id or clip.get("slice_id") == clip_id:
                return clip
    return None


def _find_customer_clip_in_task(db: Session, task_id: str, clip_id: str) -> tuple[dict, dict] | None:
    result = get_task_result(db, task_id)
    data = result.get("data") or {}
    for clip in (data.get("slice_segments") or data.get("segments") or []):
        if clip.get("clip_id") == clip_id or clip.get("slice_id") == clip_id:
            return data, clip
    return None


def _customer_clip_file_path(clip: dict, file_key: str) -> tuple[object | None, str]:
    rel = (clip.get("files") or {}).get(file_key) or ""
    if not rel:
        return None, ""
    path = PROJECT_ROOT / rel
    return (path if path.exists() and path.is_file() else None), rel


def _start_liveclip_background_run(task_id: str) -> bool:
    with _LIVECLIP_BACKGROUND_RUNS_LOCK:
        if task_id in _LIVECLIP_BACKGROUND_RUNS:
            return False
        _LIVECLIP_BACKGROUND_RUNS.add(task_id)

    def _runner() -> None:
        try:
            append_liveclip_background_log(task_id, "background_start", "running", {})
            with SessionLocal() as background_db:
                run_task(background_db, task_id)
            append_liveclip_background_log(task_id, "background_finish", "ok", {})
        except Exception as exc:
            append_liveclip_background_log(task_id, "background_finish", "failed", {}, str(exc))
        finally:
            with _LIVECLIP_BACKGROUND_RUNS_LOCK:
                _LIVECLIP_BACKGROUND_RUNS.discard(task_id)

    thread = threading.Thread(
        target=_runner,
        name=f"liveclip-customer-start-{task_id[:8]}",
        daemon=True,
    )
    thread.start()
    return True


def append_liveclip_background_log(task_id: str, step: str, status: str, payload: dict, error: str = "") -> None:
    from backend.app.services.task_log_service import append_task_log

    append_task_log("live_clips", task_id, step, status, payload, error)


async def _save_upload_for_preflight(file: UploadFile) -> tuple[Path | None, dict]:
    safe_name = Path(file.filename or "video.bin").name.replace("..", "_")
    extension = Path(safe_name).suffix.lower()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if VIDEO_CONTENT_TYPES.get(extension) != content_type:
        return None, {
            "status": "blocked",
            "message": "仅支持扩展名与 MIME 匹配的 MP4 / MOV / FLV / TS 视频。",
            "next_action": "请上传 MP4、MOV、FLV 或 MPEG-TS 原片。",
            "missing_inputs": ["supported_video_format"],
            "warnings": ["仅支持扩展名与 MIME 匹配的 MP4 / MOV / FLV / TS 视频。"],
        }
    target_dir = TMP_DIR / "liveclip_preflight"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid.uuid4().hex}_{safe_name}"
    size = 0
    try:
        with target.open("wb") as fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_VIDEO_SIZE_BYTES:
                    target.unlink(missing_ok=True)
                    return None, {
                        "status": "blocked",
                        "message": "素材文件不能超过 10GB。",
                        "next_action": "请压缩或拆分视频后重新上传。",
                        "missing_inputs": ["file_size"],
                        "warnings": ["素材文件不能超过 10GB。"],
                    }
                fh.write(chunk)
    except OSError:
        target.unlink(missing_ok=True)
        return None, {
            "status": "blocked",
            "message": "视频读取失败，请重新选择文件。",
            "next_action": "请重新选择文件后上传。",
            "missing_inputs": ["file_read"],
            "warnings": ["视频读取失败，请重新选择文件。"],
        }
    if size <= 0:
        target.unlink(missing_ok=True)
        return None, {
            "status": "blocked",
            "message": "空文件不能作为素材。",
            "next_action": "请上传真实 MP4 / MOV / FLV / TS 原片。",
            "missing_inputs": ["non_empty_file"],
            "warnings": ["空文件不能作为素材。"],
        }
    return target, {"file_name": safe_name, "size": size, "extension": extension, "content_type": content_type}


def _customer_preflight_payload(file_info: dict, probe: dict) -> dict:
    duration = float(probe.get("duration") or 0)
    width = int(probe.get("width") or 0)
    height = int(probe.get("height") or 0)
    checks = {
        "format_supported": True,
        "has_video": bool(probe.get("has_video")),
        "has_audio": bool(probe.get("has_audio")),
        "human_voice_likely": bool(probe.get("has_audio")),
        "duration_seconds": duration,
        "duration_ok": 10 <= duration <= 60 * 60,
        "width": width,
        "height": height,
        "resolution_ok": width >= 360 and height >= 360,
        "file_size_bytes": int(file_info.get("size") or 0),
    }
    warnings = []
    missing_inputs = []
    if not checks["has_video"]:
        missing_inputs.append("video_track")
        warnings.append("未检测到视频画面轨道。")
    if not checks["has_audio"]:
        missing_inputs.append("audio_track")
        warnings.append("未检测到音轨，可能无法生成字幕。")
    if not checks["duration_ok"]:
        missing_inputs.append("duration")
        warnings.append("建议上传 10 秒以上的视频，过短视频可能无法稳定生成 3 条切片。")
    if not checks["resolution_ok"]:
        missing_inputs.append("resolution")
        warnings.append("分辨率过低，建议上传宽高均不低于 360px 的原片。")
    if checks["has_audio"]:
        warnings.append("预检已确认音轨存在；人声是否清晰会在生成字幕时最终确认。")
    status = "ok" if not missing_inputs else "blocked"
    next_action = "可以开始生成短视频。" if status == "ok" else "请按提示更换或重新导出视频后再上传。"
    return {
        "status": status,
        "message": "上传前预检通过。" if status == "ok" else "上传前预检未通过。",
        "next_action": next_action,
        "missing_inputs": missing_inputs,
        "warnings": warnings,
        "checks": checks,
        "file": file_info,
    }


@router.get("/api/live-clips/health")
@router.get("/api/liveclip/health")
def live_clip_health_api():
    ffmpeg = check_ffmpeg()
    return api_response(
        "ok" if ffmpeg.get("ready") else "blocked",
        "直播切片环境检测",
        {
            "module": "live_clips",
            "agents": [
                "LiveClipMaterialAgent",
                "LiveClipTranscriptAgent",
                "LiveClipShotDetectAgent",
                "LiveClipHotspotAgent",
                "LiveClipSegmentPlannerAgent",
                "LiveClipCopyAgent",
                "LiveClipQAAgent",
                "ClipQAAgent",
                "JianyingProjectExportAgent",
            ],
            "skills": ["basic_ffmpeg", "flycut_caption", "liveclip_slice_skill", "clip_quality_check_skill", "jianying_project_export_skill"],
            "ffmpeg": ffmpeg,
        },
        "",
        [] if ffmpeg.get("ready") else ["ffmpeg", "ffprobe"],
    )


@router.post("/api/liveclip/upload")
async def liveclip_customer_upload_api(
    title: str = Form(""),
    product: str = Form(""),
    direction: str = Form(""),
    platform: str = Form("抖音"),
    source_has_burned_subtitles: bool = Form(False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    task_payload = {
        "account_id": "liveclip_customer",
        "topic": title or "客户上传视频",
        "product": product,
        "direction": direction,
        "target_platforms": [platform] if platform else ["抖音"],
        "task_type": "live_clip",
        "workflow": "video_clip_viral_extraction",
        "transcription_engine": "faster-whisper",
        "transcription_model": str(PROJECT_ROOT / "runtime/models/faster-whisper-tiny"),
        "enable_flycut_caption": True,
        "enable_subtitle_burn": True,
        "subtitle_source_mode": (
            "source_burned" if source_has_burned_subtitles else "generated"
        ),
        "source_has_burned_subtitles": source_has_burned_subtitles,
        "enable_vertical_reframe": True,
        "top_n": 10,
        "min_clip_duration_seconds": 0,
        "max_clip_duration_seconds": 60,
    }
    task = create_task(db, task_payload)
    task_id = task["task_id"]
    material = await save_material(
        db, file, account_id="liveclip_customer", script_id="", file_type="video"
    )
    if material["status"] != "ok":
        return {
            "task_id": task_id,
            "status": "failed",
            "message": material.get("warnings", [material.get("message", "上传失败")])[0],
        }
    attached = attach_material(db, task_id, material["data"]["material_id"])
    return {
        "task_id": task_id,
        "status": "uploaded" if attached["status"] == "ok" else "failed",
    }


@router.post("/api/liveclip/preflight")
async def liveclip_customer_preflight_api(file: UploadFile = File(...)):
    target, file_info = await _save_upload_for_preflight(file)
    if not target:
        return file_info
    try:
        probe = probe_video(target)
    except Exception:
        probe = {"status": "failed"}
    finally:
        target.unlink(missing_ok=True)
    if probe.get("status") != "ok":
        return {
            "status": "blocked",
            "message": "视频探测失败，文件不是可处理的有效视频。",
            "next_action": "请检查文件完整性或重新导出后上传。",
            "missing_inputs": ["valid_video"],
            "warnings": ["视频探测失败，文件不是可处理的有效视频。"],
            "checks": {"format_supported": True},
            "file": file_info,
        }
    return _customer_preflight_payload(file_info, probe)


@router.post("/api/liveclip/catalog/upload")
async def upload_liveclip_product_catalog_api(file: UploadFile = File(...)):
    filename = Path(file.filename or "catalog.csv").name
    parsed = parse_product_catalog(await file.read(), filename)
    if parsed.get("status") != "ok":
        return api_response(
            "blocked",
            "排品表未能解析",
            parsed,
            "",
            parsed.get("missing_inputs"),
            parsed.get("warnings"),
            ["请提供包含 SKU、商品名称和价格列的 XLSX、CSV、TSV 或 HTML 排品表。"],
        )
    stored = save_product_catalog(parsed, filename)
    return api_response("ok", "排品表已导入", stored)


@router.get("/api/liveclip/catalog/{catalog_id}")
def get_liveclip_product_catalog_api(catalog_id: str):
    catalog = load_product_catalog(catalog_id)
    if not catalog:
        return api_response("blocked", "未找到排品表", {}, "", ["catalog_id"], ["排品表不存在或已失效"])
    return api_response("ok", "排品表商品列表", catalog)


@router.post("/api/liveclip/jobs/{job_id}/shadow-opening-plan")
def build_liveclip_shadow_opening_plan_api(job_id: str, catalog_id: str, sku_id: str = "", db: Session = Depends(get_db)):
    task_result = db.scalar(select(TaskResult).where(TaskResult.task_id == job_id).order_by(TaskResult.created_at.desc()))
    catalog = load_product_catalog(catalog_id)
    if not task_result:
        return api_response("blocked", "未找到任务结果", {}, "", ["task_result"], ["请先完成 ASR 转写"], ["等待任务生成 transcript 后重试。"])
    if not catalog:
        return api_response("blocked", "未找到排品表", {}, "", ["catalog_id"], ["请先上传排品表"], ["上传 XLSX/CSV/TSV/HTML 排品表后重试。"])
    products = catalog.get("products") or []
    profile = next((item for item in products if not sku_id or item.get("sku_id") == sku_id), None)
    if not profile:
        return api_response("blocked", "未找到对应商品 SKU", {}, "", ["sku_id"], ["排品表中没有对应 SKU"], ["选择有效 SKU 后重试。"])
    result_json = task_result.result_json or {}
    plan = build_opening_hook_plan(job_id, result_json, profile)
    qa = evaluate_opening_hook_qa(plan, result_json)
    return api_response(
        "ok" if qa["status"] == "passed" else "blocked",
        "开头钩子 shadow plan 已生成" if qa["status"] == "passed" else "开头钩子 shadow plan 未通过",
        {"plan": plan, "qa": qa, "render_consumed": False},
        "",
        qa.get("failed_gates") or [],
        [],
        [qa.get("next_action", "")],
    )


@router.post("/api/liveclip/start")
def liveclip_customer_start_api(payload: dict, db: Session = Depends(get_db)):
    task_id = str(payload.get("task_id") or "")
    task = db.get(Task, task_id)
    if not task:
        message = "未找到任务，请重新上传视频。"
        return {
            "status": "blocked",
            "task_id": task_id,
            "message": message,
            "next_action": message,
            "missing_inputs": ["task_id"],
            "warnings": [message],
        }
    batch = get_persistent_job_state(db, task_id)
    if batch["status"] != "ok":
        message = batch.get("message") or "任务状态不可用，请重新上传视频。"
        return {
            "status": batch["status"],
            "task_id": task_id,
            "message": message,
            "next_action": message,
            "missing_inputs": batch.get("missing_inputs") or [],
            "warnings": batch.get("warnings") or [message],
        }
    task.status = "running"
    db.commit()
    started = _start_liveclip_background_run(task_id)
    append_liveclip_background_log(
        task_id,
        "start_request_received",
        "queued" if started else "running",
        {"background_started": started},
    )
    return {
        "status": "processing",
        "task_id": task_id,
        "message": "已开始后台生成，可通过进度接口查看状态。",
        "next_action": "等待生成完成，页面会自动查询进度。",
    }


@router.get("/api/liveclip/status")
def liveclip_customer_status_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_status(db, task_id)
    data = result.get("data") or {}
    review_status = data.get("review_status")
    batch_state = data.get("batch_state") or {}
    batch_status = batch_state.get("status")
    if _delivery_package_zip_exists(task_id):
        return {
            "status": "completed",
            "progress": 100,
            "step": "交付完成",
        }
    if review_status in {"pass", "approved"}:
        return {
            "status": "completed",
            "progress": max(int(data.get("progress_percent") or 0), 90),
            "step": "审核通过",
        }
    if batch_status == "completed":
        return {
            "status": "completed",
            "progress": max(int(data.get("progress_percent") or 0), 80),
            "step": "等待审核",
        }
    status = data.get("status") or result.get("status")
    progress = int(data.get("progress_percent") or 0)
    if result.get("status") == "ok" and progress >= 100:
        status = "completed"
        step = "交付完成"
    elif status in {"ok", "running", "created"}:
        status = "processing"
        step = _customer_step_label(data.get("current_step") or "")
    elif status == "blocked":
        status = "failed"
        step = "处理失败"
    else:
        step = _customer_step_label(data.get("current_step") or "")
    return {
        "status": status,
        "progress": progress,
        "step": step,
    }


@router.get("/api/liveclip/result")
def liveclip_customer_result_api(task_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, task_id)
    data = result.get("data") or {}
    if result.get("status") == "blocked" and not (data.get("slice_segments") or data.get("segments")):
        return {"clips": [], **_customer_blocked(result.get("message") or "请先生成短视频结果。", result.get("missing_inputs") or [])}
    clips = [_customer_clip_item(item, task_id) for item in data.get("slice_segments") or data.get("segments") or []]
    return {"clips": clips, "versions": _customer_render_versions(data)}


@router.get("/api/liveclip/subtitle")
def liveclip_customer_subtitle_api(clip_id: str, db: Session = Depends(get_db)):
    srt_path = find_clip_file(db, clip_id, "subtitle")
    ass_path = find_clip_file(db, clip_id, "ass_subtitle")
    return {
        "srt": srt_path.read_text(encoding="utf-8") if srt_path and srt_path.is_file() else "",
        "ass": ass_path.read_text(encoding="utf-8") if ass_path and ass_path.is_file() else "",
    }


@router.get("/api/liveclip/tasks/{task_id}/clips/{clip_id}/subtitle")
def liveclip_customer_task_subtitle_api(task_id: str, clip_id: str, db: Session = Depends(get_db)):
    found = _find_customer_clip_in_task(db, task_id, clip_id)
    if not found:
        return {"srt": "", "ass": "", **_customer_blocked("未找到当前任务下的字幕，请先生成短视频结果。", ["clip_id"])}
    _, clip = found
    srt_path, _ = _customer_clip_file_path(clip, "subtitle")
    ass_path, _ = _customer_clip_file_path(clip, "ass_subtitle")
    if not srt_path and not ass_path:
        return {"srt": "", "ass": "", **_customer_blocked("当前短视频暂无字幕文件，请重新生成或补充字幕。", ["subtitle"])}
    return {
        "status": "ok",
        "srt": srt_path.read_text(encoding="utf-8") if srt_path else "",
        "ass": ass_path.read_text(encoding="utf-8") if ass_path else "",
    }


@router.get("/api/liveclip/copywriting")
def liveclip_customer_copywriting_api(clip_id: str, db: Session = Depends(get_db)):
    clip = _find_customer_clip(db, clip_id) or {}
    title = clip.get("title") or clip.get("suggested_title") or clip_id
    distribution = clip.get("distribution") or {}
    return {
        "titles": [
            title,
            distribution.get("douyin_title") or f"{title}｜直播切片",
            distribution.get("cover_text") or f"{title}，这段可以重点看",
        ],
        "caption": distribution.get("video_caption") or clip.get("summary") or clip.get("suggested_caption") or "",
        "tags": distribution.get("hashtags") or ["#女装", "#穿搭", "#直播切片"],
    }


@router.get("/api/liveclip/tasks/{task_id}/clips/{clip_id}/copywriting")
def liveclip_customer_task_copywriting_api(task_id: str, clip_id: str, db: Session = Depends(get_db)):
    found = _find_customer_clip_in_task(db, task_id, clip_id)
    if not found:
        return {
            "titles": [],
            "caption": "",
            "tags": [],
            **_customer_blocked("未找到当前任务下的标题文案，请先生成短视频结果。", ["clip_id"]),
        }
    _, clip = found
    title = clip.get("title") or clip.get("suggested_title") or clip_id
    distribution = clip.get("distribution") or {}
    return {
        "status": "ok",
        "titles": [
            title,
            distribution.get("douyin_title") or f"{title}｜直播切片",
            distribution.get("cover_text") or f"{title}，这段可以重点看",
        ],
        "caption": distribution.get("video_caption") or clip.get("summary") or clip.get("suggested_caption") or "",
        "tags": distribution.get("hashtags") or ["#女装", "#穿搭", "#直播切片"],
    }


@router.get("/api/liveclip/qa")
def liveclip_customer_qa_api(task_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, task_id)
    data = result.get("data") or {}
    if result.get("status") == "blocked" and not (data.get("slice_segments") or data.get("segments")):
        return {"status": "failed", "summary": [result.get("message") or "请先生成短视频结果。"], **_customer_blocked(result.get("message") or "请先生成短视频结果。", result.get("missing_inputs") or [], status="failed")}
    qa = data.get("qa_result") or {}
    status = "passed" if qa.get("qa_status") == "passed" else "failed"
    summary = ["视频可播放", "字幕完整", "内容正常"] if status == "passed" else ["需要重新处理"]
    raw_data = _customer_result_data(db, task_id)
    return {
        "status": status,
        "summary": summary,
        "issues": _customer_qa_issue_items(raw_data),
        "review_status": str(data.get("review_status") or "not_submitted"),
    }


@router.get("/api/liveclip/tasks/{task_id}/repair-summary")
def liveclip_customer_repair_summary_api(task_id: str, db: Session = Depends(get_db)):
    data = _customer_result_data(db, task_id)
    if not data:
        return _customer_blocked("当前任务还没有可查看的修改版本。", ["task_result"])
    return _customer_repair_summary(data)


@router.post("/api/liveclip/tasks/{task_id}/caption-review")
def liveclip_customer_caption_review_api(
    task_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    return configure_caption_business_review(db, task_id, payload)


@router.post("/api/liveclip/tasks/{task_id}/clips/{clip_id}/repair")
def liveclip_customer_repair_api(
    task_id: str,
    clip_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    data = _customer_result_data(db, task_id)
    issue = _find_customer_internal_issue(data, str(payload.get("issue_id") or ""), clip_id)
    if not issue:
        return _customer_blocked("未找到这条视频对应的质检问题，请刷新后重试。", ["qa_issue"])
    action = str(issue.get("suggested_action") or "rerender_packaging")
    if action == "recut_segment":
        return _customer_blocked("片段边界需要重新确认起止位置，请提交人工复核。", ["replacement_source_ranges"])
    state = ((data.get("internal_sidecars") or {}).get("repair_state") or {})
    repair_task = RepairTask(
        issue_id=str(issue.get("issue_id") or ""),
        clip_id=clip_id,
        target_asset=str(issue.get("target_asset") or "packaging"),
        final_time_range=issue.get("final_time_range") or {"start": 0.0, "end": 0.001},
        action=action,
        reason=str(issue.get("reason") or "按质检建议局部重做"),
        rerun_scope=str(issue.get("rerun_scope") or "packaging_only"),
        source_revision=int(state.get("current_revision") or 1),
    )
    repaired = execute_liveclip_repair(db, task_id, repair_task)
    repair_revision = int((repaired.get("data") or {}).get("repair_revision") or repair_task.source_revision)
    return {
        "status": repaired.get("status") or "blocked",
        "message": repaired.get("message") or "局部重做已返回结果。",
        "next_action": repaired.get("next_action") or "请重新预览并确认结果。",
        "warnings": repaired.get("warnings") or [],
        "missing_inputs": repaired.get("missing_inputs") or [],
        "version": repair_revision,
        "version_label": f"修订版本 {repair_revision}",
        "qa_status": ((repaired.get("data") or {}).get("qa_result") or {}).get("qa_status") or "",
    }


@router.post("/api/liveclip/tasks/{task_id}/restore-previous")
def liveclip_customer_restore_previous_api(
    task_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    data = _customer_result_data(db, task_id)
    state = ((data.get("internal_sidecars") or {}).get("repair_state") or {})
    clip_id = str(payload.get("clip_id") or "")
    source_attempt = next(
        (
            item
            for item in reversed(state.get("attempts") or [])
            if str(((item.get("repair_task") or {}).get("clip_id") or "")) == clip_id
            and bool(item.get("before_segment"))
        ),
        None,
    )
    if not source_attempt:
        return _customer_blocked("当前没有可恢复的上一版本。", ["previous_version"])
    restored = restore_liveclip_repair_attempt(
        db,
        task_id,
        str(source_attempt.get("attempt_id") or ""),
        source_revision=int(state.get("current_revision") or 1),
    )
    version = int((restored.get("data") or {}).get("repair_revision") or state.get("current_revision") or 1)
    return {
        "status": restored.get("status") or "blocked",
        "message": restored.get("message") or "已恢复上一版本。",
        "next_action": restored.get("next_action") or "请重新预览。",
        "warnings": restored.get("warnings") or [],
        "missing_inputs": restored.get("missing_inputs") or [],
        "version": version,
        "version_label": f"当前版本 {version}",
    }


@router.post("/api/liveclip/tasks/{task_id}/versions/{variant_id}/activate")
def liveclip_customer_activate_version_api(
    task_id: str,
    variant_id: str,
    db: Session = Depends(get_db),
):
    data = get_task_result(db, task_id).get("data") or {}
    version = next(
        (
            item
            for item in _customer_render_versions(data)
            if item["version_id"] == variant_id
        ),
        None,
    )
    if not version:
        return _customer_blocked("未找到这个视频版本，请刷新后重试。", ["video_version"])
    if version["qa_status"] != "passed":
        return _customer_blocked("这个版本尚未通过质检，不能设为主版本。", ["qa_pass"])
    activated = activate_live_clip_variant(db, task_id, variant_id)
    return {
        "status": activated.get("status") or "blocked",
        "message": "已设为当前主版本。" if activated.get("status") == "ok" else "主版本切换未完成。",
        "next_action": activated.get("next_action") or "请预览当前主版本。",
        "version_id": variant_id,
    }


@router.post("/api/liveclip/approve")
def liveclip_customer_approve_api(payload: dict, db: Session = Depends(get_db)):
    task_id = str(payload.get("task_id") or "")
    result = approve_review(
        db,
        task_id,
        reviewer=str(payload.get("reviewer") or "客户确认"),
        comment=str(payload.get("comment") or "客户确认结果可用。"),
    )
    if result["status"] != "ok":
        message = result.get("message") or "当前结果暂不能确认，请先处理质检问题。"
        return {
            "status": result["status"],
            "task_id": task_id,
            "message": message,
            "next_action": result.get("next_action") or message,
            "missing_inputs": result.get("missing_inputs") or [],
            "warnings": result.get("warnings") or [message],
        }
    return {
        "status": "approved",
        "task_id": task_id,
        "message": "结果已确认，可以下载交付包。",
        "next_action": "点击下载全部 ZIP。",
    }


@router.post("/api/liveclip/export")
def liveclip_customer_export_api(payload: dict, db: Session = Depends(get_db)):
    task_id = str(payload.get("task_id") or "")
    package = create_delivery_package(db, task_id)
    if package["status"] != "ok":
        return _customer_export_blocked(package)
    data = package["data"]
    manifest = data.get("manifest") or {}
    return {
        "status": "ok",
        "message": "交付包已生成。",
        "next_action": "点击打开 ZIP 下载。",
        "zip_url": data.get("download_url") or "",
        "files": {
            "videos": [item.get("path") for item in manifest.get("previews", []) if item.get("type") == "final_clip"],
            "subtitles": [item.get("path") for item in manifest.get("subtitles", [])],
            "copywriting": next((item.get("path") for item in manifest.get("copywriting", []) if item.get("type") == "copywriting_markdown"), ""),
            "manifest": data.get("manifest_path") or "",
        },
    }


@router.get("/api/liveclip/tasks/{task_id}/clips/{clip_id}/preview")
def liveclip_customer_task_preview_api(task_id: str, clip_id: str, db: Session = Depends(get_db)):
    found = _find_customer_clip_in_task(db, task_id, clip_id)
    if not found:
        return api_response("blocked", "未找到当前任务下的短视频。", {}, "", ["clip_id"], ["未找到当前任务下的短视频。"], ["请先生成短视频结果。"])
    _, clip = found
    path, _ = _customer_clip_file_path(clip, "final_clip")
    if not path:
        return api_response("blocked", "预览视频不存在。", {}, "", ["clip_preview"], ["预览视频不存在。"], ["请重新生成短视频。"])
    return FileResponse(path, filename=path.name, media_type="video/mp4")


@router.get("/api/liveclip/tasks/{task_id}/clips/{clip_id}/download")
def liveclip_customer_task_clip_download_api(task_id: str, clip_id: str, db: Session = Depends(get_db)):
    found = _find_customer_clip_in_task(db, task_id, clip_id)
    if not found:
        return api_response("blocked", "未找到当前任务下的短视频。", {}, "", ["clip_id"], ["未找到当前任务下的短视频。"], ["请先生成短视频结果。"])
    _, clip = found
    path, _ = _customer_clip_file_path(clip, "final_clip")
    if not path:
        return api_response("blocked", "下载视频不存在。", {}, "", ["final_clip"], ["下载视频不存在。"], ["请重新生成短视频。"])
    return FileResponse(path, filename=path.name, media_type="video/mp4")


@router.get("/api/liveclip/logs")
def liveclip_customer_logs_api(task_id: str, db: Session = Depends(get_db)):
    status = get_live_clip_status(db, task_id).get("data") or {}
    result = get_task_result(db, task_id)
    has_result = result.get("status") == "ok"
    logs = [
        {"time": "", "event": "Task Created", "message": "任务已创建"},
        {"time": "", "event": "Video Uploaded", "message": "视频已上传"},
    ]
    if status.get("progress_percent", 0) > 0 or has_result:
        logs.append({"time": "", "event": "Processing Started", "message": "已开始处理"})
    if has_result:
        logs.extend([
            {"time": "", "event": "Clips Generated", "message": "短视频已生成"},
            {"time": "", "event": "QA Passed", "message": "质检已通过"},
            {"time": "", "event": "Delivery Ready", "message": "交付包已准备好"},
        ])
    return {"logs": logs}


@router.post("/api/liveclip/execute")
def execute_liveclip_workflow_api(payload: dict):
    director = LiveClipDirectorAgent()
    plan = director.plan(payload or {})
    queue = TaskQueueManager()
    queue.push(
        "liveclip_queue",
        task_id=plan["task_id"],
        node="workflow_dispatch",
        agent="director_agent",
        worker_type="cpu",
        payload={"workflow": plan["workflow"]},
        priority=int((payload or {}).get("priority") or 100),
    )
    for index, node in enumerate(plan["dag"]):
        queue.push_for_agent(
            task_id=plan["task_id"],
            node=node["node"],
            agent=node["agent"],
            payload={"depends_on": node.get("depends_on") or []},
            priority=index,
        )

    trace_logger = TraceLogger()
    engine = DAGEngine(
        agent_registry=default_agent_registry,
        trace_logger=trace_logger,
        persistence=SYSTEM_DAG_STORE,
        max_retries=int((payload or {}).get("max_retries") or 1),
    )
    execution = engine.execute(
        task_id=plan["task_id"],
        dag=plan["dag"],
        dag_id=plan["dag_id"],
        resume=bool((payload or {}).get("resume")),
        context={"request": payload or {}, "workflow": plan["workflow"]},
    )
    return api_response(
        "ok" if execution["status"] == "ok" else "failed",
        "LiveClip v1.4 调度执行完成" if execution["status"] == "ok" else "LiveClip v1.4 调度执行失败",
        {
            "task_id": plan["task_id"],
            "dag_id": plan["dag_id"],
            "workflow": plan["workflow"],
            "dag": plan["dag"],
            "director_plan": plan,
            "queue_snapshot": queue.snapshot(),
            "execution": execution,
        },
    )


@router.post("/api/liveclip/director/replay")
def replay_liveclip_director_api(payload: dict):
    replay = LiveClipDirectorAgent().replay(payload or {})
    trace_logger = TraceLogger()
    trace_logger.record(
        task_id=replay["task_id"],
        dag_id=replay["dag_id"],
        node="director_replay",
        agent="director_agent",
        status="ok",
        worker="cpu_worker",
        node_input=payload or {},
        node_output={"dag": replay["dag"], "workflow": replay["workflow"]},
    )
    return api_response(
        "ok",
        "Director DAG replay 已生成",
        {**replay, "trace": trace_logger.records(), "trace_graph": trace_logger.graph()},
    )


@router.get("/api/liveclip/system/state")
def liveclip_system_state_api():
    queue_state = SYSTEM_QUEUE.snapshot()
    dag_records = SYSTEM_DAG_STORE.load_all()
    return api_response(
        "ok",
        "LiveClip 调度系统状态",
        {
            "queues": queue_state["queues"],
            "workers": queue_state["workers"],
            "running_tasks": [],
            "resource_usage": {
                "gpu": {"mode": "observed", "active_workers": 0},
                "cpu": {"mode": "observed", "active_workers": 0},
            },
            "dag_running_nodes": [
                item for item in dag_records if item.get("status") == "running"
            ],
        },
    )


@router.post("/api/live-clips/tasks")
@router.post("/api/video-clip-viral-extraction/tasks")
def create_live_clip_task_api(payload: dict, db: Session = Depends(get_db)):
    task = create_task(db, {**payload, "task_type": "live_clip", "workflow": payload.get("workflow") or "video_clip_viral_extraction"})
    return api_response("ok", "直播切片任务已创建", task)


@router.post("/api/liveclip/jobs/create")
def create_liveclip_job_api(payload: dict, db: Session = Depends(get_db)):
    task = create_task(
        db,
        {
            **payload,
            "task_type": "live_clip",
            "workflow": payload.get("workflow") or "video_clip_viral_extraction",
        },
    )
    return api_response("ok", "直播切片任务已创建", {"job_id": task["task_id"], **task})


@router.post("/api/liveclip/materials/upload")
async def upload_liveclip_material_api(
    job_id: str = Form(""),
    account_id: str = Form("live_clip_demo"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not job_id:
        created = create_task(
            db,
            {
                "account_id": account_id,
                "task_type": "live_clip",
                "workflow": "video_clip_viral_extraction",
            },
        )
        job_id = created["task_id"]
    material = await save_material(
        db, file, account_id=account_id, script_id="", file_type="video"
    )
    if material["status"] != "ok":
        return api_response(
            material["status"],
            "上传失败",
            material.get("data"),
            "",
            material.get("missing_inputs"),
            material.get("warnings"),
            material.get("next_action"),
        )
    attached = attach_material(db, job_id, material["data"]["material_id"])
    return api_response(
        attached["status"],
        "长视频已上传并绑定任务",
        {
            "job_id": job_id,
            **attached.get("data", {}),
            "material": material["data"],
        },
        "",
        attached.get("missing_inputs"),
        attached.get("warnings"),
        attached.get("next_action"),
    )


@router.get("/api/live-clips/templates")
def live_clip_templates_api():
    return api_response("ok", "直播切片包装模板中心", {"items": get_template_registry()})


@router.post("/api/live-clips/tasks/{task_id}/upload")
async def upload_live_clip_video_api(
    task_id: str,
    account_id: str = Form("live_clip_demo"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    material = await save_material(db, file, account_id=account_id, script_id="", file_type="video")
    if material["status"] != "ok":
        return api_response(material["status"], "上传失败", material.get("data"), "", material.get("missing_inputs"), material.get("warnings"), material.get("next_action"))
    attached = attach_material(db, task_id, material["data"]["material_id"])
    return api_response(attached["status"], "长视频已上传并绑定任务", {**attached.get("data", {}), "material": material["data"]}, "", attached.get("missing_inputs"))


@router.post("/api/live-clips/tasks/{task_id}/subtitle")
async def upload_live_clip_subtitle_api(task_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("gb18030", errors="ignore")
    result = attach_transcript_file(db, task_id, file.filename or "transcript.srt", content)
    return api_response(result["status"], "字幕文件已上传并绑定任务" if result["status"] == "ok" else "字幕文件上传失败", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.post("/api/live-clips/tasks/{task_id}/run")
@router.post("/api/video-clip-viral-extraction/tasks/{task_id}/run")
def run_live_clip_task_api(task_id: str, db: Session = Depends(get_db)):
    result = run_task(db, task_id)
    message = result.get("message") or ("直播切片处理完成" if result["status"] == "ok" else "直播切片任务被阻塞")
    return api_response(result["status"], message, result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.get("/api/live-clips/tasks/{task_id}/status")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/status")
def live_clip_status_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_status(db, task_id)
    return api_response(result["status"], "任务进度", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/liveclip/jobs/{job_id}/previews")
def liveclip_job_previews_api(job_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_clips(db, job_id)
    items = []
    for clip in (result.get("data") or {}).get("items", []):
        clip_id = clip.get("clip_id") or clip.get("slice_id")
        if clip_id:
            items.append(
                {
                    "clip_id": clip_id,
                    "title": clip.get("title") or clip.get("suggested_title") or "",
                    "preview_url": f"/api/live-clips/clips/{clip_id}/preview",
                    "duration_seconds": clip.get("duration_seconds") or clip.get("duration") or 0,
                }
            )
    return api_response(
        result["status"],
        "成片预览列表" if result["status"] == "ok" else "成片预览不可用",
        {"job_id": job_id, "items": items, "count": len(items)},
        "",
        result.get("missing_inputs"),
    )


@router.post("/api/liveclip/jobs/{job_id}/rerun")
def rerun_liveclip_job_api(job_id: str, db: Session = Depends(get_db)):
    result = run_task(db, job_id)
    return api_response(
        result["status"],
        result.get("message") or "直播切片任务已重新执行",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.post("/api/liveclip/jobs/{job_id}/approve")
def approve_liveclip_job_api(
    job_id: str,
    payload: dict | None = None,
    db: Session = Depends(get_db),
):
    payload = payload or {}
    result = approve_review(
        db,
        job_id,
        reviewer=str(payload.get("reviewer") or "客户审核"),
        comment=str(payload.get("comment") or ""),
    )
    return api_response(
        result["status"],
        "任务审核通过" if result["status"] == "ok" else "任务审核未通过",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.post("/api/liveclip/jobs/{job_id}/delivery-package")
def create_liveclip_delivery_package_api(job_id: str, db: Session = Depends(get_db)):
    result = create_delivery_package(db, job_id)
    return api_response(
        result["status"],
        result.get("message", "交付包生成结果"),
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/jobs/{job_id}/copywriting")
def liveclip_job_copywriting_api(job_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, job_id)
    data = result.get("data") or {}
    items = []
    for clip in data.get("slice_segments") or []:
        distribution = clip.get("distribution") or {}
        items.append(
            {
                "clip_id": clip.get("clip_id") or clip.get("slice_id"),
                "title": clip.get("title") or distribution.get("douyin_title") or "",
                "caption": distribution.get("video_caption") or clip.get("summary") or "",
                "cover_text": distribution.get("cover_text") or "",
                "hashtags": distribution.get("hashtags") or [],
            }
        )
    return api_response(
        result["status"],
        "标题与文案建议",
        {"job_id": job_id, "items": items, "count": len(items)},
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/jobs/{job_id}/qa-summary")
def liveclip_job_qa_summary_api(job_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, job_id)
    qa = ((result.get("data") or {}).get("qa_result") or {})
    summary = {
        "qa_status": qa.get("qa_status"),
        "qa_score": qa.get("qa_score"),
        "qa_pass": qa.get("qa_pass"),
        "failed_count": len(qa.get("qa_failed_items") or []),
        "qa_failed_items": qa.get("qa_failed_items") or [],
        "qa_warnings": qa.get("qa_warnings") or [],
        "qa_failure_reason": qa.get("qa_failure_reason"),
    }
    return api_response(
        result["status"],
        "QA 摘要",
        {"job_id": job_id, "qa_summary": summary},
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/jobs/{job_id}/debug")
def liveclip_job_debug_api(job_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, job_id)
    package_preview = build_delivery_package_preview(db, job_id)
    return api_response(
        result["status"],
        "内部调试信息",
        {
            "job_id": job_id,
            "result": result.get("data") or {},
            "delivery_package_preview": package_preview.get("data") or {},
        },
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/jobs/{job_id}")
def liveclip_job_api(job_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, job_id)
    data = result.get("data") or {}
    customer_state = _liveclip_customer_state(data, result["status"])
    return api_response(
        result["status"],
        result.get("message", "任务结果"),
        {"job_id": job_id, "customer_state": customer_state, **data},
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/delivery-packages/{package_id}")
def liveclip_delivery_package_api(package_id: str):
    result = get_delivery_package(package_id)
    return api_response(
        result["status"],
        result.get("message", "交付包详情"),
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/liveclip/delivery-packages/{package_id}/download")
def download_liveclip_delivery_package_api(package_id: str, token: str = ""):
    if not verify_delivery_package_download_token(package_id, token):
        return api_response(
            "blocked",
            "下载链接已失效，请重新生成或刷新交付包下载链接。",
            {},
            "",
            ["download_token"],
            ["下载链接已失效，请重新生成或刷新交付包下载链接。"],
            ["重新点击下载交付包。"],
        )
    path = get_delivery_package_download_path(package_id)
    if not path:
        return api_response("blocked", "交付包下载文件不存在", {}, "", ["package_id"], ["交付包下载文件不存在"], ["重新生成交付包。"])
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/zip",
    )


@router.get("/api/live-clips/tasks/{task_id}/batch")
def live_clip_batch_state_api(task_id: str, db: Session = Depends(get_db)):
    result = get_persistent_job_state(db, task_id)
    return api_response(
        result["status"],
        "批量任务状态",
        result.get("data"),
        "",
        result.get("missing_inputs"),
    )


@router.post("/api/live-clips/tasks/{task_id}/batch/{action}")
def control_live_clip_batch_api(
    task_id: str, action: str, db: Session = Depends(get_db)
):
    if action not in {"pause", "resume", "retry"}:
        raise HTTPException(status_code=400, detail="unsupported batch action")
    result = control_persistent_job_state(db, task_id, action)
    return api_response(
        result["status"],
        "批量任务状态已更新" if result["status"] == "ok" else "批量任务操作被阻塞",
        result.get("data"),
        "",
        result.get("missing_inputs"),
    )


@router.get("/api/live-clips/tasks/{task_id}/clips")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/clips")
def live_clip_clips_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_clips(db, task_id)
    return api_response(result["status"], "候选切片列表", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/live-clips/tasks/{task_id}/result")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/result")
def live_clip_result_api(task_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, task_id)
    return api_response(result["status"], result.get("message", "任务结果"), result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.post("/api/live-clips/tasks/{task_id}/clip-plans/validate")
def validate_live_clip_plans_api(
    task_id: str,
    payload: ClipPlanValidationRequest,
    db: Session = Depends(get_db),
):
    result = validate_live_clip_plans(
        db,
        task_id,
        payload.model_dump(exclude_none=True),
    )
    message = (
        "切片规划校验通过"
        if result["status"] == "ok"
        else result.get("message") or "切片规划校验被阻塞"
    )
    return api_response(
        result["status"],
        message,
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/live-clips/tasks/{task_id}/transcript")
def live_clip_transcript_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_transcript(db, task_id)
    return api_response(
        result["status"],
        "字幕详情" if result["status"] == "ok" else "字幕不可用",
        result.get("data"),
        "",
        result.get("missing_inputs"),
    )


@router.put("/api/live-clips/tasks/{task_id}/transcript")
def update_live_clip_transcript_api(
    task_id: str,
    payload: TranscriptUpdateRequest,
    db: Session = Depends(get_db),
):
    result = update_live_clip_transcript(
        db,
        task_id,
        payload.revision,
        [segment.model_dump(exclude_none=True) for segment in payload.segments],
    )
    return api_response(
        result["status"],
        "字幕已更新" if result["status"] == "ok" else "字幕更新被阻塞",
        result.get("data"),
        "",
        result.get("missing_inputs"),
    )


@router.post("/api/live-clips/tasks/{task_id}/transcript/normalize")
def normalize_live_clip_transcript_api(
    task_id: str,
    payload: TranscriptNormalizeRequest,
    db: Session = Depends(get_db),
):
    result = normalize_live_clip_transcript(
        db, task_id, payload.revision, payload.merge_gap_ms
    )
    return api_response(
        result["status"],
        "字幕已规范化" if result["status"] == "ok" else "字幕规范化被阻塞",
        result.get("data"),
        "",
        result.get("missing_inputs"),
    )


@router.post("/api/live-clips/tasks/{task_id}/transcript/rerender")
def rerender_live_clip_transcript_api(
    task_id: str,
    payload: TranscriptRerenderRequest,
    db: Session = Depends(get_db),
):
    result = rerender_live_clip_from_transcript(
        db,
        task_id,
        payload.revision,
        payload.template_ids,
        payload.active_template_id,
    )
    return api_response(
        result["status"],
        "字幕改动已触发重新包装" if result["status"] == "ok" else "重新包装被阻塞",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.post("/api/live-clips/tasks/{task_id}/repairs")
def execute_live_clip_repair_api(
    task_id: str,
    payload: RepairTask,
    db: Session = Depends(get_db),
):
    result = execute_liveclip_repair(db, task_id, payload)
    return api_response(
        result["status"],
        result.get("message")
        or ("局部返修已完成" if result["status"] == "ok" else "局部返修被阻塞"),
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/live-clips/tasks/{task_id}/repairs")
def list_live_clip_repairs_api(
    task_id: str,
    db: Session = Depends(get_db),
):
    result = list_liveclip_repairs(db, task_id)
    return api_response(
        result["status"],
        "返修记录已读取" if result["status"] == "ok" else "返修记录不可用",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.post("/api/live-clips/tasks/{task_id}/repairs/{attempt_id}/restore")
def restore_live_clip_repair_api(
    task_id: str,
    attempt_id: str,
    payload: RepairRestoreRequest,
    db: Session = Depends(get_db),
):
    result = restore_liveclip_repair_attempt(
        db,
        task_id,
        attempt_id,
        source_revision=payload.source_revision,
    )
    return api_response(
        result["status"],
        result.get("message")
        or ("已恢复返修前版本" if result["status"] == "ok" else "恢复被阻塞"),
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )
@router.post("/api/live-clips/tasks/{task_id}/variants/activate")
def activate_live_clip_variant_api(
    task_id: str,
    payload: VariantActivateRequest,
    db: Session = Depends(get_db),
):
    result = activate_live_clip_variant(db, task_id, payload.variant_id)
    return api_response(
        result["status"],
        "宸插垏鎹富鐗堟湰" if result["status"] == "ok" else "鍒囨崲涓荤増鏈闃诲",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.get("/api/live-clips/tasks/{task_id}/transcript/export/{export_format}")
def export_live_clip_transcript_api(
    task_id: str, export_format: str, db: Session = Depends(get_db)
):
    if export_format not in {"txt", "srt", "ass", "timeline"}:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported transcript export format: {export_format}",
        )
    result = get_live_clip_transcript_export(db, task_id, export_format)
    if result["status"] != "ok":
        return api_response(
            result["status"],
            "字幕导出文件不可用",
            result.get("data"),
            "",
            result.get("missing_inputs"),
        )
    path = result["data"]["path"]
    media_type = {
        "txt": "text/plain; charset=utf-8",
        "srt": "application/x-subrip",
        "ass": "text/plain; charset=utf-8",
        "timeline": "application/json",
    }[export_format]
    return FileResponse(
        path,
        filename=f"full_transcript.{export_format}",
        media_type=media_type,
    )


@router.get("/api/live-clips/clips/{clip_id}/preview")
def live_clip_preview_api(clip_id: str, db: Session = Depends(get_db)):
    path = find_clip_file(db, clip_id, "final_clip")
    if not path:
        return api_response("blocked", "预览视频不存在", {}, "", ["clip_preview"])
    return FileResponse(path, filename=path.name, media_type="video/mp4")


@router.get("/api/live-clips/tasks/{task_id}/source-thumbnail")
def live_clip_source_thumbnail_api(
    task_id: str,
    db: Session = Depends(get_db),
):
    result = get_live_clip_source_thumbnail(db, task_id)
    if result["status"] != "ok":
        return api_response(
            result["status"],
            "源视频缩略图不可用",
            result.get("data"),
            "",
            result.get("missing_inputs"),
            result.get("warnings"),
        )
    return FileResponse(result["data"]["path"], media_type="image/jpeg")


@router.post("/api/live-clips/clips/{clip_id}/caption-enhance")
def live_clip_caption_enhance_api(clip_id: str, db: Session = Depends(get_db)):
    result = enhance_clip_caption(db, clip_id)
    return api_response(result["status"], "字幕增强结果", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/live-clips/tasks/{task_id}/review")
def live_clip_review_api(task_id: str, db: Session = Depends(get_db)):
    result = submit_review(db, task_id)
    return api_response(result["status"], result.get("message", "已提交人工审核"), result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.post("/api/live-clips/tasks/{task_id}/review/approve")
def live_clip_review_approve_api(
    task_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    result = approve_review(
        db,
        task_id,
        reviewer=str(payload.get("reviewer") or ""),
        comment=str(payload.get("comment") or ""),
    )
    return api_response(
        result["status"],
        "任务审核通过" if result["status"] == "ok" else "任务审核未通过",
        result.get("data"),
        "",
        result.get("missing_inputs"),
        result.get("warnings"),
        result.get("next_action"),
    )


@router.post("/api/live-clips/tasks/{task_id}/save")
def live_clip_save_api(task_id: str, db: Session = Depends(get_db)):
    result = save_task_state(db, task_id)
    return api_response(result["status"], "任务已保存" if result["status"] == "ok" else "任务保存失败", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.post("/api/live-clips/tasks/{task_id}/review/mock-pass")
def live_clip_mock_review_pass_api(task_id: str, db: Session = Depends(get_db)):
    result = mock_review_pass(db, task_id)
    return api_response(result["status"], result.get("message", "模拟审核通过，仅用于测试"), result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.post("/api/live-clips/tasks/{task_id}/export")
def live_clip_export_api(task_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    result = export_task(db, task_id, (payload or {}).get("export_type", "final_clips_zip"))
    data = result.get("data") or {}
    if data.get("download_url"):
        data = {**data, "download_url": data["download_url"].replace("/api/tasks/", "/api/live-clips/tasks/")}
    return api_response(result["status"], "导出物已生成" if result["status"] == "ok" else "导出物不可用", data, "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.get("/api/live-clips/tasks/{task_id}/logs")
def live_clip_logs_api(task_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, task_id)
    data = result.get("data") or {}
    return api_response(result["status"], "任务日志", {"task_id": task_id, "logs": data.get("logs", {})}, "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.get("/api/live-clips/tasks/{task_id}/artifacts")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/artifacts")
def live_clip_artifacts_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_artifacts(db, task_id)
    return api_response(result["status"], "导出物与 QA 结果", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/live-clips/tasks/{task_id}/jianying-project")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/jianying-project")
def live_clip_jianying_project_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_jianying_project(db, task_id)
    return api_response(result["status"], "剪映交换包/复建包", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/live-clips/tasks/{task_id}/trace")
@router.get("/api/video-clip-viral-extraction/tasks/{task_id}/trace")
def live_clip_trace_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_trace(db, task_id)
    return api_response(result["status"], "执行链路 trace", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/live-clips/tasks/{task_id}/downloads")
def live_clip_downloads_api(task_id: str, db: Session = Depends(get_db)):
    result = get_live_clip_downloads(db, task_id)
    return api_response(result["status"], "任务下载列表", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/live-clips/tasks/{task_id}/download/{artifact_key}")
def live_clip_download_artifact_api(task_id: str, artifact_key: str, db: Session = Depends(get_db)):
    path = get_artifact_path(db, task_id, artifact_key)
    if not path:
        return api_response("blocked", "导出物不存在", {}, "", [artifact_key])
    return FileResponse(path, filename=path.name)
