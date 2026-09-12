from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class Video(Base, IdMixin, TimestampMixin):
    __tablename__ = "videos"
    account_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    platform_video_url: Mapped[str] = mapped_column(String(500), default="")
    content_type: Mapped[str] = mapped_column(String(100), default="")
    script_id: Mapped[str] = mapped_column(String(64), default="")
    edit_project_id: Mapped[str] = mapped_column(String(64), default="")
    publish_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")


class VideoMetric(Base, IdMixin, TimestampMixin):
    __tablename__ = "video_metrics"
    video_id: Mapped[str] = mapped_column(String(64))
    day_type: Mapped[str] = mapped_column(String(20))
    views: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    favorites: Mapped[int] = mapped_column(Integer, default=0)
    completion_rate: Mapped[float] = mapped_column(Float, default=0)
    avg_watch_time: Mapped[float] = mapped_column(Float, default=0)
    profile_visits: Mapped[int] = mapped_column(Integer, default=0)
    followers_gained: Mapped[int] = mapped_column(Integer, default=0)
    leads: Mapped[int] = mapped_column(Integer, default=0)
    orders: Mapped[int] = mapped_column(Integer, default=0)
    gmv: Mapped[float] = mapped_column(Float, default=0)
    raw_data_json: Mapped[dict] = mapped_column(JSON, default=dict)


class BenchmarkVideo(Base, IdMixin, TimestampMixin):
    __tablename__ = "benchmark_videos"
    account_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(String(500), default="")
    raw_data_json: Mapped[dict] = mapped_column(JSON, default=dict)

