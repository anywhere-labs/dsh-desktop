from pydantic import BaseModel


class AttributionRequest(BaseModel):
    video_id: str

