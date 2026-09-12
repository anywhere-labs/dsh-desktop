import json
from pathlib import Path
from typing import Any


class CommerceVideoPackager:
    def package(self, output: Path, metadata: dict[str, Any], destination: Path) -> dict[str, Any]:
        destination.mkdir(parents=True, exist_ok=True); target = destination / output.name
        target.write_bytes(output.read_bytes()); manifest = destination / "manifest.json"
        payload = {"artifact": str(target), "metadata": metadata, "publication": "manual_confirmation_required"}
        manifest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload


PLATFORM_SPECS = {"douyin": {"displayName": "抖音", "maxDurationSeconds": 15, "ratios": ["9:16"]}, "xiaohongshu": {"displayName": "小红书", "maxDurationSeconds": 15, "ratios": ["9:16", "1:1"]}, "wechat-video": {"displayName": "视频号", "maxDurationSeconds": 15, "ratios": ["9:16", "16:9"]}}
