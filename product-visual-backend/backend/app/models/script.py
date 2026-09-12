from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class Script(Base, IdMixin, TimestampMixin):
    __tablename__ = "scripts"
    account_id: Mapped[str] = mapped_column(String(64))
    topic_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    hook_3s: Mapped[str] = mapped_column(String(500))
    target_audience: Mapped[str] = mapped_column(String(300))
    core_pain_point: Mapped[str] = mapped_column(String(500))
    duration: Mapped[str] = mapped_column(String(50), default="30s")
    script_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[str] = mapped_column(String(20), default="v1")


class ScriptShot(Base, IdMixin, TimestampMixin):
    __tablename__ = "script_shots"
    script_id: Mapped[str] = mapped_column(String(64))
    shot_json: Mapped[dict] = mapped_column(JSON, default=dict)

