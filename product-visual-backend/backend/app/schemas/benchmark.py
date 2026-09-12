from pydantic import BaseModel


class BenchmarkImportRequest(BaseModel):
    account_id: str
    title: str = "对标视频"
    url: str = ""

