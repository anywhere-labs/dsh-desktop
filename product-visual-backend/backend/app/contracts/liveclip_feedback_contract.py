from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LiveClipPublicationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    task_id: str = Field(min_length=1, max_length=64)
    clip_id: str = Field(min_length=1, max_length=64)
    platform: str = Field(min_length=1, max_length=50)
    platform_video_id: str = Field(min_length=1, max_length=160)
    account_id: str = Field(default="", max_length=64)
    title_variant: str = Field(default="", max_length=300)
    template_id: str = Field(default="", max_length=120)
    strategy_version: str = Field(default="baseline_v1", max_length=120)
    published_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LiveClipMetricImport(BaseModel):
    model_config = ConfigDict(extra="allow")

    publication_id: str = Field(min_length=1, max_length=64)
    day_type: str = Field(default="7d", max_length=20)
    views: int = Field(default=0, ge=0)
    likes: int = Field(default=0, ge=0)
    comments: int = Field(default=0, ge=0)
    shares: int = Field(default=0, ge=0)
    favorites: int = Field(default=0, ge=0)
    completion_rate: float = Field(default=0, ge=0)
    avg_watch_time: float = Field(default=0, ge=0)
    profile_visits: int = Field(default=0, ge=0)
    followers_gained: int = Field(default=0, ge=0)
    leads: int = Field(default=0, ge=0)
    orders: int = Field(default=0, ge=0)
    gmv: float = Field(default=0, ge=0)
    raw_data: dict[str, Any] = Field(default_factory=dict)


class LiveClipFeedbackClip(BaseModel):
    clip_id: str
    publications: list[dict[str, Any]] = Field(default_factory=list)
    metrics: list[dict[str, Any]] = Field(default_factory=list)


class LiveClipFeedbackSnapshot(BaseModel):
    task_id: str
    publication_count: int = 0
    metric_count: int = 0
    clips: list[LiveClipFeedbackClip] = Field(default_factory=list)
    strategy_mutation_enabled: bool = False
    note: str = "反馈仅用于追溯和复盘，当前不会自动修改生成策略。"

