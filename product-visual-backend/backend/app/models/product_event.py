from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class ProductEvent(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_events"
    event_name: Mapped[str] = mapped_column(String(100))
    event_json: Mapped[dict] = mapped_column(JSON, default=dict)

