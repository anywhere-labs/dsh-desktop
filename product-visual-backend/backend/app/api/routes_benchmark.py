from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.benchmark_service import analyze_benchmark, import_benchmark, list_benchmark

router = APIRouter()


@router.post("/api/benchmark/import")
def import_api(payload: dict, db: Session = Depends(get_db)):
    if not payload.get("account_id"):
        return api_response("blocked", "缺少账号", {}, "", ["account_id"], [], ["先导入账号"])
    item = import_benchmark(db, payload)
    return api_response("ok", "对标视频导入成功", {"benchmark_video_id": item.id})


@router.post("/api/benchmark/analyze")
def analyze_api(payload: dict, db: Session = Depends(get_db)):
    trace_id, output = analyze_benchmark(db, payload)
    return api_response("ok", "对标分析完成", output, trace_id)


@router.get("/api/benchmark/{account_id}")
def list_api(account_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "对标视频列表", {"items": [{"id": x.id, "title": x.title, "url": x.url} for x in list_benchmark(db, account_id)]})

