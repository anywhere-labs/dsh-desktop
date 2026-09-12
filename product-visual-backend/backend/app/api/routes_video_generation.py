from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services import video_replica_service as service
from backend.app.video_generation.orchestrator import build_replication_dag, validate_replication_dag
from backend.app.video_generation.tracking import tracker_preflight

router = APIRouter()


@router.get("/api/video-generation/capabilities")
def capabilities_api():
    return api_response("ok", "像素保真背景替换能力", {
        "generation_mode": "PIXEL_PRESERVED_BACKGROUND_REPLACEMENT",
        "workflow": service.WORKFLOW,
        "dag": build_replication_dag(),
        "dag_validation": validate_replication_dag(),
        "providers": {"foreground": "not_configured", "background": "upload_only"},
        "tracking": tracker_preflight(),
    })


@router.post("/api/video-generation/tasks")
def create_task_api(payload: dict, db: Session = Depends(get_db)):
    result = service.create_task(db, payload)
    return api_response(result["status"], "任务已创建" if result["status"] == "ok" else "任务创建被阻塞", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"))


@router.post("/api/video-generation/tasks/{task_id}/source")
async def upload_source_api(task_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    result = await service.upload_source(db, task_id, file)
    return api_response(result["status"], "原视频已接收并完成探测" if result["status"] == "ok" else "原视频接收被阻塞", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"))


@router.post("/api/video-generation/tasks/{task_id}/selections")
def save_selections_api(task_id: str, payload: dict, db: Session = Depends(get_db)):
    result = service.save_selections(db, task_id, list(payload.get("selections") or []))
    return api_response(result["status"], "目标选择已保存" if result["status"] == "ok" else "目标选择被阻塞", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/video-generation/tasks/{task_id}/background")
async def upload_background_api(task_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    result = await service.upload_background(db, task_id, file)
    return api_response(result["status"], "背景素材已接收" if result["status"] == "ok" else "背景素材接收被阻塞", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"))


@router.post("/api/video-generation/tasks/{task_id}/composite/run")
def composite_run_api(task_id: str, db: Session = Depends(get_db)):
    result = service.run_composite(db, task_id)
    return api_response(result["status"], "合成与原音频回封完成" if result["status"] == "ok" else "合成未完成", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"))


@router.post("/api/video-generation/tasks/{task_id}/qa/run")
def qa_run_api(task_id: str, db: Session = Depends(get_db)):
    result = service.run_qa(db, task_id)
    return api_response(result["status"], "视觉与音频 QA 通过" if result["status"] == "ok" else "QA 未通过，已进入返修", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), ["修复后重新执行合成和 QA"] if result["status"] != "ok" else [])


@router.post("/api/video-generation/tasks/{task_id}/tracking/preflight")
def tracking_preflight_api(task_id: str, db: Session = Depends(get_db)):
    result = service.prepare_tracking(db, task_id)
    return api_response(result["status"], "跟踪任务已排队" if result["status"] == "ok" else "跟踪能力未就绪", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), ["配置 SAM2_RUNNER 和 CUTIE_RUNNER 后重试"] if result["status"] != "ok" else [])


@router.post("/api/video-generation/tasks/{task_id}/tracking/run")
def tracking_run_api(task_id: str, db: Session = Depends(get_db)):
    result = service.run_tracking(db, task_id)
    return api_response(result["status"], "目标跟踪完成" if result["status"] == "ok" else "目标跟踪未完成", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"))


@router.get("/api/video-generation/tasks/{task_id}")
def get_task_api(task_id: str, db: Session = Depends(get_db)):
    result = service.get_task(db, task_id)
    return api_response(result["status"], "任务状态", result.get("data"), "", result.get("missing_inputs"))
