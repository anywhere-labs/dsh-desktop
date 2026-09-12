from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services import video_replica_service as service
from backend.app.video_generation.matting import matting_preflight

router = APIRouter()


@router.get("/api/video-generation/matting/capabilities")
def matting_capabilities_api():
    result = matting_preflight()
    return api_response(result["status"], "抠像能力探针", result, missing_inputs=result["missing_inputs"])


@router.post("/api/video-generation/tasks/{task_id}/matting/preflight")
def matting_preflight_api(task_id: str, db: Session = Depends(get_db)):
    result = service.prepare_matting(db, task_id)
    return api_response(
        result["status"],
        "抠像任务已就绪" if result["status"] == "ok" else "抠像能力未就绪",
        result.get("data"),
        missing_inputs=result.get("missing_inputs"),
        warnings=result.get("warnings"),
    )
