from sqlalchemy.orm import Session

from backend.app.services.account_service import import_account
from backend.app.services.topic_service import plan_week


def seed_demo(db: Session) -> dict:
    account = import_account(db, {
        "name": "阿乐服装定制 Demo",
        "platform": "douyin",
        "industry": "服装定制 / 真人口播 / 电商成交",
        "target_audience": ["企业采购", "班级负责人", "球队队长", "活动策划", "服装定制客户"],
    })
    trace_id, topics = plan_week(db, {"account_id": account.id})
    return {"account_id": account.id, "topic_count": len(topics["week_topics"]), "trace_id": trace_id}

