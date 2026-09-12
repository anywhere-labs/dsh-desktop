from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class PublishRecord(Base, IdMixin, TimestampMixin):
    __tablename__ = "publish_records"
    video_id: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(50), default="douyin")
    publish_json: Mapped[dict] = mapped_column(JSON, default=dict)

