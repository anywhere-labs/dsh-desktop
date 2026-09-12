from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class ReviewReport(Base, IdMixin, TimestampMixin):
    __tablename__ = "review_reports"
    video_id: Mapped[str] = mapped_column(String(64))
    day_type: Mapped[str] = mapped_column(String(20))
    report_json: Mapped[dict] = mapped_column(JSON, default=dict)

