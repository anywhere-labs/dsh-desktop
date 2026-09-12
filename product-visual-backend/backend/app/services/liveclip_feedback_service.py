from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.contracts.liveclip_feedback_contract import (
    LiveClipFeedbackClip,
    LiveClipFeedbackSnapshot,
    LiveClipMetricImport,
    LiveClipPublicationCreate,
)
from backend.app.models.liveclip_feedback import LiveClipPublication
from backend.app.models.task import Task, TaskResult
from backend.app.models.video import VideoMetric
from backend.app.services.publish_service import record_publish
from backend.app.services.report_service import import_metrics


class LiveClipFeedbackError(ValueError):
    def __init__(self, message: str, missing_inputs: list[str], next_action: list[str]):
        super().__init__(message)
        self.message = message
        self.missing_inputs = missing_inputs
        self.next_action = next_action


def register_clip_publication(
    db: Session,
    payload: LiveClipPublicationCreate,
) -> LiveClipPublication:
    task = db.get(Task, payload.task_id)
    if task is None:
        raise LiveClipFeedbackError(
            "未找到对应的直播切片任务。",
            ["task_id"],
            ["请先确认任务已创建，再登记平台发布结果。"],
        )

    clip = _find_task_clip(db, payload.task_id, payload.clip_id)
    if clip is None:
        raise LiveClipFeedbackError(
            "当前任务中不存在这条短视频。",
            ["clip_id"],
            ["请从当前任务的成片列表中选择正确的短视频。"],
        )

    existing = _find_publication_by_identity(db, payload)
    if existing is not None:
        return existing

    video_id = uuid.uuid4().hex
    publish_record = record_publish(
        db,
        {
            "video_id": video_id,
            "account_id": payload.account_id or task.account_id,
            "title": payload.title_variant or clip.get("title") or payload.clip_id,
            "platform": payload.platform,
            "platform_video_id": payload.platform_video_id,
            "task_id": payload.task_id,
            "clip_id": payload.clip_id,
            "strategy_version": payload.strategy_version,
            "metadata": payload.metadata,
        },
    )
    item = LiveClipPublication(
        id=uuid.uuid4().hex,
        task_id=payload.task_id,
        clip_id=payload.clip_id,
        video_id=publish_record.video_id,
        account_id=payload.account_id or task.account_id,
        platform=payload.platform,
        platform_video_id=payload.platform_video_id,
        title_variant=payload.title_variant or clip.get("title") or "",
        template_id=payload.template_id or clip.get("template_id") or "",
        strategy_version=payload.strategy_version,
        published_at=payload.published_at,
        mapping_json={
            "publish_record_id": publish_record.id,
            "hook_type": clip.get("hook_type") or "",
            "source_clip": clip,
            "metadata": payload.metadata,
        },
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _find_publication_by_identity(db, payload)
        if existing is not None:
            return existing
        raise
    db.refresh(item)
    return item


def import_publication_metrics(
    db: Session,
    payload: LiveClipMetricImport,
) -> VideoMetric:
    publication = db.get(LiveClipPublication, payload.publication_id)
    if publication is None:
        raise LiveClipFeedbackError(
            "未找到对应的平台发布记录。",
            ["publication_id"],
            ["请先登记短视频的平台发布信息，再导入效果数据。"],
        )

    values = payload.model_dump()
    values.update(
        {
            "video_id": publication.video_id,
            "task_id": publication.task_id,
            "clip_id": publication.clip_id,
            "platform": publication.platform,
            "platform_video_id": publication.platform_video_id,
        }
    )
    return import_metrics(db, values)


def get_task_feedback_snapshot(db: Session, task_id: str) -> LiveClipFeedbackSnapshot:
    publications = list(
        db.scalars(
            select(LiveClipPublication)
            .where(LiveClipPublication.task_id == task_id)
            .order_by(LiveClipPublication.created_at.asc())
        )
    )
    video_ids = [item.video_id for item in publications]
    metrics = (
        list(db.scalars(select(VideoMetric).where(VideoMetric.video_id.in_(video_ids))))
        if video_ids
        else []
    )

    publications_by_clip: dict[str, list[dict]] = defaultdict(list)
    metrics_by_video: dict[str, list[dict]] = defaultdict(list)
    for item in publications:
        publications_by_clip[item.clip_id].append(_publication_dict(item))
    for item in metrics:
        metrics_by_video[item.video_id].append(_metric_dict(item))

    clips: list[LiveClipFeedbackClip] = []
    for clip_id, clip_publications in publications_by_clip.items():
        clip_metrics: list[dict] = []
        for publication in clip_publications:
            clip_metrics.extend(metrics_by_video.get(publication["video_id"], []))
        clips.append(
            LiveClipFeedbackClip(
                clip_id=clip_id,
                publications=clip_publications,
                metrics=clip_metrics,
            )
        )

    return LiveClipFeedbackSnapshot(
        task_id=task_id,
        publication_count=len(publications),
        metric_count=len(metrics),
        clips=clips,
    )


def _find_task_clip(db: Session, task_id: str, clip_id: str) -> dict | None:
    results = db.scalars(
        select(TaskResult)
        .where(TaskResult.task_id == task_id)
        .order_by(TaskResult.created_at.desc())
    )
    for result in results:
        data = result.result_json or {}
        for clip in data.get("slice_segments") or data.get("segments") or []:
            if clip.get("clip_id") == clip_id or clip.get("slice_id") == clip_id:
                return clip
    return None


def _find_publication_by_identity(
    db: Session,
    payload: LiveClipPublicationCreate,
) -> LiveClipPublication | None:
    return db.scalars(
        select(LiveClipPublication).where(
            LiveClipPublication.task_id == payload.task_id,
            LiveClipPublication.clip_id == payload.clip_id,
            LiveClipPublication.platform == payload.platform,
            LiveClipPublication.platform_video_id == payload.platform_video_id,
        )
    ).first()


def _publication_dict(item: LiveClipPublication) -> dict:
    return {
        "publication_id": item.id,
        "video_id": item.video_id,
        "clip_id": item.clip_id,
        "platform": item.platform,
        "platform_video_id": item.platform_video_id,
        "title_variant": item.title_variant,
        "template_id": item.template_id,
        "strategy_version": item.strategy_version,
        "published_at": item.published_at.isoformat() if item.published_at else "",
    }


def _metric_dict(item: VideoMetric) -> dict:
    return {
        "metric_id": item.id,
        "video_id": item.video_id,
        "day_type": item.day_type,
        "views": item.views,
        "likes": item.likes,
        "comments": item.comments,
        "shares": item.shares,
        "favorites": item.favorites,
        "completion_rate": item.completion_rate,
        "avg_watch_time": item.avg_watch_time,
        "profile_visits": item.profile_visits,
        "followers_gained": item.followers_gained,
        "leads": item.leads,
        "orders": item.orders,
        "gmv": item.gmv,
    }

