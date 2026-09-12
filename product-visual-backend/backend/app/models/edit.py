from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class EditProject(Base, IdMixin, TimestampMixin):
    __tablename__ = "edit_projects"
    account_id: Mapped[str] = mapped_column(String(64))
    script_id: Mapped[str] = mapped_column(String(64), default="")
    material_batch_id: Mapped[str] = mapped_column(String(64), default="")
    edit_plan_json: Mapped[dict] = mapped_column(JSON, default=dict)
    jianying_manifest_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="created")


class EditExport(Base, IdMixin, TimestampMixin):
    __tablename__ = "edit_exports"
    edit_project_id: Mapped[str] = mapped_column(String(64))
    mp4_path: Mapped[str] = mapped_column(String(500), default="")
    mov_path: Mapped[str] = mapped_column(String(500), default="")
    srt_path: Mapped[str] = mapped_column(String(500), default="")
    cover_path: Mapped[str] = mapped_column(String(500), default="")
    download_url: Mapped[str] = mapped_column(String(500), default="")

