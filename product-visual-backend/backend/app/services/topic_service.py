from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.agents.topic_planner_agent import TopicPlannerAgent
from backend.app.models.topic import ContentPlan, ContentTopic


def plan_week(db: Session, payload: dict) -> tuple[str, dict]:
    account_id = payload["account_id"]
    trace_id, output = TopicPlannerAgent().run(db, payload, account_id=account_id)
    plan = ContentPlan(id=uuid.uuid4().hex, account_id=account_id, plan_json=output)
    db.add(plan)
    for topic in output["week_topics"]:
        db.add(ContentTopic(id=uuid.uuid4().hex, account_id=account_id, title=topic["title"], topic_json=topic))
    db.commit()
    output["plan_id"] = plan.id
    return trace_id, output


def list_topics(db: Session, account_id: str) -> list[ContentTopic]:
    return list(db.scalars(select(ContentTopic).where(ContentTopic.account_id == account_id)))

