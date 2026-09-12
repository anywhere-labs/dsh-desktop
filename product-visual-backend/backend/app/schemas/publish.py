from pydantic import BaseModel


class PublishRecordRequest(BaseModel):
    account_id: str = ""
    video_id: str = ""
    platform: str = "douyin"

