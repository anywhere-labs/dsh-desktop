from pydantic import BaseModel


class MaterialAnalyzeRequest(BaseModel):
    material_id: str = ""

