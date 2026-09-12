from pydantic import BaseModel


class ReportImportRequest(BaseModel):
    video_id: str
    day_type: str = "7d"
    views: int = 0

