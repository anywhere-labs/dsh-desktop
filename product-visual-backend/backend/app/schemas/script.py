from pydantic import BaseModel


class ScriptReviseRequest(BaseModel):
    instruction: str = ""

