from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EditPlanClip(BaseModel):
    model_config = ConfigDict(extra="allow")

    clip_id: str
    source_video: dict[str, Any] = Field(default_factory=dict)
    source_start: float = 0
    source_end: float = 0
    final_start: float = 0
    final_end: float = 0
    hook_type: str = "unknown"
    segment_reason: str = ""
    product_selling_point: str = ""
    proof_shot: str = ""
    proof_shot_verified: bool = False
    subtitle_plan: dict[str, Any] = Field(default_factory=dict)
    flower_text_plan: dict[str, Any] = Field(default_factory=dict)
    sfx_cues: list[dict[str, Any]] = Field(default_factory=list)
    transition_plan: dict[str, Any] = Field(default_factory=dict)
    qa_rules: list[str] = Field(default_factory=list)
    platform_hint: list[str] = Field(default_factory=list)


class EditPlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    plan_id: str
    job_id: str
    source_video: dict[str, Any] = Field(default_factory=dict)
    clips: list[EditPlanClip] = Field(default_factory=list)


class PackagingPlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    plan_id: str
    job_id: str
    subtitle_style: dict[str, Any] = Field(default_factory=dict)
    flower_text_style: dict[str, Any] = Field(default_factory=dict)
    audio_sfx_cues: list[dict[str, Any]] = Field(default_factory=list)
    transition_cues: list[dict[str, Any]] = Field(default_factory=list)
    visual_guide_cues: list[dict[str, Any]] = Field(default_factory=list)
    cover_text: str = ""
    title_candidates: list[str] = Field(default_factory=list)
    platform_copywriting: dict[str, str] = Field(default_factory=dict)
