from pydantic import BaseModel, ConfigDict


class ClipPlanValidationRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    clips: list[dict]
    min_duration: float | None = None
    max_duration: float | None = None
