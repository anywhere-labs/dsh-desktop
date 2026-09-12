from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.trace_service import get_trace, get_video_trace

router = APIRouter()


def _serialize(events):
    return [{"trace_id": e.trace_id, "stage": e.stage, "agent_name": e.agent_name, "status": e.status, "input_hash": e.input_hash, "output_hash": e.output_hash, "input": e.input_json, "output": e.output_json, "confidence_score": e.confidence_score} for e in events]


@router.get("/api/trace/{trace_id}")
def get_trace_api(trace_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "Trace 详情", {"items": _serialize(get_trace(db, trace_id))})


@router.get("/api/trace/video/{video_id}")
def get_video_trace_api(video_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "视频 Trace", {"items": _serialize(get_video_trace(db, video_id))})

