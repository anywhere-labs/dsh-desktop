from pydantic import BaseModel, Field


class ApiResponse(BaseModel):
    status: str
    message: str = ""
    data: dict = Field(default_factory=dict)
    trace_id: str = ""
    missing_inputs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    next_action: list[str] = Field(default_factory=list)

