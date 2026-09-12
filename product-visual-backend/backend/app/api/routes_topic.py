from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.models.topic import ContentTopic
from backend.app.services.script_service import generate_script
from backend.app.services.topic_service import list_topics, plan_week

router = APIRouter()


@router.post("/api/topic/plan-week")
def plan_api(payload: dict, db: Session = Depends(get_db)):
    if not payload.get("account_id"):
        return api_response("blocked", "缺少账号", {}, "", ["account_id"], [], ["先导入账号"])
    trace_id, output = plan_week(db, payload)
    return api_response("ok", "周选题已生成", output, trace_id)


@router.get("/api/topic/{account_id}")
def list_api(account_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "选题列表", {"items": [{"id": x.id, "title": x.title, "topic": x.topic_json} for x in list_topics(db, account_id)]})


@router.post("/api/topic/{topic_id}/generate-script")
def generate_script_api(topic_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    topic = db.get(ContentTopic, topic_id)
    if not topic:
        return api_response("blocked", "选题不存在", {}, "", ["topic_id"], [], ["先生成周选题"])
    trace_id, output = generate_script(db, topic, payload or {})
    return api_response("ok", "分镜脚本已生成", output, trace_id)

