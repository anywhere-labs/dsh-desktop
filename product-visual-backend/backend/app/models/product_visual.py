from sqlalchemy import Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base
from backend.app.models.mixins import IdMixin, TimestampMixin


class ProductVisualTask(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_tasks"

    product_name: Mapped[str] = mapped_column(String(160), default="")
    target_platform: Mapped[str] = mapped_column(String(60), default="")
    core_selling_points_json: Mapped[list] = mapped_column(JSON, default=list)
    price_min: Mapped[float] = mapped_column(Float, default=0)
    price_max: Mapped[float] = mapped_column(Float, default=0)
    reference_product_url: Mapped[str] = mapped_column(String(500), default="")
    style_direction_json: Mapped[list] = mapped_column(JSON, default=list)
    generation_settings_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(60), default="created", index=True)
    review_status: Mapped[str] = mapped_column(String(60), default="draft")
    progress: Mapped[int] = mapped_column(default=0)


class ProductVisualAsset(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_assets"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    asset_type: Mapped[str] = mapped_column(String(80), index=True)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_url: Mapped[str] = mapped_column(String(500), default="")
    mime_type: Mapped[str] = mapped_column(String(120), default="")
    size: Mapped[int] = mapped_column(default=0)


class ProductVisualResult(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_results"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    main_images_json: Mapped[list] = mapped_column(JSON, default=list)
    detail_pages_json: Mapped[list] = mapped_column(JSON, default=list)
    title_candidates_json: Mapped[list] = mapped_column(JSON, default=list)
    click_strategy_scores_json: Mapped[dict] = mapped_column(JSON, default=dict)
    export_options_json: Mapped[list] = mapped_column(JSON, default=list)


class ProductVisualReview(Base, IdMixin, TimestampMixin):
    __tablename__ = "product_visual_reviews"

    task_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(60), default="submit")
    comment: Mapped[str] = mapped_column(String(500), default="")
    review_status: Mapped[str] = mapped_column(String(60), default="pending_review")
