from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BrandContentListing(BaseModel):
    model_config = ConfigDict(extra="allow")

    listing_id: str = Field(min_length=1)
    version: str = "brand_content_listing.v1"
    strategy_id: str = ""
    brand_name: str = Field(min_length=1)
    category: str = ""
    strategic_theme: str = ""
    brand_proposition: str = ""
    target_audience: list[str] = Field(default_factory=list)
    content_pillars: list[str] = Field(default_factory=list)
    funnel_stage: str = "interest"
    evidence_status: Literal["template", "provided", "model_generated", "mixed"] = "template"
    forbidden_claims: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

