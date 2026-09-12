from __future__ import annotations

import hashlib
import json
from typing import Any


class LiveClipDirectorAgent:
    """Plans the v1.4 orchestration DAG without replacing the v1.3.1 media chain."""

    workflow_name = "liveclip_delivery_v1_4"

    def plan(self, task: dict[str, Any]) -> dict[str, Any]:
        task_id = str(task.get("task_id") or task.get("job_id") or self._stable_id(task))
        dag = [
            {"node": "material_probe", "agent": "ffmpeg_agent", "depends_on": []},
            {"node": "scene_silence_detect", "agent": "scene_detect_agent", "depends_on": ["material_probe"]},
            {"node": "speech_transcription", "agent": "whisper_agent", "depends_on": ["material_probe"]},
            {
                "node": "clip_scoring",
                "agent": "clip_score_agent",
                "depends_on": ["scene_silence_detect", "speech_transcription"],
            },
            {"node": "caption_packaging", "agent": "caption_agent", "depends_on": ["clip_scoring"]},
            {"node": "delivery_package", "agent": "delivery_agent", "depends_on": ["caption_packaging"]},
        ]
        return {
            "task_id": task_id,
            "dag_id": self._dag_id(task_id, dag),
            "workflow": self.choose_workflow(task),
            "dag": dag,
        }

    def replay(self, plan: dict[str, Any]) -> dict[str, Any]:
        dag = plan.get("dag") or []
        task_id = str(plan.get("task_id") or self._stable_id(plan))
        return {
            "task_id": task_id,
            "dag_id": str(plan.get("dag_id") or self._dag_id(task_id, dag)),
            "workflow": str(plan.get("workflow") or self.workflow_name),
            "dag": dag,
            "replay_mode": True,
        }

    def choose_workflow(self, task: dict[str, Any]) -> str:
        if str(task.get("task_type") or "liveclip").lower() in {"liveclip", "live_clip"}:
            return self.workflow_name
        return "generic_video_delivery_v1_4"

    def _stable_id(self, payload: dict[str, Any]) -> str:
        digest = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
        return f"liveclip_{digest[:24]}"

    def _dag_id(self, task_id: str, dag: list[dict[str, Any]]) -> str:
        digest = hashlib.sha256(
            json.dumps({"task_id": task_id, "dag": dag}, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        return f"dag_{digest[:24]}"
