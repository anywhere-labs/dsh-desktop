from pydantic import BaseModel


class TraceQuery(BaseModel):
    trace_id: str

