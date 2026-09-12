from pydantic import BaseModel


class EditCreateRequest(BaseModel):
    account_id: str
    script_id: str = ""
    material_id: str = ""

