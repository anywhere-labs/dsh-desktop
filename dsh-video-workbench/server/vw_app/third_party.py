import json
import os
import time
import urllib.request
from typing import Any


class ThirdPartyVideoAdapter:
    """Generic async adapter. Vendor-specific payload/status mapping is configured per provider."""
    def __init__(self, config: dict[str, Any]): self.config = config
    def available(self) -> bool: return bool(self.config.get("enabled") and self.config.get("baseUrl") and os.getenv(str(self.config.get("credentialRef", ""))))
    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.available(): raise RuntimeError("third-party provider is not configured")
        token = os.getenv(str(self.config["credentialRef"]))
        request = urllib.request.Request(self.config["baseUrl"].rstrip("/") + "/generate", json.dumps(payload).encode(), {"content-type": "application/json", "authorization": f"Bearer {token}"}, method="POST")
        with urllib.request.urlopen(request, timeout=int(self.config.get("timeoutSeconds", 60))) as response: return json.load(response)

    def run(self, project_id: str, node: str, request_payload: dict[str, Any] | None = None) -> tuple[int, str, str]:
        try:
            payload = dict(request_payload or {})
            payload.update({"projectId": project_id, "node": node, "model": payload.get("model") or self.config.get("modelKey")})
            result = self.submit(payload)
            result = self.poll_if_needed(result)
            return 0, json.dumps(result, ensure_ascii=False), ""
        except Exception as cause:
            return 1, "", str(cause)

    def poll_if_needed(self, result: dict[str, Any]) -> dict[str, Any]:
        status_url = result.get("statusUrl") or result.get("status_url")
        if not status_url: return result
        token = os.getenv(str(self.config["credentialRef"]))
        deadline = time.monotonic() + int(self.config.get("timeoutSeconds", 60))
        while time.monotonic() < deadline:
            request = urllib.request.Request(status_url, headers={"authorization": f"Bearer {token}"})
            with urllib.request.urlopen(request, timeout=30) as response: current = json.load(response)
            state = str(current.get("status") or current.get("state") or "").lower()
            if state in {"completed", "complete", "succeeded", "success", "failed", "error", "canceled"}: return current
            time.sleep(float(self.config.get("pollIntervalSeconds", 2)))
        raise TimeoutError("third-party provider polling timed out")
