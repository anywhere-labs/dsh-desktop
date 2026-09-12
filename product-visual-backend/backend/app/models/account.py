from __future__ import annotations

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class Account(Base, IdMixin, TimestampMixin):
    __tablename__ = "accounts"
    name: Mapped[str] = mapped_column(String(200))
    platform: Mapped[str] = mapped_column(String(50), default="douyin")
    industry: Mapped[str] = mapped_column(String(200), default="")
    positioning: Mapped[str] = mapped_column(String(500), default="")
    target_audience_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AccountImport(Base, IdMixin, TimestampMixin):
    __tablename__ = "account_imports"
    account_id: Mapped[str] = mapped_column(String(64))
    source_type: Mapped[str] = mapped_column(String(100))
    raw_data_json: Mapped[dict] = mapped_column(JSON, default=dict)

