from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.trace import TraceEvent


def get_trace(db: Session, trace_id: str) -> list[TraceEvent]:
    return list(db.scalars(select(TraceEvent).where(TraceEvent.trace_id == trace_id)))


def get_video_trace(db: Session, video_id: str) -> list[TraceEvent]:
    return list(db.scalars(select(TraceEvent).where(TraceEvent.video_id == video_id)))

