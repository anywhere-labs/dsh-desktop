from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


RepairTargetAsset = Literal["subtitle", "flower_text", "packaging", "clip"]
RepairAction = Literal[
    "regenerate_subtitle",
    "regenerate_flower_text",
    "rerender_packaging",
    "recut_segment",
]
RepairRerunScope = Literal["packaging_only", "clip_only"]


class RepairTimeRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> "RepairTimeRange":
        if not math.isfinite(self.start) or not math.isfinite(self.end):
            raise ValueError("repair time range must be finite")
        if self.end <= self.start:
            raise ValueError("repair time range end must be greater than start")
        return self


class RepairSourceRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> "RepairSourceRange":
        if not math.isfinite(self.start) or not math.isfinite(self.end):
            raise ValueError("repair source range must be finite")
        if self.end <= self.start:
            raise ValueError("repair source range end must be greater than start")
        return self


class RepairTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: str = Field(min_length=1)
    clip_id: str = Field(min_length=1)
    target_asset: RepairTargetAsset
    final_time_range: RepairTimeRange
    action: RepairAction
    reason: str = Field(min_length=1)
    rerun_scope: RepairRerunScope
    source_revision: int = Field(ge=1)
    replacement_source_ranges: list[RepairSourceRange] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_local_scope(self) -> "RepairTask":
        expected = {
            "regenerate_subtitle": ("subtitle", "packaging_only"),
            "regenerate_flower_text": ("flower_text", "packaging_only"),
            "rerender_packaging": ("packaging", "packaging_only"),
            "recut_segment": ("clip", "clip_only"),
        }[self.action]
        if (self.target_asset, self.rerun_scope) != expected:
            raise ValueError("repair action, target asset, and rerun scope do not match")
        if self.action == "recut_segment" and not self.replacement_source_ranges:
            raise ValueError("recut_segment requires replacement_source_ranges")
        if self.action != "recut_segment" and self.replacement_source_ranges:
            raise ValueError("replacement_source_ranges are only valid for recut_segment")
        return self


class RepairRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_revision: int = Field(ge=1)
