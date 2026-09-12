from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class LiveClipPublication(Base, IdMixin, TimestampMixin):
    __tablename__ = "liveclip_publications"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "clip_id",
            "platform",
            "platform_video_id",
            name="uq_liveclip_publication_identity",
        ),
    )

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    clip_id: Mapped[str] = mapped_column(String(64), index=True)
    video_id: Mapped[str] = mapped_column(String(64), index=True)
    account_id: Mapped[str] = mapped_column(String(64), default="")
    platform: Mapped[str] = mapped_column(String(50), index=True)
    platform_video_id: Mapped[str] = mapped_column(String(160), default="")
    title_variant: Mapped[str] = mapped_column(String(300), default="")
    template_id: Mapped[str] = mapped_column(String(120), default="")
    strategy_version: Mapped[str] = mapped_column(String(120), default="baseline_v1")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    mapping_json: Mapped[dict] = mapped_column(JSON, default=dict)

