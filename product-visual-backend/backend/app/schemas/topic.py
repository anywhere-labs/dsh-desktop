from pydantic import BaseModel


class TopicPlanRequest(BaseModel):
    account_id: str

