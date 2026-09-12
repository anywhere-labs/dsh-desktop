from pydantic import BaseModel, Field


class TranscriptSegmentInput(BaseModel):
    start: float
    end: float
    text: str
    segment_id: str | None = None
    index: int | None = None
    selected: bool | None = None


class TranscriptUpdateRequest(BaseModel):
    revision: int = Field(ge=1)
    segments: list[TranscriptSegmentInput]


class TranscriptNormalizeRequest(BaseModel):
    revision: int = Field(ge=1)
    merge_gap_ms: int = Field(ge=0)


class TranscriptRerenderRequest(BaseModel):
    revision: int = Field(ge=1)
    template_ids: list[str] | None = None
    active_template_id: str | None = None


class VariantActivateRequest(BaseModel):
    variant_id: str
