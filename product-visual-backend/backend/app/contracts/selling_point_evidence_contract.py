from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


EvidenceType = Literal["transcript", "visual", "provided", "combined"]
ComplianceStatus = Literal["verified", "unverified", "blocked"]


class EvidenceSourceRange(BaseModel):
    model_config = ConfigDict(extra="allow")

    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_interval(self) -> "EvidenceSourceRange":
        if not math.isfinite(self.start) or not math.isfinite(self.end):
            raise ValueError("evidence range must be finite")
        if self.end <= self.start:
            raise ValueError("evidence range end must be greater than start")
        return self


class SellingPointEvidence(BaseModel):
    model_config = ConfigDict(extra="allow")

    evidence_id: str = Field(min_length=1)
    selling_point_id: str = Field(min_length=1)
    clip_id: str = Field(min_length=1)
    claim: str = Field(min_length=1)
    evidence_type: EvidenceType = "transcript"
    source_segment_ids: list[str] = Field(default_factory=list)
    source_ranges: list[EvidenceSourceRange] = Field(default_factory=list)
    transcript_quote: str = ""
    proof_shot: str = ""
    verified: bool = False
    compliance_status: ComplianceStatus = "unverified"
    confidence: float = Field(default=0, ge=0, le=1)
    allowed_surfaces: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
