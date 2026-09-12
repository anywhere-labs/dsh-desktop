from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TimelineMapping(BaseModel):
    model_config = ConfigDict(extra="allow")

    mapping_id: str = Field(min_length=1)
    clip_id: str = Field(min_length=1)
    range_index: int = Field(ge=0)
    source_start: float = Field(ge=0)
    source_end: float = Field(gt=0)
    final_start: float = Field(ge=0)
    final_end: float = Field(gt=0)
    source_segment_ids: list[str] = Field(default_factory=list)
    srt_cue_ids: list[str] = Field(default_factory=list)
    ass_dialogue_ids: list[str] = Field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.final_end - self.final_start

    @model_validator(mode="after")
    def validate_intervals(self) -> "TimelineMapping":
        values = (
            self.source_start,
            self.source_end,
            self.final_start,
            self.final_end,
        )
        if not all(math.isfinite(value) for value in values):
            raise ValueError("timeline mapping values must be finite")
        if self.source_end <= self.source_start:
            raise ValueError("source_end must be greater than source_start")
        if self.final_end <= self.final_start:
            raise ValueError("final_end must be greater than final_start")
        source_duration = self.source_end - self.source_start
        final_duration = self.final_end - self.final_start
        if abs(source_duration - final_duration) > 0.001:
            raise ValueError("source and final mapping durations must match")
        return self
