from sqlalchemy import Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class Material(Base, IdMixin, TimestampMixin):
    __tablename__ = "materials"
    account_id: Mapped[str] = mapped_column(String(64))
    script_id: Mapped[str] = mapped_column(String(64), default="")
    file_name: Mapped[str] = mapped_column(String(300))
    file_path: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(50))
    duration: Mapped[float] = mapped_column(Float, default=0)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class MaterialSegment(Base, IdMixin, TimestampMixin):
    __tablename__ = "material_segments"
    material_id: Mapped[str] = mapped_column(String(64))
    segment_json: Mapped[dict] = mapped_column(JSON, default=dict)

