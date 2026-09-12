from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.contracts.liveclip_feedback_contract import (
    LiveClipMetricImport,
    LiveClipPublicationCreate,
)
from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.liveclip_feedback_service import (
    LiveClipFeedbackError,
    get_task_feedback_snapshot,
    import_publication_metrics,
    register_clip_publication,
)


router = APIRouter()


@router.post("/api/liveclip-feedback/publications")
def register_publication_api(
    payload: LiveClipPublicationCreate,
    db: Session = Depends(get_db),
):
    try:
        item = register_clip_publication(db, payload)
    except LiveClipFeedbackError as exc:
        return api_response(
            "blocked",
            exc.message,
            {},
            "",
            exc.missing_inputs,
            [exc.message],
            exc.next_action,
        )
    return api_response(
        "ok",
        "短视频发布信息已登记。",
        {
            "publication_id": item.id,
            "task_id": item.task_id,
            "clip_id": item.clip_id,
            "video_id": item.video_id,
            "platform": item.platform,
            "platform_video_id": item.platform_video_id,
            "strategy_version": item.strategy_version,
        },
    )


@router.post("/api/liveclip-feedback/metrics")
def import_metrics_api(
    payload: LiveClipMetricImport,
    db: Session = Depends(get_db),
):
    try:
        item = import_publication_metrics(db, payload)
    except LiveClipFeedbackError as exc:
        return api_response(
            "blocked",
            exc.message,
            {},
            "",
            exc.missing_inputs,
            [exc.message],
            exc.next_action,
        )
    return api_response(
        "ok",
        "短视频效果数据已回流。",
        {
            "metric_id": item.id,
            "video_id": item.video_id,
            "day_type": item.day_type,
        },
    )


@router.get("/api/liveclip-feedback/tasks/{task_id}")
def task_feedback_api(task_id: str, db: Session = Depends(get_db)):
    snapshot = get_task_feedback_snapshot(db, task_id)
    return api_response(
        "ok",
        "直播切片反馈快照。",
        snapshot.model_dump(),
    )

