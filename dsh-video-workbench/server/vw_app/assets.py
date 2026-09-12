from pathlib import Path
from typing import Any


class AssetUploadService:
    """Common asset contract; provider-specific upload remains inside adapters."""
    def manifest(self, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{**asset, "role": asset.get("kind", "UNKNOWN"), "uri": asset.get("uri", "local://browser-preview")} for asset in assets]

    def validate(self, assets: list[dict[str, Any]]) -> list[str]:
        return ["assetId is required" for asset in assets if not asset.get("assetId")]
