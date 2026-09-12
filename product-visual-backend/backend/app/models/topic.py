from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class ContentTopic(Base, IdMixin, TimestampMixin):
    __tablename__ = "content_topics"
    account_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    topic_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="planned")


class ContentPlan(Base, IdMixin, TimestampMixin):
    __tablename__ = "content_plans"
    account_id: Mapped[str] = mapped_column(String(64))
    plan_json: Mapped[dict] = mapped_column(JSON, default=dict)

