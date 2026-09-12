from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.agents.competitor_analysis_agent import CompetitorAnalysisAgent
from backend.app.models.video import BenchmarkVideo


def import_benchmark(db: Session, payload: dict) -> BenchmarkVideo:
    item = BenchmarkVideo(id=uuid.uuid4().hex, account_id=payload["account_id"], title=payload.get("title", "对标视频"), url=payload.get("url", ""), raw_data_json=payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def analyze_benchmark(db: Session, payload: dict) -> tuple[str, dict]:
    return CompetitorAnalysisAgent().run(db, payload, account_id=payload.get("account_id"))


def list_benchmark(db: Session, account_id: str) -> list[BenchmarkVideo]:
    return list(db.scalars(select(BenchmarkVideo).where(BenchmarkVideo.account_id == account_id)))

