from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LiveClipPlanningPolicy(str, Enum):
    BASELINE = "baseline"
    VERIFIED_SHADOW = "verified_shadow"
    VERIFIED_RENDER = "verified_render"


class LiveClipPlanningSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_policy: LiveClipPlanningPolicy = LiveClipPlanningPolicy.BASELINE
    effective_policy: LiveClipPlanningPolicy = LiveClipPlanningPolicy.BASELINE
    selected_plan_source: Literal["baseline", "verified"] = "baseline"
    selected_plans: list[dict[str, Any]] = Field(default_factory=list)
    human_acceptance_status: str = "not_run"
    fallback_reason: str = ""
    render_consumed: bool = False

