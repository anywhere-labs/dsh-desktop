from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.agents.attribution_agent import AttributionAgent
from backend.app.models.attribution import AttributionReport


def analyze_attribution(db: Session, payload: dict) -> tuple[str, dict]:
    video_id = payload["video_id"]
    trace_id, output = AttributionAgent().run(db, payload, video_id=video_id)
    item = AttributionReport(id=uuid.uuid4().hex, video_id=video_id, attribution_json=output.get("attribution", {}), causal_boundary_json={"items": output.get("causal_boundary", [])}, next_actions_json={"items": output.get("next_actions", [])})
    db.add(item)
    db.commit()
    output["attribution_report_id"] = item.id
    return trace_id, output


def get_attribution(db: Session, video_id: str) -> AttributionReport | None:
    return db.scalars(select(AttributionReport).where(AttributionReport.video_id == video_id)).first()

