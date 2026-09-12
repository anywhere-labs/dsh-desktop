from pydantic import BaseModel


class HotspotRequest(BaseModel):
    account_id: str

