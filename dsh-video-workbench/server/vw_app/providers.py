import json
import subprocess
from pathlib import Path
from typing import Any
from .config import Settings


def extract_output_url(raw: str) -> str | None:
    try: value: Any = json.loads(raw)
    except json.JSONDecodeError: return None
    if isinstance(value, dict):
        for key in ("url", "video_url", "videoUrl", "download_url", "downloadUrl"):
            if isinstance(value.get(key), str) and value[key].startswith(("http://", "https://")): return value[key]
        for child in value.values():
            found = extract_output_url(json.dumps(child))
            if found: return found
    elif isinstance(value, list):
        for child in value:
            found = extract_output_url(json.dumps(child))
            if found: return found
    return None


class LibTvCliAdapter:
    provider = "libtv-cli"

    def __init__(self, settings: Settings): self.settings = settings
    def command(self, project_id: str, node: str) -> list[str]: return [self.settings.libtv_bin, "node", node, "--project", project_id, "--run"]
    def run(self, project_id: str, node: str) -> tuple[int, str, str]:
        result = subprocess.run(self.command(project_id, node), cwd=self.settings.libtv_cwd, capture_output=True, text=True, timeout=self.settings.libtv_timeout_seconds, check=False)
        return result.returncode, result.stdout, result.stderr
    def available(self) -> bool: return Path(self.settings.libtv_bin).exists()
