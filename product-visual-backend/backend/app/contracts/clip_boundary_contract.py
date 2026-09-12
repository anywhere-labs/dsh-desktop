from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ClipBoundaryFailureCode = Literal[
    "leading_context_missing",
    "trailing_sentence_incomplete",
    "idle_ratio_exceeded",
]


class ClipBoundaryAssessment(BaseModel):
    """Read-only assessment of whether a candidate is independently usable."""

    model_config = ConfigDict(extra="forbid")

    leading_complete: bool = True
    trailing_complete: bool = True
    context_complete: bool = True
    idle_ratio: float = Field(default=0, ge=0, le=1)
    failure_codes: list[ClipBoundaryFailureCode] = Field(default_factory=list)

