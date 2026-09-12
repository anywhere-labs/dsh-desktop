from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OpeningRange(BaseModel):
    model_config = ConfigDict(extra="allow")

    source_segment_ids: list[str] = Field(default_factory=list)
    source_start: float = Field(ge=0)
    source_end: float = Field(gt=0)
    duration: float = Field(gt=0)
    text: str = ""


class ProductMatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Literal["matched", "unverified", "blocked"] = "unverified"
    sku_id: str = ""
    product_name: str = ""
    matched_terms: list[str] = Field(default_factory=list)
    evidence_segment_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0, ge=0, le=1)


class OpeningHookPlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    plan_id: str
    job_id: str
    mode: Literal["shadow"] = "shadow"
    render_consumed: bool = False
    status: Literal["ready", "blocked"] = "blocked"
    hook_window_seconds: float = 3.0
    completion_window_seconds: float = 5.0
    opening: dict = Field(default_factory=dict)
    product_match: ProductMatch
    failed_gates: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
