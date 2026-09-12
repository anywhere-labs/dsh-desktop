from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class HotspotRecord(Base, IdMixin, TimestampMixin):
    __tablename__ = "hotspot_records"
    account_id: Mapped[str] = mapped_column(String(64))
    hotspot_json: Mapped[dict] = mapped_column(JSON, default=dict)

