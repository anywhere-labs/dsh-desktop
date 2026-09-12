from typing import Any
from pydantic import BaseModel, Field


class AssetInput(BaseModel):
    assetId: str
    kind: str
    name: str = ""
    mimeType: str = "application/octet-stream"
    size: int = 0
    authorized: bool = False


class GenerateRequest(BaseModel):
    providerId: str = "libtv-cli"
    workspaceId: str = ""
    projectId: str = ""
    node: str = ""
    model: str | None = None
    prompt: str = ""
    confirmed: bool = False
    approvalId: str | None = None
    idempotencyKey: str | None = None
    assets: list[AssetInput] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)
