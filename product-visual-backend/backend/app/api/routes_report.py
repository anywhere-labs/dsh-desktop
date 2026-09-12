from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.report_service import get_reports, import_metrics, review

router = APIRouter()


@router.post("/api/report/import")
def import_api(payload: dict, db: Session = Depends(get_db)):
    if not payload.get("video_id"):
        return api_response("blocked", "缺少视频", {}, "", ["video_id"], [], ["先创建发布记录或提供 video_id"])
    metric = import_metrics(db, payload)
    return api_response("ok", "数据回流已导入", {"metric_id": metric.id})


@router.post("/api/report/{video_id}/review-7d")
def review_7d(video_id: str, db: Session = Depends(get_db)):
    trace_id, output = review(db, video_id, "7d")
    return api_response("ok", "7天复盘完成", output, trace_id)


@router.post("/api/report/{video_id}/review-14d")
def review_14d(video_id: str, db: Session = Depends(get_db)):
    trace_id, output = review(db, video_id, "14d")
    return api_response("ok", "14天复盘完成", output, trace_id)


@router.get("/api/report/{video_id}")
def get_api(video_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "复盘报告列表", {"items": [{"id": r.id, "day_type": r.day_type, "report": r.report_json} for r in get_reports(db, video_id)]})

