from __future__ import annotations

import hashlib
import json
import time
import uuid
from contextlib import contextmanager

from sqlalchemy.orm import Session

from backend.app.models.trace import TraceEvent


def _hash(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


@contextmanager
def trace_event(db: Session, *, account_id: str | None, video_id: str | None, stage: str, agent_name: str, input_json: dict):
    trace_id = uuid.uuid4().hex
    start = time.time()
    event = TraceEvent(
        trace_id=trace_id,
        account_id=account_id,
        video_id=video_id,
        stage=stage,
        agent_name=agent_name,
        input_hash=_hash(input_json),
        input_json=input_json,
        status="running",
    )
    db.add(event)
    db.commit()
    try:
        yield trace_id, event
    except Exception as exc:
        event.status = "failed"
        event.error_message = str(exc)
        event.duration_ms = int((time.time() - start) * 1000)
        db.commit()
        raise


def finish_trace(db: Session, event: TraceEvent, output_json: dict, status: str = "ok", confidence_score: float = 0.8) -> None:
    event.output_json = output_json
    event.output_hash = _hash(output_json)
    event.status = status
    event.confidence_score = confidence_score
    event.duration_ms = event.duration_ms or 1
    db.commit()

