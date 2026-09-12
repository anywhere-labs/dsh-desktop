from pydantic import BaseModel


class AccountImportRequest(BaseModel):
    name: str = "阿乐服装定制 Demo"
    platform: str = "douyin"
    industry: str = "服装定制"

