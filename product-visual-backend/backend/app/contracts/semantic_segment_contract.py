from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SemanticType = Literal[
    "hook",
    "selling_point",
    "proof",
    "metric",
    "cta",
    "transition",
    "other",
]


class SemanticSegment(BaseModel):
    model_config = ConfigDict(extra="allow")

    segment_id: str = Field(min_length=1)
    source_start: float = Field(ge=0)
    source_end: float = Field(gt=0)
    text: str = ""
    semantic_types: list[SemanticType] = Field(default_factory=list)
    importance_score: float = Field(default=0, ge=0, le=1)
    confidence: float = Field(default=1, ge=0, le=1)
    keywords: list[str] = Field(default_factory=list)
    entities: dict[str, Any] = Field(default_factory=dict)
    source_clip_ids: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_source_interval(self) -> "SemanticSegment":
        if not math.isfinite(self.source_start) or not math.isfinite(self.source_end):
            raise ValueError("source interval must be finite")
        if self.source_end <= self.source_start:
            raise ValueError("source_end must be greater than source_start")
        return self
