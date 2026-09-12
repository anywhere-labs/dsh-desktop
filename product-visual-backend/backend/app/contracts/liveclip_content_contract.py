from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from backend.app.contracts.motion_intent_contract import MotionIntent
from backend.app.contracts.semantic_segment_contract import SemanticSegment
from backend.app.contracts.selling_point_evidence_contract import SellingPointEvidence
from backend.app.contracts.timeline_mapping_contract import TimelineMapping


class LiveClipContentContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="allow")

    job_id: str = Field(min_length=1)
    contract_version: str = "liveclip_content_contract_v1"
    semantic_segments: list[SemanticSegment] = Field(default_factory=list)
    selling_point_evidence: list[SellingPointEvidence] = Field(default_factory=list)
    motion_intents: list[MotionIntent] = Field(default_factory=list)
    timeline_mappings: list[TimelineMapping] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
