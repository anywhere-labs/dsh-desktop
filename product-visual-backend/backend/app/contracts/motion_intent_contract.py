from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MappingStatus = Literal["pending_mapping", "mapped", "blocked"]
MotionDensity = Literal["low", "medium", "high"]


class MotionIntent(BaseModel):
    model_config = ConfigDict(extra="allow")

    intent_id: str = Field(min_length=1)
    clip_id: str = Field(min_length=1)
    intent_type: str = Field(min_length=1)
    component: str = Field(min_length=1)
    primary_text: str = Field(min_length=1)
    secondary_text: str = ""
    selling_point_id: str = ""
    source_segment_id: str = ""
    source_start: float = Field(ge=0)
    source_end: float = Field(gt=0)
    final_start: float | None = Field(default=None, ge=0)
    final_end: float | None = Field(default=None, gt=0)
    mapping_status: MappingStatus = "pending_mapping"
    preferred_placements: list[str] = Field(default_factory=list)
    density: MotionDensity = "low"
    style: dict = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_intervals(self) -> "MotionIntent":
        if not math.isfinite(self.source_start) or not math.isfinite(self.source_end):
            raise ValueError("source interval must be finite")
        if self.source_end <= self.source_start:
            raise ValueError("source_end must be greater than source_start")
        if (self.final_start is None) != (self.final_end is None):
            raise ValueError("final_start and final_end must be set together")
        if self.final_start is not None and self.final_end is not None:
            if not math.isfinite(self.final_start) or not math.isfinite(self.final_end):
                raise ValueError("final interval must be finite")
            if self.final_end <= self.final_start:
                raise ValueError("final_end must be greater than final_start")
        if self.mapping_status == "mapped" and self.final_start is None:
            raise ValueError("mapped intent requires a final interval")
        return self
