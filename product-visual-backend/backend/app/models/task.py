from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class Task(Base, IdMixin, TimestampMixin):
    __tablename__ = "tasks"
    task_type: Mapped[str] = mapped_column(String(80), index=True)
    workflow: Mapped[str] = mapped_column(String(120), index=True, default="")
    account_id: Mapped[str] = mapped_column(String(64), default="")
    material_id: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(50), default="created")
    review_status: Mapped[str] = mapped_column(String(50), default="not_submitted")
    input_json: Mapped[dict] = mapped_column(JSON, default=dict)
    trace_id: Mapped[str] = mapped_column(String(64), default="")


class TaskResult(Base, IdMixin, TimestampMixin):
    __tablename__ = "task_results"
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    workflow: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(50), default="completed")
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)


class CausalTrace(Base, IdMixin, TimestampMixin):
    __tablename__ = "causal_traces"
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    trace_id: Mapped[str] = mapped_column(String(64), index=True)
    stage: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(50), default="ok")
    input_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_json: Mapped[dict] = mapped_column(JSON, default=dict)
