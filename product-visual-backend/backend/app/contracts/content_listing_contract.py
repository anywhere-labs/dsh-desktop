from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ListingStatus = Literal["candidate", "draft", "evidence_validated"]
EvidenceKind = Literal["fact", "inference", "assumption", "missing_data"]


class ContentListingEvidence(BaseModel):
    model_config = ConfigDict(extra="allow")

    field: str = Field(min_length=1)
    kind: EvidenceKind
    source_segment_ids: list[str] = Field(default_factory=list)
    source_clip_ids: list[str] = Field(default_factory=list)
    note: str = ""


class ContentListing(BaseModel):
    """Commercial meaning snapshot for a LiveClip candidate.

    P0 shadow-only contract: it describes a candidate and never contains
    render commands, publish credentials, or ad delivery instructions.
    """

    model_config = ConfigDict(extra="allow")

    listing_id: str = Field(min_length=1)
    version: str = "content_listing.v1"
    status: ListingStatus = "candidate"
    job_id: str = Field(min_length=1)
    clip_id: str = Field(min_length=1)
    source_segment_ids: list[str] = Field(default_factory=list)
    source_time_ranges: list[dict[str, float]] = Field(default_factory=list)
    topic: str = ""
    content_type: str = "unknown"
    content_goal: str = "unknown"
    purchase_stage: str = "unknown"
    product_id: str = ""
    product_name: str = ""
    title_candidate: str = ""
    hook_candidate: str = ""
    cta_candidate: str = ""
    selling_point_ids: list[str] = Field(default_factory=list)
    audience: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    evidence: list[ContentListingEvidence] = Field(default_factory=list)
    confidence: float = Field(default=0, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shadow_traceability(self) -> "ContentListing":
        if self.status == "evidence_validated" and not self.source_segment_ids:
            raise ValueError("evidence_validated listing requires source segments")
        return self


class ContentListingShadowSnapshot(BaseModel):
    model_config = ConfigDict(extra="allow")

    job_id: str = Field(min_length=1)
    contract_version: str = "content_listing_shadow.v1"
    mode: Literal["shadow"] = "shadow"
    formal_render_integration: bool = False
    auto_publish_enabled: bool = False
    listings: list[ContentListing] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
