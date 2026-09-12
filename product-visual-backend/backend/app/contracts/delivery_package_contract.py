from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


PackageStatus = Literal["blocked", "packaging", "package_ready", "failed"]


class DeliveryAsset(BaseModel):
    model_config = ConfigDict(extra="allow")

    asset_id: str
    label: str
    type: str
    path: str
    package_path: str = ""
    url: str = ""
    exists: bool = False
    size_bytes: int = 0
    customer_visible: bool = True
    note: str = ""


class DeliveryClip(BaseModel):
    model_config = ConfigDict(extra="allow")

    clip_id: str
    title: str = ""
    caption: str = ""
    source_start: float = 0
    source_end: float = 0
    duration_seconds: float = 0
    final_clip: str = ""
    subtitle: str = ""
    cover: str = ""
    qa_status: str = ""
    review_status: str = ""


class DeliveryCustomerSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str
    status_label: str
    clip_count: int = 0
    subtitle_count: int = 0
    qa_status: str = ""
    review_status: str = ""
    package_note: str = ""
    next_action: list[str] = Field(default_factory=list)


class DeliveryPackageManifest(BaseModel):
    model_config = ConfigDict(extra="allow")

    package_id: str
    job_id: str
    project_id: str
    package_status: PackageStatus
    created_at: str
    clips: list[DeliveryClip] = Field(default_factory=list)
    previews: list[DeliveryAsset] = Field(default_factory=list)
    subtitles: list[DeliveryAsset] = Field(default_factory=list)
    copywriting: list[DeliveryAsset] = Field(default_factory=list)
    edit_plans: list[DeliveryAsset] = Field(default_factory=list)
    qa_reports: list[DeliveryAsset] = Field(default_factory=list)
    exchange_assets: list[DeliveryAsset] = Field(default_factory=list)
    debug_assets: list[DeliveryAsset] = Field(default_factory=list)
    download_url: str = ""
    customer_summary: DeliveryCustomerSummary
    dag_version: str = "liveclip_dag_v1_4_1"
    execution_time: dict[str, Any] = Field(default_factory=dict)
    worker_summary: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
