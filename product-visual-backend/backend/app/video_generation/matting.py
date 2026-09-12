from __future__ import annotations

import os
from typing import Any


MATTING_CAPABILITIES = {
    "matanyone2": {
        "env": "MATANYONE2_RUNNER",
        "role": "人物时序抠像与 alpha 精修",
        "license": "NTU S-Lab License 1.0; verify commercial rights before distribution",
    },
    "birefnet": {
        "env": "BIREFNET_RUNNER",
        "role": "商品/前景边缘精修",
        "license": "MIT; model weights require separate review",
    },
}


def matting_preflight() -> dict[str, Any]:
    capabilities = {
        name: {
            **meta,
            "configured": bool(os.getenv(meta["env"], "").strip()),
        }
        for name, meta in MATTING_CAPABILITIES.items()
    }
    missing = [name for name, item in capabilities.items() if not item["configured"]]
    return {
        "status": "ok" if not missing else "blocked",
        "capabilities": capabilities,
        "missing_inputs": missing,
        "policy": "MatAnyone2 is required for person alpha; BiRefNet is required when a product target is selected; no synthetic foreground is accepted",
    }


def build_matting_request(task_id: str, selections: list[dict[str, Any]]) -> dict[str, Any]:
    labels = {str(item.get("label", "")).strip().lower() for item in selections}
    if "person" not in labels:
        raise ValueError("matting blocked: person_selection")
    preflight = matting_preflight()
    missing = ["matanyone2"] if "matanyone2" in preflight["missing_inputs"] else []
    if "product" in labels and "birefnet" in preflight["missing_inputs"]:
        missing.append("birefnet")
    if missing:
        raise RuntimeError(f"matting backend unavailable: {', '.join(missing)}")
    return {
        "task_id": task_id,
        "matanyone2": "person alpha refinement",
        "birefnet": "product edge refinement" if "product" in labels else "not_required",
        "preserve_original_pixels": True,
        "synthetic_foreground": False,
    }
