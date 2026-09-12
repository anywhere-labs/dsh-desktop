from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.hotspot_service import optimize_hotspot

router = APIRouter()


@router.post("/api/hotspot/import")
def import_api(payload: dict):
    return api_response("ok", "热点数据已导入", {"raw": payload})


@router.post("/api/hotspot/optimize")
def optimize_api(payload: dict, db: Session = Depends(get_db)):
    trace_id, output = optimize_hotspot(db, payload)
    return api_response("ok", "热点优化建议已生成", output, trace_id)


@router.get("/api/hotspot/{account_id}")
def get_api(account_id: str):
    return api_response("partial", "热点记录查询预留", {"account_id": account_id, "items": []}, "", [], ["MVP 未做热点历史列表"], ["使用 /api/hotspot/optimize 生成建议"])

