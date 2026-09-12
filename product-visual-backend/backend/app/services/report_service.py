from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.agents.data_review_agent import DataReviewAgent
from backend.app.models.report import ReviewReport
from backend.app.models.video import VideoMetric


def import_metrics(db: Session, payload: dict) -> VideoMetric:
    item = VideoMetric(id=uuid.uuid4().hex, video_id=payload["video_id"], day_type=payload.get("day_type", "7d"), views=payload.get("views", 0), likes=payload.get("likes", 0), comments=payload.get("comments", 0), shares=payload.get("shares", 0), favorites=payload.get("favorites", 0), completion_rate=payload.get("completion_rate", 0), avg_watch_time=payload.get("avg_watch_time", 0), profile_visits=payload.get("profile_visits", 0), followers_gained=payload.get("followers_gained", 0), leads=payload.get("leads", 0), orders=payload.get("orders", 0), gmv=payload.get("gmv", 0), raw_data_json=payload)
    db.add(item)
    db.commit()
    return item


def review(db: Session, video_id: str, day_type: str) -> tuple[str, dict]:
    metrics = db.scalars(select(VideoMetric).where(VideoMetric.video_id == video_id, VideoMetric.day_type == day_type)).first()
    payload = {"video_id": video_id, "day_type": day_type, "metrics": metrics.raw_data_json if metrics else {}}
    trace_id, output = DataReviewAgent().run(db, payload, video_id=video_id)
    db.add(ReviewReport(id=uuid.uuid4().hex, video_id=video_id, day_type=day_type, report_json=output))
    db.commit()
    return trace_id, output


def get_reports(db: Session, video_id: str) -> list[ReviewReport]:
    return list(db.scalars(select(ReviewReport).where(ReviewReport.video_id == video_id)))

