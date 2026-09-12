from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DataEvidenceSnapshot(BaseModel):
    model_config = ConfigDict(extra="allow")

    snapshot_id: str = Field(min_length=1)
    captured_at: str = Field(min_length=1)
    source: str = Field(min_length=1)
    source_kind: Literal["authorized_platform", "public_signal", "provided", "model_inference", "pending"]
    authorization_status: Literal["authorized", "public", "provided", "not_applicable", "pending", "blocked"]
    confidence: Literal["high", "medium", "low", "unknown"] = "unknown"
    fields: dict[str, Any] = Field(default_factory=dict)
    missing_data: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

