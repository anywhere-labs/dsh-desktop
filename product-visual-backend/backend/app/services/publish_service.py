from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.app.models.publish import PublishRecord
from backend.app.models.video import Video


def record_publish(db: Session, payload: dict) -> PublishRecord:
    video_id = payload.get("video_id") or uuid.uuid4().hex
    if not db.get(Video, video_id):
        db.add(Video(id=video_id, account_id=payload.get("account_id", ""), title=payload.get("title", "未命名发布视频"), status="published"))
    item = PublishRecord(id=uuid.uuid4().hex, video_id=video_id, platform=payload.get("platform", "douyin"), publish_json=payload)
    db.add(item)
    db.commit()
    return item

