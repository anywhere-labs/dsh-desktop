from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.app.agents.hotspot_agent import HotspotAgent
from backend.app.models.hotspot import HotspotRecord


def optimize_hotspot(db: Session, payload: dict) -> tuple[str, dict]:
    account_id = payload.get("account_id", "")
    trace_id, output = HotspotAgent().run(db, payload, account_id=account_id)
    db.add(HotspotRecord(id=uuid.uuid4().hex, account_id=account_id, hotspot_json=output))
    db.commit()
    return trace_id, output

