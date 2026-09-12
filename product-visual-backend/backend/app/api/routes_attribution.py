from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.attribution_service import analyze_attribution, get_attribution

router = APIRouter()


@router.post("/api/attribution/analyze")
def analyze_api(payload: dict, db: Session = Depends(get_db)):
    if not payload.get("video_id"):
        return api_response("blocked", "缺少视频", {}, "", ["video_id"], [], ["先提供 video_id"])
    trace_id, output = analyze_attribution(db, payload)
    return api_response("ok", "因果归因分析完成", output, trace_id)


@router.get("/api/attribution/{video_id}")
def get_api(video_id: str, db: Session = Depends(get_db)):
    item = get_attribution(db, video_id)
    if not item:
        return api_response("blocked", "归因报告不存在", {}, "", ["attribution_report"], [], ["先执行归因分析"])
    return api_response("ok", "归因报告", {"id": item.id, "attribution": item.attribution_json, "causal_boundary": item.causal_boundary_json, "next_actions": item.next_actions_json})

