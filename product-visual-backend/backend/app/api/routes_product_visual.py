from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services import product_visual_service as service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/product-visual/tasks")
def create_task_api(payload: dict, db: Session = Depends(get_db)):
    data = service.create_task(db, payload)
    return api_response("ok", "success", data)


@router.post("/api/product-visual/tasks/{task_id}/assets")
async def upload_asset_api(task_id: str, asset_type: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    result = await service.upload_asset(db, task_id, file, asset_type)
    return api_response(result["status"], "uploaded" if result["status"] == "ok" else "upload blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/draft")
def save_draft_api(task_id: str, payload: dict, db: Session = Depends(get_db)):
    result = service.save_draft(db, task_id, payload)
    return api_response(result["status"], "draft saved" if result["status"] == "ok" else "draft blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/run")
def run_task_api(task_id: str, db: Session = Depends(get_db)):
    result = service.run_task(db, task_id)
    return api_response(result["status"], "task started" if result["status"] == "ok" else "task blocked", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/product-visual/tasks/{task_id}/status")
def status_api(task_id: str, db: Session = Depends(get_db)):
    try:
        result = service.get_status(db, task_id)
        return api_response(result["status"], "success", result.get("data"), "", result.get("missing_inputs"))
    except Exception:
        trace_id = uuid.uuid4().hex
        logger.exception("product visual status failed task_id=%s trace_id=%s", task_id, trace_id)
        return JSONResponse(
            status_code=500,
            content=api_response(
                "failed",
                "状态查询失败",
                {},
                trace_id,
                warnings=["状态服务暂时不可用"],
                next_action=["请稍后重试；持续失败时根据追踪编号检查服务日志"],
            ),
        )


@router.get("/api/product-visual/tasks/{task_id}/result")
def result_api(task_id: str, db: Session = Depends(get_db)):
    result = service.get_result(db, task_id)
    return api_response(result["status"], "success", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/review")
def review_api(task_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    result = service.submit_review(db, task_id, payload or {"action": "submit"})
    return api_response(result["status"], "submitted" if result["status"] == "ok" else "review blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/titles/refresh")
def refresh_titles_api(task_id: str, db: Session = Depends(get_db)):
    result = service.refresh_title_candidates(db, task_id)
    return api_response(result["status"], "titles refreshed" if result["status"] == "ok" else "title refresh blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/export")
def export_api(task_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    result = service.export_result(db, task_id, payload or {})
    return api_response(result["status"], "exported" if result["status"] == "ok" else "export blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/asset-tasks/{asset_task_id}/retry")
def retry_asset_api(task_id: str, asset_task_id: str, db: Session = Depends(get_db)):
    result = service.retry_asset_task(db, task_id, asset_task_id)
    return api_response(result["status"], "asset retried" if result["status"] == "ok" else "asset retry blocked", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/product-visual/tasks/{task_id}/feedback")
def feedback_api(task_id: str, payload: dict, db: Session = Depends(get_db)):
    result = service.record_feedback(db, task_id, payload)
    return api_response(result["status"], "feedback recorded" if result["status"] == "ok" else "feedback blocked", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/product-visual/tasks/{task_id}/feedback")
def feedback_summary_api(task_id: str, db: Session = Depends(get_db)):
    result = service.get_feedback(db, task_id)
    return api_response(result["status"], "success", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/product-visual/tasks/{task_id}/files/{folder}/{name}")
def file_api(task_id: str, folder: str, name: str):
    path = service.file_path(task_id, folder, name)
    if not path:
        return api_response("blocked", "file not found", {}, "", ["file"])
    return FileResponse(path, filename=path.name)
