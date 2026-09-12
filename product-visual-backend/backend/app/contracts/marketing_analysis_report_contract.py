from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.contracts.data_evidence_snapshot_contract import DataEvidenceSnapshot


class MarketingAnalysisReport(BaseModel):
    model_config = ConfigDict(extra="allow")

    report_id: str = Field(min_length=1)
    version: str = "marketing_analysis_report.v1"
    status: Literal["template", "partial", "ready", "blocked"] = "partial"
    brand_name: str = ""
    strategy_id: str = ""
    evidence_snapshots: list[DataEvidenceSnapshot] = Field(default_factory=list)
    verified_facts: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)
    inferences: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
