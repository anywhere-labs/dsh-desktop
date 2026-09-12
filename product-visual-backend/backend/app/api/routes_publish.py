from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.publish_service import record_publish

router = APIRouter()


@router.post("/api/publish/record")
def record_api(payload: dict, db: Session = Depends(get_db)):
    item = record_publish(db, payload)
    return api_response("ok", "发布记录已保存", {"publish_record_id": item.id, "video_id": item.video_id})

