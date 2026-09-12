from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class AttributionReport(Base, IdMixin, TimestampMixin):
    __tablename__ = "attribution_reports"
    video_id: Mapped[str] = mapped_column(String(64))
    report_7d_id: Mapped[str] = mapped_column(String(64), default="")
    report_14d_id: Mapped[str] = mapped_column(String(64), default="")
    attribution_json: Mapped[dict] = mapped_column(JSON, default=dict)
    causal_boundary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    next_actions_json: Mapped[dict] = mapped_column(JSON, default=dict)

