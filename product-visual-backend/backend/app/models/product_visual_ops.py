from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class ProductVisualConstraintSnapshot(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_constraint_snapshots"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(40), default="pending_manual_lock")
    facts_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ProductVisualAssetTask(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_asset_tasks"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    asset_type: Mapped[str] = mapped_column(String(80), index=True)
    asset_name: Mapped[str] = mapped_column(String(255), default="")
    aspect_ratio: Mapped[str] = mapped_column(String(20), default="")
    agent: Mapped[str] = mapped_column(String(120), default="")
    skill: Mapped[str] = mapped_column(String(120), default="")
    dependencies_json: Mapped[list] = mapped_column(JSON, default=list)
    constraint_snapshot_id: Mapped[str] = mapped_column(String(64), default="")
    provider: Mapped[str] = mapped_column(String(80), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    provider_request_id: Mapped[str] = mapped_column(String(180), default="")
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    qa_status: Mapped[str] = mapped_column(String(40), default="pending")
    review_status: Mapped[str] = mapped_column(String(40), default="pending")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(String(500), default="")
    qa_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_json: Mapped[dict] = mapped_column(JSON, default=dict)
    elapsed_seconds: Mapped[float] = mapped_column(Float, default=0)
    cost_amount: Mapped[float] = mapped_column(Float, default=0)


class ProductVisualFeedback(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_feedback"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    asset_task_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    platform: Mapped[str] = mapped_column(String(60), default="")
    variant: Mapped[str] = mapped_column(String(100), default="")
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    spend: Mapped[float] = mapped_column(Float, default=0)
    revenue: Mapped[float] = mapped_column(Float, default=0)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProductVisualTenant(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_tenants"

    name: Mapped[str] = mapped_column(String(160), default="")
    owner_key: Mapped[str] = mapped_column(String(160), default="", unique=True)
    active: Mapped[bool] = mapped_column(default=True)


class ProductVisualTaskTenant(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_task_tenants"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(40), default="owner")
