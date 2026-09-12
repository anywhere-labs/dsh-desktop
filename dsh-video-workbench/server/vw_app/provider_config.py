"""Provider metadata store. Secrets are referenced by environment variable name only."""
from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any


class ProviderConfigStore:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv("VIDEO_PROVIDER_CONFIG_FILE", ".video-workbench/providers.json"))

    def list(self) -> list[dict[str, Any]]:
        if not self.path.exists(): return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else data.get("providers", [])

    def public(self) -> list[dict[str, Any]]:
        return [{k: v for k, v in item.items() if k not in {"apiKey", "token", "secret"}} for item in self.list()]
