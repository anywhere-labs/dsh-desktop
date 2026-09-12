from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.media.ffmpeg_service import check_ffmpeg
from backend.app.services.live_clip_service import create_task, export_task, get_artifact_path, get_task_result, run_task, submit_review

router = APIRouter()


@router.get("/api/tasks/ffmpeg-check")
def ffmpeg_check_api():
    state = check_ffmpeg()
    return api_response("ok" if state["ready"] else "blocked", "FFmpeg 能力检测", state, "", [] if state["ready"] else ["ffmpeg", "ffprobe"])


@router.post("/api/tasks")
def create_task_api(payload: dict, db: Session = Depends(get_db)):
    task = create_task(db, payload)
    return api_response("ok", "任务已创建", task)


@router.post("/api/tasks/{task_id}/run")
def run_task_api(task_id: str, db: Session = Depends(get_db)):
    result = run_task(db, task_id)
    data = result.get("data")
    if isinstance(data, dict) and data.get("raw_result"):
        data = {**data, "result": data["raw_result"]}
    return api_response(result["status"], "长视频内容再制作切片完成" if result["status"] == "ok" else "任务被阻塞", data, "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.get("/api/tasks/{task_id}/result")
def task_result_api(task_id: str, db: Session = Depends(get_db)):
    result = get_task_result(db, task_id)
    return api_response(result["status"], "任务结果", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/tasks/{task_id}/review")
def review_task_api(task_id: str, db: Session = Depends(get_db)):
    result = submit_review(db, task_id)
    return api_response(result["status"], "已提交人工审核", result.get("data"), "", result.get("missing_inputs"))


@router.post("/api/tasks/{task_id}/export")
def export_task_api(task_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    result = export_task(db, task_id, (payload or {}).get("export_type", "html_report"))
    return api_response(result["status"], "导出物已生成" if result["status"] == "ok" else "导出物不可用", result.get("data"), "", result.get("missing_inputs"))


@router.get("/api/tasks/{task_id}/download/{artifact_key}")
def download_task_artifact_api(task_id: str, artifact_key: str, db: Session = Depends(get_db)):
    path = get_artifact_path(db, task_id, artifact_key)
    if not path:
        return api_response("blocked", "导出物不存在", {}, "", [artifact_key])
    return FileResponse(path, filename=path.name)
