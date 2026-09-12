from __future__ import annotations

import os
from typing import Any

from .contracts import ObjectSelection


TRACKER_CAPABILITIES = {
    "sam2": {"env": "SAM2_RUNNER", "role": "首帧目标提示分割"},
    "cutie": {"env": "CUTIE_RUNNER", "role": "跨帧时序 Mask 传播"},
}


def validate_selections(selections: list[dict[str, Any]]) -> list[str]:
    missing: list[str] = []
    if not selections:
        return ["object_selections"]
    labels = {str(item.get("label", "")).strip().lower() for item in selections}
    if "person" not in labels:
        missing.append("person_selection")
    for item in selections:
        try:
            ObjectSelection(
                object_id=str(item["object_id"]),
                label=str(item["label"]),
                frame_index=int(item["frame_index"]),
                x=float(item["x"]),
                y=float(item["y"]),
                selection_mode=str(item.get("selection_mode", "point")),
            )
        except (KeyError, TypeError, ValueError):
            missing.append("selection_schema")
            break
    return missing


def tracker_preflight() -> dict[str, Any]:
    capabilities = {
        name: {**meta, "configured": bool(os.getenv(meta["env"], "").strip())}
        for name, meta in TRACKER_CAPABILITIES.items()
    }
    missing = [name for name, item in capabilities.items() if not item["configured"]]
    return {
        "status": "ok" if not missing else "blocked",
        "capabilities": capabilities,
        "missing_inputs": missing,
        "policy": "SAM2 selects objects; Cutie propagates masks; no independent per-frame segmentation",
    }


def build_tracking_request(task_id: str, selections: list[dict[str, Any]]) -> dict[str, Any]:
    missing = validate_selections(selections)
    if missing:
        raise ValueError(f"tracking blocked: {', '.join(missing)}")
    preflight = tracker_preflight()
    if preflight["missing_inputs"]:
        raise RuntimeError(f"tracking backend unavailable: {', '.join(preflight['missing_inputs'])}")
    return {
        "task_id": task_id,
        "selections": selections,
        "sam2": "首帧提示分割",
        "cutie": "时序传播",
        "preserve_original_pixels": True,
    }
